# AI-Marker-Suite (Core) 开发约定

油猴脚本主体仓库。push 到 dev / preview / stable 会通过 GitHub Actions 自动构建并部署到对应 OTA 渠道，**push stable 等于向全体用户发布稳定版**。

## 分支流向（必须遵守）

```
feature/* ──PR──▶ dev ──PR──▶ preview ──PR──▶ stable
                开发版渠道    预览版渠道    稳定版渠道
```

- **dev**：唯一开发入口。所有功能分支和外部贡献 PR 的目标分支都是 dev
- **preview**：dev 测试稳定后经 PR 合入，供预览版用户灰度验证
- **stable**：preview 稳定后经 PR 合入。合并 = 发布稳定版，合并前必须升版本号

规则：

1. 分支同步 PR（dev→preview、preview→stable）一律用 **Create a merge commit**，保持三条分支族谱连通。禁止 squash（会切断历史，导致后续 PR 出现大量"幽灵提交"）
2. **合并进入 preview 前必须经用户明确确认**，不得自动合并。即使改动已验证、PR 已建好，也要停下等确认
3. 合并进入 stable（发布稳定版）同样必须经用户明确确认
4. stable 有分支保护，禁止直接 push，一律走 PR
5. 外部贡献者的 PR 若误指 stable：改 base 为 dev（gh pr edit N --base dev），不要直接合并
6. 紧急热修复例外：从 stable 切 hotfix 分支 → PR 到 stable → 合并发布后，立刻把修复 cherry-pick 回 dev 和 preview

## 版本规则

- 版本号唯一来源：`src/core/config.js` 的 `SCRIPT_CONFIG.VERSION`，4 段式（如 `1.21.10.0`）
- `package.json` 的 version 手动保持一致（不参与构建，仅防误导）
- dev / preview 渠道构建时自动追加 `-dev.N` / `-preview.N` 后缀，无需手动处理

**4 段语义**（第 3 段 = 稳定版批次号，第 4 段 = 灰度批次号）：
- 功能批进 dev 时：第 4 段 +1（`1.21.10.0 → 1.21.10.1`），CHANGELOG 新增对应 key（如 `'1.21.10.1': [...]`），第 3 段不动
- stable 发布时：第 3 段 +1、第 4 段归零（`1.21.10.2 → 1.21.11.0`），灰度 key 汇总为正式 key（如 `'1.21.11'`）并删除灰度 key
- 同版本号无法触发用户端更新检查（Actions 里的 version-guard 会强制拦截）

- 新版本条目写入 `SCRIPT_CONFIG.CHANGELOG`，条目格式：`【新平台】/【新功能】/【优化】/【修复】/【文档】+ 一句话描述`
- **CHANGELOG/发布文案禁止裸写 `@xxx`**（GitHub 会解析为用户提及：`@match` 曾把无关用户标成贡献者）。脚本头关键字一律写「match」「脚本头 match」「connect」等；release.yml 有全角 ＠ 消毒兜底，但不要依赖它
- **改数据安全路径（答卷校验/填分/提交/判分）的函数：全函数语义体检，不只看自己的增量**。存量逻辑可能带病（#253：Canvas 换卷判定把「填分前输入框为空」当成换卷证据），既有测试还可能把错误行为固化成断言——先质疑语义，再当规格
- **弱信号不得直接触发「丢弃/拦截/判分」**：无法判定一律放行并告警；填分失败必须显式失败，不得静默续走提交（空分进平台=事故）；兜底取图拿不准就宁可不取（批错卷比空图严重）

## 发布清单（stable 发版）

发布前执行 [阅卷现场与兼容矩阵](docs/testing/platform-scenes.md)：列出本次修改及公共依赖影响的平台，对照上个稳定版核验旧格式、取图、同卷等待与完整换卷流程。试改、普通、无人模式分别记录验证等级和覆盖缺口；流程通过与真实平台验收分别报告。缺少关键现场证据时，先补证据并在 PR 明确发布范围。

1. dev 上：从灰度 CHANGELOG key（第 4 段 > 0）汇总正式条目，升 VERSION（第 3 段 +1、第 4 段归零），删除灰度 key，写正式 CHANGELOG key，跑构建验证
2. PR dev→preview，merge commit 合并 → 自动发预览渠道，并自动创建/更新 GitHub 预发布 `preview-latest`（tag，避免与 preview 分支同名）
3. 验证 preview 渠道 manifest 已更新，以及 GitHub Pre-release 已刷新
4. PR preview→stable，merge commit 合并 → 自动发稳定渠道（GitHub Pages 安装页同步更新）
5. 打 tag 并推送：`git tag v1.21.10.0 && git push origin v1.21.10.0` → Actions 自动创建 GitHub Release（release.yml，含更新说明和脚本附件）
6. 如有新平台：文档站仓库 AI-Marker-Suite-Docs 新增平台页、更新 platform index 和 config.ts 侧边栏/SEO

## 账号现场留档

每次取得获授权的测试账号，都先按 [阅卷现场留档与回归](docs/testing/platform-scenes.md) 建立本地档案，再调试。保存已加载前端程序、页面/iframe、资源、接口样本、关键状态、操作时序、评分资料和完整性清单，并验证离线回放。账号密码及登录会话凭据不进入档案；原始材料存于本地受限且被 Git 排除的目录。未执行的保存动作、未进入的任务和服务端实现明确登记为覆盖缺口。

## 构建与验证

改完代码必须本地跑通构建再提交：

```bash
npm run build -- --channel=dev
```

产物在 `dist/`（已 gitignore）。config.js 解析失败或适配器缺失时构建会直接报错。

## Bug 修复 / 功能开发 / 平台适配流程（必须遵守）

遇到 bug、新需求、新平台适配时，严格按以下顺序执行：

1. **分析**：定位根因 / 确认方案，给出结论
2. **提 Issue**：描述问题、根因、修复方向。bug 用 `[Bug]` 前缀，新功能/平台用 `[Feature]` 前缀
3. **实施**：创建 `fix/issue号-简述` 或 `feat/issue号-简述` 分支，动手改代码
4. **提 PR**：PR 正文用 `Closes #N` 关联 issue，写清问题/修复/校验
5. **验证**：构建通过后提交，合并后走发布链

不要跳过 issue 直接改代码。即使问题很小，也要有 issue 留痕。

### Issue / PR 描述规格

问题描述必须足够详细，让没参与讨论的人能看懂。包含：

- **使用场景**：什么题型/什么情况下遇到
- **当前行为**：具体操作路径和现象（含示例数据）
- **期望行为**：改完后应该怎样
- **影响后果**：为什么要修
- **涉及文件**：关键代码位置
