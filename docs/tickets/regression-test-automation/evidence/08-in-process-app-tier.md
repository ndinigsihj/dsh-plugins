# 08 — 进程内 app 层（假终端）验证记录

- 执行时间：2026-09-11 19:55–20:01（本地）
- 授权：用户「继续票据 08」；施工图 `docs/regression-test-automation-plan.md` §3.2、§5.4、§6（P2.5 行）+ 决策 D7/Q19a。
- 未 commit、未 push；stable 侧 `presets/minimal-plus/**` 按 D3 未动。

## 一、改动清单（3 改 2 增，全 dev 侧）

| 文件 | 改动 |
| --- | --- |
| `lib/app.ts` | 新增 `TuiAppOptions.terminal?: Terminal`（+3 行）；`TuiApp` 的两个终端字段由字段初始化改为构造期赋值 `options.terminal ?? new ProcessTerminal()`（`lib/app.ts:1872-1873`、`:1922-1923`）；导入加 `type Terminal`。共 10 行 |
| `lib/testing/fake-terminal.ts` | 新增（110 行）：FakeTerminal，pi-tui `Terminal` 接口全部 15 个成员 |
| `lib/app.test.ts` | 新增（274 行）：9 条 T4a 断言 |
| `package.json` | `test` 清单插入 `lib/app.test.ts` |
| `presets/minimal-plus-next/phase-swap-bash.test.mjs` | boot 桩并入共享 `test-helpers.mjs`：302 → 202 行（删本地 boot/makeSession/makeAgent/fireEvent/fireToolCall/runAssemble，共约 100 行重复脚手架） |

## 二、假终端实现（票面第 2 条）

`lib/testing/fake-terminal.ts` 实现 pi-tui `Terminal` 的 15 个成员：`start` / `stop` / `drainInput` / `write` / `columns` / `rows` / `kittyProtocolActive` / `moveBy` / `hideCursor` / `showCursor` / `clearLine` / `clearFromCursor` / `clearScreen` / `setTitle` / `setProgress`。

- 帧捕获：所有写操作（含 `moveBy`/`hideCursor` 等光标序列，逐字对齐 `ProcessTerminal`）按调用顺序进 `writes`；`mark()` + `writtenSince(mark)` 取「一次动作写出的帧」。
- 按键注入：`start(onInput, onResize)` 保存回调，`send(data)` 经它注入；未 start 就 send 抛错，避免断言静默失效。`resize()` 触发 onResize。
- 与真实终端隔离：不读 `process.stdin`、不写 `process.stdout`、不进 raw mode；`drainInput` 立即 resolve（无真实 stdin 可排空）。

## 三、断言与结果（票面第 3–5、7 条）

`node --test lib/app.test.ts`：**9/9 通过，203ms**。

| # | 断言 | 证据 |
| --- | --- | --- |
| 1 | 冷启动首帧：banner 含路由 `opencode-go/deepseek-v4-flash` 与 `preset minimal-plus-next`，且首帧含 `\x1b[?1049h` | 渲染帧文本含两者 |
| 2 | 状态行字段在位：模型、工作区名（`basename(cwd)`）、上下文占用 `ctx 42% (12k/30k)` | 同一帧文本 |
| 3 | Ctrl+C 单次（idle）：不退出，提示 `Press Ctrl+C again to exit.` | 退出回调 0 次 + 提示文本 |
| 4 | Ctrl+C 双次（600ms 窗口内）：调用 `onExit` 恰 1 次 | 回调计数 |
| 5 | Ctrl+C 单次（运行中）：走 `onCancel`，不退出 | 两回调计数 |
| 6 | 双 Esc（预粘连 `\x1b\x1b`）：触发 `onDoubleEscape` 恰 1 次 | 回调计数 |
| 7 | 选择器流程：`pickSession` 渲染候选、Down + Enter 后 resolve 选中的 `sess-b` | Promise 返回值 |
| 8 | 退出路径终端恢复契约：启动含进入备用屏 `\x1b[?1049h`；`stopAndExit` 后含退出备用屏 `\x1b[?1049l` + 光标恢复 `\x1b[?25h`，退出码 0 | 写序列区间断言 |
| 9 | 复制走远程分支：`SSH_CONNECTION` 下拖选释放把 OSC 52 写入终端，payload 解码为 `XCOPY` | 唯一 OSC 52 + base64 解码 |

两处实现说明：

- 第 8 条的 notice 定时器（8s）会吊住 `node --test` 事件循环，测试 `dispose()` 里显式 `clearNotice()` + `stopTerminal()`（注释写明原因）。
- 第 9 条的鼠标坐标不写死行号：用 `locateOnScreen()` 在 `previousScreen` 上按文本定位（与 `lib/app.ts` 的 `enableShiftClickExtend` 同一结构化访问手法），取不到时抛错而非静默跳过。

## 四、变异验证（票面第 8 条）

临时把 `stopAndExit` 正常路径的 `this.tui.stop()` 注掉，跑 `node --test lib/app.test.ts`：

```
# Subtest: 退出路径：写出终端恢复契约
not ok 8 - 退出路径：写出终端恢复契约
  error: '退出应离开备用屏'
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
# tests 9  # pass 8  # fail 1
```

即：恢复契约断言由该调用真实驱动，不是恒绿。随后已恢复原样（`grep MUTATION-PROBE` 为空；复跑 9/9 绿）。

## 五、桩统一（票面第 11 条）

`phase-swap-bash.test.mjs` 删除本地 `boot`/`makeSession`/`makeAgent`/`fireEvent`/`fireToolCall`/`runAssemble`，改从 `test-helpers.mjs` 导入同名 helper；插件挂载由本地 boot 内的 `plugin.apply` 改为文件内的 `bootWithPlugin()`（共享 boot 只铺 host 存根、不装 preset 插件，这是两处唯一的行为差异点）。

- 直驱手法保留：`session/event` 与 `system-prompt/assemble` 监听器由 `test-helpers` 包装 `root.on` 捕获后按注册顺序直接调用，不经 cordis `emit`；`runAssemble` 仍走链式 `next`（调用点补传 `assembledWithSections()` 作为底层结果）。
- 行为不变证据：该文件 11 条断言全绿；`npm test` 总数由 108 → 117，增量恰为本票新增的 9 条，phase-swap 计数未变。
- 未动项（如实记录）：`phase-swap-bash.test.mjs:25` 的 `sandboxBash` 导入在本轮之前就已无引用，属既有死代码，按「非必要不动」保留未删——建议后续清理时一并处理。

## 六、全量验证

| 命令 | 结果 |
| --- | --- |
| `npx tsc --noEmit` | 0 错 |
| `npm test` | **117/117 通过**，`duration_ms 751`，墙钟 0.9s（秒级要求满足） |
| `node --test lib/app.test.ts` | 9/9，203ms |

## 七、覆盖边界与副作用

- 不覆盖（属 `lib/index.ts` 闭包，按计划留给 T4b）：`/model`、`/effort`、`/sessions`、`/rm`、`/resume`、`/exit`、`/rewind`。
- 假终端不碰 TTY，不写用户目录，无残留文件；仅第 9 条测试临时设置并还原 `SSH_CONNECTION`。
- 未改动部署位 / profile / 宿主配置；stable 侧零改动。

## 八、票面勾对

| 票面条目 | 结论 |
| --- | --- |
| 构造选项支持注入假终端，默认不变 | ✅ `options.terminal ?? new ProcessTerminal()`，无注入时行为不变 |
| 假终端完整接口 + 帧捕获 + 按键注入 + 列行数 | ✅ 15/15 成员，`mark()/writtenSince()/send()/columns/rows` |
| 冷启动首帧含路由与组合标识 | ✅ 断言 1 |
| 状态行字段在位 | ✅ 断言 2 |
| 单次/双次中断键退出语义 | ✅ 断言 3–5（含运行中打断） |
| 选择器流程可驱动并返回选中值 | ✅ 断言 7 |
| 退出路径写出恢复契约 | ✅ 断言 8（进入/退出备用屏 + 光标恢复） |
| 变异验证变红 | ✅ §四（not ok 8 / fail 1） |
| 复制断言只走远程分支 | ✅ 断言 9 + 测试注释说明原因 |
| 进日常单测、秒级全绿 | ✅ `package.json` 清单 + 117/117、0.9s |
| phase-swap boot 桩并入 test-helpers | ✅ §五（-100 行，11/11 绿；stable 副本未动） |
