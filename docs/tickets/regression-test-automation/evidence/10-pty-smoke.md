# 票据 10 证据 — 真实 PTY 冒烟（T4b，独立入口）

日期：2026-09-12 ｜ 状态：实现与本地验收完成；**用户已签收 Q23**（2026-09-12）
施工图：`docs/regression-test-automation-plan.md` §3.3；决策 D8（不接 release）、Q10（独立脚本）、Q20i（真实 profile）、Q22（重绘上界）、Q23（手跑）

## 1. 交付物

| 文件 | 作用 |
| --- | --- |
| `scripts/tui-pty-smoke.mjs` | 驱动：渲染真实 tui-dev 组合 → 真 PTY 启动 → `@xterm/headless` 屏幕断言 + 会话日志/磁盘副作用断言 + 报告 JSON |
| `scripts/tui-pty-smoke.sh` | 薄壳入口：仓库本地锁（与 `regression-gate.sh` 同路径同语义）、临时 home/工作区、参数透传、退出码透传 |
| `gates/stub/pty-smoke.patch.yml` | T4b 覆盖层：`tui-runner` 路由钉 `stub/stub-model` + preset 钉 `minimal-plus-next`；关 `session-title-llm`；insert `./adapter.mjs` |
| `gates/stub/adapter.mjs`（扩展） | ① `STUB_SCENARIO_FILE` 文件化场景（跨进程）；② `STUB_MODELS` 假模型目录（两条可切换假路由）；③ `delay` 块（脚本化流式节奏）。不设 env 时 T2 行为不变 |

报告产物：`experiments/regression-gate/pty-smoke-2026-09-12.json`（sha256 `0e78506a…`，机器相关数值每次重跑会小幅浮动）；
红路径报告：`experiments/regression-gate/evidence/10-negative-control-{route,drop-assertion}.json`；
T2 无回归证据：`experiments/regression-gate/evidence/10-gate-tier012-after-adapter.json`（sha256 `bda99b77…`）。

## 2. 手跑（Q23 签收命令）

```bash
scripts/tui-pty-smoke.sh
# 期望 stdout 尾部：
#   pty-smoke: report .../experiments/regression-gate/pty-smoke-<UTC 日期>.json
#   pty-smoke: assertions 14/14 passed
#   tui-pty-smoke: exit=0
```

需普通 shell（真 PTY）。受限沙箱会以 `posix_openpt: EPERM` 起不来：脚本按前置失败 exit 2 并给出
明确报错（不再崩溃/挂起）。本窗口的实测是在一次性提权 shell 里跑的——同一台机器同一 PTY 路径；
用户 2026-09-12 已签收 Q23。

## 3. 绿跑（2026-09-12，14/14，exit 0）

覆盖路径：boot 至 banner → 会话列表 → 两条消息（假模型回放）→ `/model` 切路由 → `/exit`；
第二个进程 `/rm`（确认卡 → 删除磁盘会话）→ `str_replace_editor` 建文件 → `/rewind <seq>`
（fork 落盘 → 文件恢复 → execve 重启）→ 重启后 `/sessions` → `/exit`。

断言与关键证据（完整列表见报告 JSON）：

| 断言 | 证据摘要 |
| --- | --- |
| `boot.banner` | boot1 banner=1315ms / firstData=1153ms；boot2 banner=1113ms |
| `screen.normalized` | 6 张屏幕快照，maxWidth=120/120，无 ESC/控制字符残留 |
| `sessions.visible` | `Sessions in ws (1): | 1. first message [just now · live (current)]` |
| `model.switched` | `Switched to stub/stub-model-alt` + 状态行跟随 |
| `route.pinned` | 会话首条 `request/header` = `stub/stub-model`（防误打真实 provider） |
| `route.header.changed` | 两条 `request/header` = `[stub/stub-model, stub/stub-model-alt]` |
| `rm.confirm-visible` / `rm.store-changed` | 确认卡显示目标会话 id；确认后磁盘会话目录消失 |
| `rewind.file-restored` | seq=14；`created=true restored=true`；stderr `dsh-rewind: restored files: …/target.txt` |
| `rewind.child-persisted` | 子会话 `isSeeded=true`、`parentSession=<父 id>`、`/sessions` 计数 2 |
| `exit.code-zero` | 两个进程 `exitCode=0` |
| `exit.terminal-restore` | 备用屏退出 `?1049l` ×1/×2、光标恢复 `?25h` ×24/×26 |
| `quant.clear-bound` | 清屏 `\x1b[2J`：boot1=2、boot2=4（上界 6 次/进程启动；boot2 含 execve 重启） |
| `assertions.coverage` | 13 条声明断言全部执行（防「悄悄删断言」） |

量化口径（报告 `metrics`）：

- `firstDataMs` = spawn → 首个 PTY 数据块；`bannerMs` = spawn → banner 文案可见（轮询）。
- `streaming.p50/p95` = 流式回复窗口内相邻 PTY 数据块间隔分位；`burstP50/P95` 再把
  间隔 <40ms 的连续渲染归为一个 burst 后的 burst 间间隔（脚本节奏 120ms/块，绿跑
  burstP50=93ms）。PTY 侧量的是「跨进程渲染输出节奏」，与 T4a 的进程内
  `assistant-stream` 帧时间戳互补。
- 重绘上界只数原始流中的 `\x1b[2J`（Q22）；不给生产代码加计数器。

## 4. 红路径（可复现，均实测 exit 1）

```bash
scripts/tui-pty-smoke.sh --negative-control route           # 模拟 /model 切换被改坏/跳过
#   → 12/14：model.switched、route.header.changed 红；exit 1
scripts/tui-pty-smoke.sh --negative-control drop-assertion  # 模拟某条断言被删
#   → 12/13：assertions.coverage 红（missing: rewind.file-restored）；exit 1
```

## 5. 实现要点与实测坑

1. **跨进程假模型**：T2 的 `stubState` 只存在于 runner 进程；T4b 用 `STUB_SCENARIO_FILE`
   把同一份场景 JSON 注入 `dsh` 子进程。`/model` 需要两条可切换假路由 → `STUB_MODELS`
   扩目录；目录元数据必须带 `provider/id/name`，缺字段会被 llm runtime 整条判 `INVALID_CATALOG`
   （首版只回 `{id}`，picker 静默显示 0 条 stub 路由）。
2. **`str_replace_editor` 只收绝对路径**；且 macOS `/var` → `/private/var`，而 rewind 的
   `resolveUnder` 是词法包含判断。场景里的目标文件必须写 **workspace 的 realpath**，否则
   rewind 报 `cannot restore … (outside workspace)`（或工具报 `not an absolute path`）。
3. **`/rm` 同进程删不掉**：`deleteSessionFlow` 拒绝「store 里 live」的会话，`/new` 后旧会话
   仍 live → 冒烟用两次 boot：boot1 建会话 A，boot2（新进程）删 A 并跑 rewind。这也正好覆盖
   「删除后存储变化」的真实路径。
4. **`/rewind` 只还原 `write/edit/str_replace_editor`**（bash 无 before-state 被跳过），
   所以工具轮用 `str_replace_editor create`；execve 重启后 PTY 保持同一子进程，等待用
   stderr 的 `dsh-rewind:` 摘要 + 新 banner 双信号，不靠固定休眠。
5. **等待纪律**：全部 `waitScreen/waitRaw` 轮询（100ms）+ 超时；脚本里唯一的时间输入是场景
   `delay` 块（它是被测节奏本身，不是测试侧的 sleep）。
6. **隔离**：`DSH_HOME`/`HOME` 指向临时 home，cwd 为临时 workspace；`renderRealComposition`
   只读真实 profile/settings（副本落临时 home，跑完删除）。实测真实 `~/.dsh`：无本次会话落盘
   （`~/.dsh/sessions` 无对应 slug）、共享 farm mtime 仍为 09-11 11:32。
7. **锁**：薄壳与 `regression-gate.sh` 共用 `$REPO/.git/dsh-regression-gate.lock`，两入口串行。

## 6. 无回归证据

- `scripts/regression-gate.sh --tier 0,1,2 --json …/10-gate-tier012-after-adapter.json`
  → `58 passed, 0 failed, 0 skipped`，exit 0（含 T0 的 `tsc --noEmit` 与 `npm test`，
  以及 T2 五个 stub 场景）。证明 `adapter.mjs` 的环境变量扩展在 T2 下行为不变。
- `grep -rn "tui-pty-smoke" scripts/regression-gate.sh gates/run.mjs scripts/release.sh` → 无命中；
  `git diff scripts/release.sh` 为空 → 发版路径未出现该脚本（票面两项 grep 验收成立）。

## 7. 未覆盖 / 限制

- 不做整屏像素 golden（Q22/计划 §3.3）；颜色与几何只走屏幕缓冲文本与宽度断言，像素级
  回归仍留给 T4c advisory（永不 gate）。
- 首帧/分块分位数对机器负载敏感，只写入报告、不做阈值断言；有阈值的是清屏次数上界。
- 冒烟的默认报告按 UTC 日期命名，同日重跑覆盖同一文件。
- 本票不接入 `npm test`、`regression-gate.sh`、`release.sh`（D8/Q10）。
