# 内部构建与发布

工作流使用 `linux-amd64` runner 和本地镜像 `aimarker-ci:20261115`，容器不挂载宿主 Docker socket。Actions 依赖固定到已验收的 Forgejo commit。

| 入口 | 验证与产物 | 发布 |
| --- | --- | --- |
| dev / preview / stable 的 push | 依赖审计、单元测试、打包与 Chromium/CDP 验收；core-delivery，保留 7 天 | 对应 OTA 渠道 |
| 目标 dev / preview / stable 的 PR | 相同门禁；dev PR 构建 prtest，其他 PR 构建目标渠道；core-delivery，保留 7 天 | 维护者从构建记录下载产物验收 |
| workflow_dispatch | 当前引用的全部门禁与产物 | 仅 dev / preview / stable 分支 |
| v* tag push | tag、源码与 manifest 版本一致；相同门禁；core-release，保留 30 天 | Forgejo 稳定 Release |
| preview 发布成功 | 使用同一次验证的产物 | Forgejo 浮动预发布 preview-latest |
| 同仓库 PR 关闭或改目标分支 | 默认分支的可信辅助脚本核对 PR 当前状态 | DELETE 回收已有 pr-N 目标 |

PR 构建任务只生成 artifact。服务器受限发布程序负责成功 run 的关联验证、在线临时发布与评论；构建工作流内不执行 PR 发布。清理流程只执行默认分支的工具并调用 DELETE 回收目标。

## 仓库与公开协作

内部仓库：[fiveplusone-dev/AI-Marker-Suite](https://git.work.five-plus-one.com/fiveplusone-dev/AI-Marker-Suite)。公开协作：[GitHub 仓库](https://github.com/five-plus-one/AI-Marker-Suite)、[Issues](https://github.com/five-plus-one/AI-Marker-Suite/issues) 与 [Pull requests](https://github.com/five-plus-one/AI-Marker-Suite/pulls)；内部入口为 [Issues](https://git.work.five-plus-one.com/fiveplusone-dev/AI-Marker-Suite/issues) 与 [Pull requests](https://git.work.five-plus-one.com/fiveplusone-dev/AI-Marker-Suite/pulls)。共享 Git refs、Issue 与 PR 关联由服务器双向协作服务维护，内部 Actions 承担构建和发布。

维护者身份按平台数值 ID 映射：内部用户 `1` 对应 GitHub 用户 `82319593`，仓库 ID 分别为内部 `3`、GitHub `1150339431`；跨平台编号分别记录，不能以同名或同号代替身份核验。公开集合包括已有公开分支、持久公开记录、dev/preview/stable，以及以共享分支为目标的合格同仓库 PR head。新分支的 `private/`、`internal/` 前缀或 PR 的 `internal-only`、`private` 标签阻止自动公开；其他内部私枝须明确准入。此协作范围仅含 Core 与 Docs。

开放 PR 在两端关联协作；业务合并由维护者执行，已合并来源通过当前目标分支的真实 Git ancestry 收据关联。历史关闭 PR 以归档保留讨论和身份记录。受保护分支使用标记为 `sync-transport` 的 `sync/forgejo/*` 运输 PR 保留分支保护；运输分支不进入一般协作导入。

## 可信人工 PR 检查

`pr-check.yml` 的人工入口接收 `pr_number` 与完整 `source_commit`，运行引用必须是该 PR 的当前目标分支。工具先从该可信引用检出并固定 `infrastructureCommit`，再从 API 核对开放 PR 的仓库身份、目标和当前 head，按 head SHA 检出待测源码。`delivery.json` 与 `provenance.json` 同时记录源码 `commit` 和工具 `infrastructureCommit`；两者可以不同，验收分别核对。最终 `forgejo/trusted-ci` 状态关联待测源码 SHA，发布程序重新核对当前 PR 与来源记录。

## PR 产物交接

artifact 名为 `core-delivery`。下载并解开 artifact 后，根目录含 `delivery.tar.gz`、`delivery.json`、`provenance.json`、`ai_marker.user.js`、`manifest.json` 和 `RELEASE_NOTES.md`。其中 `payload/` 是打包中间目录，发布程序只读取经验证的 tar。

`delivery.json` 与 tar 根目录中的 `.delivery.json` 完全一致：

```json
{
  "repository": "AI-Marker-Suite",
  "commit": "0123456789abcdef0123456789abcdef01234567",
  "target": "pr-12",
  "version": "0.0.12-prtest.1794690000000",
  "build": "1794690000000"
}
```

`provenance.json` 包含上述全部字段，并增加：`run`（Forgejo 实例级 run ID，字符串）、`event`（PR 为 pull_request）、`pr`（正整数）、`headRepository`（owner/repo）、`headRepositoryId`（数字）和 `archiveSha256`（tar.gz 原始字节的 SHA-256）。PR commit 是明确检出的 head.sha，build 是本次构建的 Unix 毫秒字符串。

发布程序必须独立从 Forgejo API 核对 run 所属仓库、工作流、事件、成功状态和实际提交，再核对 PR 同仓库、base=dev、state=open、当前 head.sha、仓库 ID 和编号。产物中的身份字段作为待校验数据，不能代替 API 关联验证。只有 target=pr-N 可进入临时发布；验证归档路径、条目类型、摘要、嵌入身份和脚本头后，上传静态 tar，不执行其中代码。临时脚本头的版本为上述 version，downloadURL 与 updateURL 均指向 `https://auto-update.aimarking.five-plus-one.com/ota/dev/prtest/forgejo/N.user.js`。

构建使用 Node 24 和 `CHROME_BIN=/usr/bin/chromium`。每个普通渠道显式传入 Unix 毫秒构建号，dev / preview 后缀高于原运行编号。脚本功能版本仍来自 `src/core/config.js`。stable 同版本重新发布要求相对当前版本 tag 只有 CI、工作流删除、忽略项和开发流程文档发生变化；产品代码、构建器、依赖与测试变化须走版本发布。

`scripts/ci/build.cjs` 运行全部门禁并创建 `ci-output/delivery.tar.gz`。包内根目录含 `ai_marker.user.js`、`manifest.json`、`.delivery.json`；身份文件包括 repository、完整 commit、target、version、build。artifact 另存校验摘要、来源记录、发布说明和原始产物。部署凭据只注入独立的发布步骤。

部署使用仓库 secret `MARKER_DEPLOY_URL` 与 `MARKER_DEPLOY_TOKEN`：HTTPS `POST /deploy?target=dev|preview|stable&commit=<40位SHA>`，Bearer 认证，gzip 二进制 body。发布前重新核对分支 HEAD，接收端再次核对并持久化 manifest 回执，站点目录不保留 `.delivery.json`。客户端拒绝重定向；请求失败不会被当作成功。回收使用 `DELETE`，target 为 `pr-N`。部署回执 artifact 保留 30 天。

Forgejo Release 由 `scripts/ci/release.cjs` 调用本仓库 API 创建，附件为脚本、manifest 与 delivery 身份记录。发布说明按更新日志分类并处理脚本头关键字中的用户提及符号。stable tag 已有的发布与附件保持幂等；preview-latest 在同一 Release ID 上更新：先将 Release 置为 draft，替换并回读三个附件的字节摘要，随后以显式 lease 更新 tag，最后发布并再次回读。附件读取凭据仅注入可信发布步骤；API 写入使用本次 Actions token。服务器双向协作服务在权威 preview CI 成功、Release 已发布且 delivery commit 与 tag 一致后同步浮动 tag 和 GitHub Release。

三个渠道通过各自的 PR 更新 CI 基础设施，业务功能按 dev → preview → stable 发布流程推进。提交前运行 `node --test scripts/ci/policy.test.cjs`；完整门禁由 PR CI 验收。人工触发生产分支工作流与合并发布遵循用户明确的发布授权。
