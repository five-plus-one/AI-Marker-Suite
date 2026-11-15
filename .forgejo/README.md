# 内部构建与发布

内部 Issue #1 对应本次 CI 迁移。工作流使用 `linux-amd64` runner 和本地镜像 `aimarker-ci:20261115`，容器不挂载宿主 Docker socket。Actions 依赖固定到已验收的 Forgejo commit。

| 入口 | 验证与产物 | 发布 |
| --- | --- | --- |
| dev / preview / stable 的 push | 依赖审计、单元测试、打包与 Chromium/CDP 验收；core-delivery，保留 7 天 | 对应 OTA 渠道 |
| 目标 dev / preview / stable 的 PR | 相同门禁；dev PR 构建 prtest，其他 PR 构建目标渠道；core-delivery，保留 7 天 | 维护者从构建记录下载产物验收 |
| workflow_dispatch | 当前引用的全部门禁与产物 | 仅 dev / preview / stable 分支 |
| v* tag push | tag、源码与 manifest 版本一致；相同门禁；core-release，保留 30 天 | Forgejo 稳定 Release |
| preview 发布成功 | 使用同一次验证的产物 | Forgejo 浮动预发布 preview-latest |
| 同仓库 PR 关闭或改目标分支 | 默认分支的可信辅助脚本核对 PR 当前状态 | DELETE 回收已有 pr-N 目标 |

PR 构建任务不引用部署 secret。自动 PR 在线发布待可信完成事件和产物交接方案验收后接入；当前验收使用构建记录中的 artifact。清理流程只执行默认分支的工具，既不检出 PR 源码，也不安装其依赖。

构建使用 Node 24 和 `CHROME_BIN=/usr/bin/chromium`。每个普通渠道显式传入 Unix 毫秒构建号，dev / preview 后缀高于原运行编号。脚本功能版本仍来自 `src/core/config.js`。stable 同版本重新发布要求相对当前版本 tag 只有 CI、工作流删除、忽略项和开发流程文档发生变化；产品代码、构建器、依赖与测试变化须走版本发布。

`scripts/ci/build.cjs` 运行全部门禁并创建 `.ci-output/delivery.tar.gz`。包内根目录含 `ai_marker.user.js`、`manifest.json`、`.delivery.json`；身份文件包括 repository、完整 commit、target、version、build。artifact 另存校验摘要、来源记录、发布说明和原始产物。部署凭据只注入独立的发布步骤。

部署使用仓库 secret `MARKER_DEPLOY_URL` 与 `MARKER_DEPLOY_TOKEN`：HTTPS `POST /deploy?target=dev|preview|stable&commit=<40位SHA>`，Bearer 认证，gzip 二进制 body。发布前重新核对分支 HEAD，接收端再次核对并持久化 manifest 回执，站点目录不保留 `.delivery.json`。客户端拒绝重定向；请求失败不会被当作成功。回收使用 `DELETE`，target 为 `pr-N`。部署回执 artifact 保留 30 天。

Forgejo Release 由 `scripts/ci/release.cjs` 调用本仓库 API 创建，附件为脚本、manifest 与 delivery 身份记录。发布说明按更新日志分类并处理脚本头关键字中的用户提及符号。stable tag 已有的发布与附件保持幂等；preview-latest 更新到最新预览提交。选定分支与 GitHub Release 由服务器私有同步程序处理。

迁移到 preview / stable 时，只挑选本 Issue 的 CI 文件、旧工作流删除和开发流程文档，不把 dev 的产品代码一并合入。提交前运行 `node --test scripts/ci/policy.test.cjs`；完整门禁由 PR CI 验收。人工触发生产分支工作流与合并发布遵循本次授权或后续明确的发布授权。
