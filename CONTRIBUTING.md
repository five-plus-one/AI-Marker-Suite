# 贡献指南

感谢你对 AI 批改助手的关注！欢迎通过以下方式参与贡献。

## 报告问题

发现 Bug 或有功能建议，请到 [GitHub Issues](https://github.com/five-plus-one/AI-Marker-Suite/issues) 提交，提交前请：

1. 先搜索是否已有相同问题
2. 尽量提供完整信息：
   - 脚本版本号（设置面板顶部可查看）
   - 阅卷平台名称和网址
   - 浏览器类型和版本
   - 按 `F12` 打开控制台，复制带 `[诊断]` 标记的日志
3. 使用对应的 Issue 模板填写

## 新平台适配需求

如果你希望支持新的阅卷平台：

1. 提交 [新平台适配请求](https://github.com/five-plus-one/AI-Marker-Suite/issues/new?template=new-platform.yml)
2. 如果你能提供测试账号，适配速度会快很多，欢迎[联系作者](https://r-l.ink/contact)
3. 如果你有开发能力，也可以参考[开发新适配器](https://aimarking.five-plus-one.com/advanced/adapter-dev)文档自行开发后提交 PR

## 提交代码

### 开发新适配器

1. Fork [AI-Marker-Suite 仓库](https://github.com/five-plus-one/AI-Marker-Suite)
2. 参考 [开发新适配器文档](https://aimarking.five-plus-one.com/advanced/adapter-dev)
3. 建议参考 `src/adapters/wuyuetong/`（传统 jQuery 页面）或 `src/adapters/keewing/`（现代框架页面）作为实现模板
4. 创建新分支，添加适配器代码
5. 本地执行 `npm run build` 确认构建通过
6. 提交 Pull Request，说明适配的平台、技术栈和测试情况

### 修改核心功能

1. Fork 仓库并创建新分支
2. 修改代码后确保 `npm run build` 通过
3. 提交 Pull Request，说明改动内容和动机

::: note
完整的适配器接口规范和选择器约定见[开发新适配器](https://aimarking.five-plus-one.com/advanced/adapter-dev)文档。
:::

## 改进文档

文档站源码在 [AI-Marker-Suite-Docs](https://github.com/five-plus-one/AI-Marker-Suite-Docs) 仓库，欢迎：

- 直接在文档页面点击「在 GitHub 上编辑此页」提交修正
- 补充截图、示例、常见问题
- 翻译或优化表述

## 行为准则

- 尊重他人，理性讨论
- Issue 和 PR 描述尽量清晰、具体
- 不要提交包含学生真实信息、答题卡截图等隐私内容

## 许可证

贡献的代码将遵循本项目的 [GPL-3.0 许可证](LICENSE)。
