# 大会话 resume 内存与渲染性能分析（session-58d510b4）

> 2026-08-26 报告：`session-58d510b4-837e-4872-b6c1-00dd2fa11a07` resume 后内存
> 立即 ~1.6G，运行缓慢近乎卡死。本文为实测分析结论 + 修复设计。

## 1. 会话规模（实测）

| 指标 | 值 |
|------|-----|
| 磁盘日志 | 12MB（zstd）/ 36MB 明文 / 46,494 行 |
| turns / steps | 262 / 2,678 |
| tool call | 2,486 次 |
| assistant message | 2,601 条 |
| LLM retry | **294 次**（该 session 跑得很挣扎） |
| 流式 delta（磁盘打包行） | text-chunks 1,022 + reasoning-chunks 3,920 + tool-call-chunks 7,564 |

## 2. 根因链（逐层实测）

### 第 1 层：加载时的 delta 解包 —— 事件数 ×10

dsh-session 的 chunk-rows 设计：磁盘把连续 delta 打包成一行
（省 ~56× envelope 开销），**加载时无损展开回原始事件**。实测：

| 视图 | 事件数 |
|------|--------|
| 磁盘行 | 46,494 |
| 内存展开后 | **482,960**（assistant/chunk 占 467,600） |

展开后 heapUsed ≈ 139MB；harness 整层（存储 + agent + endless +
projection）resume 后 RSS ≈ **300–380MB**（无 TUI 探针实测）。这一层是
dsh 本体包的设计行为，插件侧无法回避。

### 第 2 层：TranscriptModel 折叠 —— 便宜

4192 行折叠耗时 46ms，模型层本身不是瓶颈。

### 第 3 层：pi-tui 渲染 —— 真正的卡点

- `ScrollView.render()` 每帧调用整棵文档树的 render，再裁剪到视口——
  **无虚拟化**，每帧成本 O(全部 transcript 行)。
- 实测冷帧（全树缓存失效后的单次重绘）：
  - 纯 Text 模拟（截断文本）：**368ms**；
  - 真实 Markdown 组件 818 行：**465ms**。
  - 合计一次全树失效 >0.8s（下限；未含 tool view 与 reasoning Text）。
- 触发全树失效的入口：终端 resize、cell-dimension 上报（CSI 6;t）、
  以及流式期间 spinner/chunk 对部分行的 setText（每次使该行缓存失效，
  下帧重绕排）。
- boot 后首帧必然是冷帧 → 秒级冻结；此后每个按键/流式 tick 都在
  O(全文档) 的分配上产生 GC churn → V8 堆持续扩张。

### 内存账（1.6G 的构成）

| 分量 | 实测/推断 |
|------|-----------|
| harness 层静态（含 48 万事件） | ~300–380MB（实测） |
| TUI 4192 个行组件 + Markdown/tool view 缓存 | 数十至数百MB（结构相似性推断） |
| 每帧 O(全文档) 分配的 GC churn + V8 堆 slack | 流式期间持续增长，占剩余大头 |

resume 后若立即有 turn 在跑（本 session 有 294 次 retry 的挣扎史），
churn 会把 RSS 顶到观察到的 ~1.6G。

## 3. 修复设计（自研 lib/app.ts 内，不碰 pi-tui 与 dsh 本体）

### A'. 滚动窗口挂载（主修，替代最初的截断式重建）

> 截断式方案被否决：会把滚轮可达的历史砍成占位行（回归 §「能力现状」）。
> 改为全量模型 + 视口窗口挂载。

| 步骤 | 内容 |
|------|------|
| 模型层不变 | `TranscriptModel.rebuild` 仍全量折叠（实测 46ms）；snapshot 引用的文本本就驻留（assistant/message 已在内存），增量成本可忽略 |
| TranscriptArea 窗口化 | 维护 `[winStart, winEnd)`（视口 ±3 屏）；只对窗口内 seq `buildRowComponent` + `addChild`，滑出即 unmount |
| 窗口感知 | 每帧从 `tui.currentLayout.primaryScrollView` 读 `scrollTop`/`contentHeight`（pi-tui 无滚动回调，轮询是唯一缝）；组件上次 render 的行数记入高度账本，用于 scrollTop↔行区间换算，±屏级缓冲容忍误差 |
| 流式路径 | follow-end 时新行追加在窗口尾部，行为与现状一致 |

效果：UI 组件 4192 → 视口量级（~百）；冷帧 >0.8s → <50ms；Markdown/tool
缓存只保留窗口内；流式 churn 消失。滚动体验与现状无差。

### 能力现状（为什么 A' 而不是截断）

| 能力 | 现状 |
|------|------|
| 向上滚动 | 应用内滚轮（SGR mouse 1006 → `ScrollView.scrollBy`），全程 alt-screen，不经 iTerm2 scrollback |
| iTerm2 Cmd+F | **本来就不覆盖 transcript**——alt-screen 内容不进终端回滚缓冲；全文检索走 `/export`（markdown 导出，不受本次改动影响） |

### 内存预期的诚实修正

harness 层展开出的 48 万事件（~140MB heap）驻留在 dsh 本体的 session
对象里，插件侧无法释放；A' 消除的是组件树、Markdown/tool-view 缓存与
每帧 churn。预期稳态 RSS 回到 ~500MB 量级，而不是回到小会话水平。

### B. rebuild 跳过 delta 回放（辅修，省 CPU 与行内字符串拼接）

resume 路径的 rebuild 直接消费 `assistant/message` 终态，跳过
`assistant/chunk` 的逐条 fold（live 流式路径不变，仍走 chunk）。
467k 次 fold 的 CPU 和中间字符串拼接消失。

### C. 不做 / 后续项

| 项 | 结论 |
|----|------|
| pi-tui 虚拟化 | vendor 包不动；上游方向问题，另立 issue 跟踪 |
| dsh-session 展开行为 | 本体代码，按工具扩展策略不修改；48 万事件的 harness 侧驻留（~300MB）接受 |
| compaction 清理旧日志 | 属数据策略，另行讨论 |

## 4. 验证

### 4.1 实测结果（session-58d510b4 真实数据，483k 事件视图）

| 指标 | 改前 | 改后 |
|------|------|------|
| rebuild 耗时 | 55ms（含 467k chunk fold） | **19ms**（§B） |
| 首帧（boot tail window） | 全量挂载，冷帧 370–800ms+ | **50ms** |
| 冷失效帧（resize / cell-report） | 368–800ms+ | **9–15ms** |
| 热帧 | 0.2–0.35ms | 0.35ms（不变） |
| UI 组件驻留 | 4192 个真实组件 + Markdown 缓存 | 视口 ±60 行真实组件，其余 height-stub |

单测：`lib/transcript-area.test.ts`（窗口挂载、高度守恒、补偿收敛、
/clear 重建恢复、skipStreamDeltas 折叠语义、live chunk 路径回归）。

### 4.2 待实机确认（需 iTerm2 交互，headless 无法覆盖）

| 场景 | 期望 |
|------|------|
| resume 该 session 后滚轮上滚至最老消息 | 全程可达、无空洞；首次经过的区域有一次性测量微跳 |
| follow-end 下新 turn 流式 | 自动跟随；上翻历史时不被拽回 |
| resize / 字号变化 | 无秒级冻结 |
| 小会话（<100 行）回归 | 行为与现状一致 |

## 5. 附注：测量方法存档

无终端环境用探针 profile（tui-dev 去 tui-runner/tui-startup + mem-probe
插件）headless 复现 resume；分阶段 heap 采样 + 组件级 benchmark。沙箱
限制 openpty/ps，TUI 实机帧率未能采样；§2 数字均为组件级实测下限。
