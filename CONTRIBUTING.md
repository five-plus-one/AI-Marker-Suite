# 贡献指南

AI 批改助手的开发在[内部 Forgejo 仓库](https://git.work.five-plus-one.com/fiveplusone-dev/AI-Marker-Suite)进行。先创建内部 Issue，再创建实施分支，PR 使用 `Closes #N` 关联同仓库问题，代码贡献以 dev 为目标分支。

## 报告问题

发现 Bug 或有功能建议，请到[内部 Issues](https://git.work.five-plus-one.com/fiveplusone-dev/AI-Marker-Suite/issues) 提交，提交前请：

1. 先搜索是否已有相同问题
2. 尽量提供完整信息：
   - 脚本版本号（设置面板顶部可查看）
   - 阅卷平台名称和网址
   - 浏览器类型和版本
   - 按 `F12` 打开控制台，复制带 `[诊断]` 标记的日志
3. 使用对应的 Issue 模板填写

## 新平台适配需求

如果你希望支持新的阅卷平台：

1. 在内部仓库提交新平台适配 Issue，说明场景、平台入口与预期行为
2. 如果你能提供测试账号，适配速度会快很多，欢迎[联系作者](https://r-l.ink/contact)
3. 如果你有开发能力，也可以参考[开发新适配器](https://aimarking.five-plus-one.com/advanced/adapter-dev)文档自行开发后提交 PR

## 提交代码

### 开发新适配器

1. 在内部仓库创建 Issue，并从 dev 创建 `fix/问题号-简述`、`feat/问题号-简述` 或任务约定的 `codex/` 分支
2. 参考 [开发新适配器文档](https://aimarking.five-plus-one.com/advanced/adapter-dev)
3. 建议参考 `src/adapters/wuyuetong/`（传统 jQuery 页面）或 `src/adapters/keewing/`（现代框架页面）作为实现模板
4. 创建新分支，添加适配器代码
5. 本地执行 `npm run build` 确认构建通过
6. 提交 Pull Request，说明适配的平台、技术栈和测试情况

### 临时测试版

向内部 `dev` 分支提交 PR 后，内部 CI 会运行依赖审计、单元测试、打包验证和 Chromium/CDP 验收。成功构建在 Actions 记录中保存 `core-delivery`，服务器受限发布程序独立核验 PR 与成功 run 的关联后提供在线临时测试版。

1. 从构建记录下载 artifact 中的 `ai_marker.user.js`，或使用服务器发布程序提供的链接，通过 Tampermonkey 安装。
2. 临时测试版使用与正式版相同的名称和命名空间，安装后替换当前脚本。
3. 按 PR 的改动场景验证，并在 PR 中记录结果。涉及批改时，建议使用脱敏答卷检查识别、评分和异常后的暂停行为。
4. 后续提交生成新产物，受限发布程序只接收当前 head SHA；PR 关闭或改目标分支后回收已有在线临时目标。

临时测试版版本为 `0.0.PR编号-prtest.构建号`，脚本内的自动更新检查暂停。验证结束后重装正式渠道脚本。PR 工作流只构建产物；服务器发布程序校验同仓库、开放状态、dev 目标、当前 head SHA 和成功 run 身份，且只处理静态产物。完整约定见 [.forgejo/README.md](.forgejo/README.md)。

### 修改核心功能

1. 创建内部 Issue，再从 dev 创建实施分支
2. 修改代码后确保 `npm run build` 通过
3. 提交 Pull Request，说明改动内容和动机

::: note
完整的适配器接口规范和选择器约定见[开发新适配器](https://aimarking.five-plus-one.com/advanced/adapter-dev)文档。
:::

## 改进文档

文档站源码在[内部 AI-Marker-Suite-Docs](https://git.work.five-plus-one.com/fiveplusone-dev/AI-Marker-Suite-Docs) 仓库，以 docs-dev 为开发入口，欢迎：

- 创建内部 Issue，并提交文档修正 PR
- 补充截图、示例、常见问题
- 翻译或优化表述

## 行为准则

- 尊重他人，理性讨论
- Issue 和 PR 描述尽量清晰、具体
- 不要提交包含学生真实信息、答题卡截图等隐私内容

## 许可证

贡献的代码将遵循本项目的 [GPL-3.0 许可证](LICENSE)。
