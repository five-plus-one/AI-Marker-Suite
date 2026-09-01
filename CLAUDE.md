# AI-Marker-Suite (Core) 开发约定

油猴脚本主体仓库。push 到 dev / preview / main 会通过 GitHub Actions 自动构建并部署到对应 OTA 渠道，**push main 等于向全体用户发布稳定版**。

## 分支流向（必须遵守）

```
feature/* ──PR──▶ dev ──PR──▶ preview ──PR──▶ main
                开发版渠道    预览版渠道    稳定版渠道
```

- **dev**：唯一开发入口。所有功能分支和外部贡献 PR 的目标分支都是 dev
- **preview**：dev 测试稳定后经 PR 合入，供预览版用户灰度验证
- **main**：preview 稳定后经 PR 合入。合并 = 发布稳定版，合并前必须升版本号

规则：

1. 分支同步 PR（dev→preview、preview→main）一律用 **Create a merge commit**，保持三条分支族谱连通。禁止 squash（会切断历史，导致后续 PR 出现大量"幽灵提交"）
2. main 有分支保护，禁止直接 push，一律走 PR
3. 外部贡献者的 PR 若误指 main：改 base 为 dev（gh pr edit N --base dev），不要直接合并
4. 紧急热修复例外：从 main 切 hotfix 分支 → PR 到 main → 合并发布后，立刻把修复 cherry-pick 回 dev 和 preview

## 版本规则

- 版本号唯一来源：`src/core/config.js` 的 `SCRIPT_CONFIG.VERSION`，4 段式（如 `1.21.10.0`）
- `package.json` 的 version 手动保持一致（不参与构建，仅防误导）
- dev / preview 渠道构建时自动追加 `-dev.N` / `-preview.N` 后缀，无需手动处理

**4 段语义**（第 3 段 = 稳定版批次号，第 4 段 = 灰度批次号）：
- 功能批进 dev 时：第 4 段 +1（`1.21.10.0 → 1.21.10.1`），CHANGELOG 新增对应 key（如 `'1.21.10.1': [...]`），第 3 段不动
- stable 发布时：第 3 段 +1、第 4 段归零（`1.21.10.2 → 1.21.11.0`），灰度 key 汇总为正式 key（如 `'1.21.11'`）并删除灰度 key
- 同版本号无法触发用户端更新检查（Actions 里的 version-guard 会强制拦截）

- 新版本条目写入 `SCRIPT_CONFIG.CHANGELOG`，条目格式：`【新平台】/【新功能】/【优化】/【修复】/【文档】+ 一句话描述`

## 发布清单（stable 发版）

1. dev 上：从灰度 CHANGELOG key（第 4 段 > 0）汇总正式条目，升 VERSION（第 3 段 +1、第 4 段归零），删除灰度 key，写正式 CHANGELOG key，跑构建验证
2. PR dev→preview，merge commit 合并 → 自动发预览渠道
3. 验证 preview 渠道 manifest 已更新
4. PR preview→main，merge commit 合并 → 自动发稳定渠道（GitHub Pages 安装页同步更新）
5. 打 tag 并推送：`git tag v1.21.10.0 && git push origin v1.21.10.0` → Actions 自动创建 GitHub Release（release.yml，含更新说明和脚本附件）
6. 如有新平台：文档站仓库 AI-Marker-Suite-Docs 新增平台页、更新 platform index 和 config.ts 侧边栏/SEO

## 构建与验证

改完代码必须本地跑通构建再提交：

```bash
npm run build -- --channel=dev
```

产物在 `dist/`（已 gitignore）。config.js 解析失败或适配器缺失时构建会直接报错。
