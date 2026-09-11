# 08 — 进程内 app 层（假终端）

**What to build:** 让 TUI 的应用层在没有真实终端的情况下可被驱动，从而把高频回归（冷启动首帧、状态行、按键语义、选择器流程、退出路径与终端恢复序列）纳入日常单测。做法是给应用构造选项增加一个可选的终端注入项，默认走真实终端实现（全进程只构造一次应用，不存在同进程重建终端的需求，因此不做工厂）；再新增一个假终端测试件，实现完整终端接口（含输入排空）、捕获写入帧、可注入按键、固定列行数。复制相关断言必须走远程会话分支，否则要么真去写系统剪贴板、要么断言恒绿——这条坑写进测试注释。

**Blocked by:** 01 — 路径可移植性与宿主依赖解析

**Status:** done — 2026-09-11（实现与验收证据齐；未提交，证据见 evidence/08-in-process-app-tier.md）

**施工图:** `docs/regression-test-automation-plan.md` §3.2、§5.4；用户决策 D7（构造项注入）、Q19a（进日常单测）。

- [x] 应用构造选项支持注入假终端，默认行为不变（不注入时仍用真实终端实现）— `options.terminal ?? new ProcessTerminal()`（app.ts:1872/1922）
- [x] 假终端实现完整终端接口（含输入排空与列行数），可捕获写入帧并经输入回调注入按键 — `lib/testing/fake-terminal.ts` 15/15 成员 + `mark()/writtenSince()/send()/resize()`
- [x] 断言：冷启动首帧含路由与组合标识 — app.test.ts 1
- [x] 断言：状态行字段在位 — app.test.ts 2（模型/工作区/ctx 占用）
- [x] 断言：单次中断键与双次中断键的退出语义 — app.test.ts 3–5（含运行中打断）
- [x] 断言：选择器流程可被驱动并返回选中值 — app.test.ts 7（Down + Enter → sess-b）
- [x] 断言：退出路径写出终端恢复契约（进入备用屏、退出备用屏、光标恢复）— app.test.ts 8
- [x] 变异验证：人为删除停止终端的调用后，恢复契约断言变红 — 注掉 `stopAndExit` 的 `tui.stop()` → not ok 8 / fail 1，随后恢复，见证据 §四
- [x] 复制相关断言只走远程会话分支（测试注释说明原因）— app.test.ts 9（`SSH_CONNECTION` 下拖选 OSC 52，payload `XCOPY`）
- [x] 新测试进入日常单测命令，整体仍为秒级且全绿 — package.json 清单；`npm test` 117/117、0.9s
- [x] `phase-swap-bash.test.mjs` 自带的 boot 桩并入共享 `test-helpers.mjs`（保留 `sessionListeners`/`assembleListeners` 的直驱手法）— 302→202 行，11/11 绿；来自施工图 §6-6 与 P2.5 的「桩统一」；stable 副本 `presets/minimal-plus/test-helpers.mjs` 按 D3 不动、差异保留
