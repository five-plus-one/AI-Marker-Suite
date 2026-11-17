# 鑫考提交与平台换卷审计

日期：2026-11-18。修复版本：1.21.27.0。关联问题：[520](https://git.work.five-plus-one.com/fiveplusone-dev/AI-Marker-Suite/issues/520)。

## 鑫考云阅现场证据

用户使用 1.21.26.0，在 `/Marking/NormalReadPaper` 批改三个小题。诊断持续 121 秒：第 18 秒分数为 4、3、3，原站当前输入仍为首题；第 18.92 秒确认操作只将当前输入移到第二题。答卷图片摘要与试卷标识保持一致，之后三轮等待超时。

原站 `inputkey(']')` 读取全局 jQuery 对象 `o`。仅当 `o.get(0)` 等于 `input.fenshu:last` 时才调用 `submit()`，否则仅移动下一小题。`fenshuFocus(obj)` 更新这个对象。提交按钮的原生事件也是 `inputkey(']')`。这确认了直接根因：脚本完成填分后没有同步原站末项焦点，却把确认动作计为提交。

原站成功交卷后仍返回 `false`，语义是阻止键盘默认事件。该返回值不能作为保存失败回执。浏览器的 `focus()` 在后台页或输入已经聚焦时可能不派发焦点事件，验收覆盖了这一情况。

## 修复行为

- 云阅卷、鑫考校园和鑫考内网版通过共享逻辑验证当前图片、分数和可用提交入口，定位原站实际末项。焦点事件未派发时补发原生焦点事件处理，再次核对答卷与分数。
- 有按钮的页面调用原站按钮，无按钮的校园版从页面上下文调用键盘确认。异常后停止，不再尝试第二个入口。
- 云阅卷及三种鑫考适配器在取图与换卷时使用同一组可见图片。只接受完整加载且连续两次稳定的图片，保留答卷查询参数，并忽略明确的缓存刷新参数。
- 在取图与提交前捕获整组旧卷资源；等待及重试沿用此基线。旧页须全部退出可见集，新页须全部就绪。等待响应取消、离开阅卷页和任务变化。

`submitGrade()` 的成功表示已执行原站提交入口。此次适配仍依赖原站处理保存校验，未新增服务端保存回执协议；真实部署的最终保存和连续阅卷由预览版用户验收。

## 全平台检查

以 1.21.26.0 正式版为基线，检查 51 个适配器目录与打包入口，审阅等待方法、键盘提交、基线建立位置、图片来源和停止处理。直接使用 `inputkey` 的三种适配器均已纳入此次修复。

确定性探针运行实际适配器和模拟页面，按虚拟时钟推进；不对生产平台填分或发请求。探针确认了以下两组其他平台问题，已各自登记实施范围：

| 问题 | 平台 | 复现与后果 | 跟踪 |
| --- | --- | --- | --- |
| 等待开始后才建立旧卷基线 | C30、科耘、光大、光大 V2、七天新 UI、乐华 | 在进入等待前把答卷 A 切换为 B，六个平台仍等到超时；实际已完成的快速换卷会暂停连续批改 | [523](https://git.work.five-plus-one.com/fiveplusone-dev/AI-Marker-Suite/issues/523) |
| 同卷完整 URL 变化被当作换卷 | 华翰云 hanhan、云阅卷好分数、慧学星、粤教翔云、威科姆、新教育考试 | 保持答卷路径和业务参数，只增加 `timestamp=123`，六个平台报告新卷；可能重复批改同一答卷 | [524](https://git.work.five-plus-one.com/fiveplusone-dev/AI-Marker-Suite/issues/524) |

这些探针确认代码在指定时序和资源变化下的行为，不代表各平台均已出现相同的生产投诉。其余平台的就绪判断、整组图片和回执实现各有差异，本次源码审阅与现有回归不替代逐个平台的真实账号验收。

复现命令：

```sh
node scripts/audit-paper-transition.cjs
node --test tests/xinkao-transition.test.js
npm run build -- --channel=dev
node scripts/verify-browser.cjs --fixture=xinkao-cloud
node scripts/verify-browser.cjs --fixture=xinkao-campus
node scripts/verify-browser.cjs --fixture=xinkao-intranet
node scripts/verify-browser.cjs --fixture=xinkao-public
```

浏览器使用实际打包脚本，在宽窄窗口、深浅主题下核对四种页面的注册、三小题零分、首题焦点、原站 jQuery 焦点对象、一次交卷、同步换卷、多页图片、隐藏旧图、缓存刷新和取消等待。公网版保留原站按钮提交路径。
