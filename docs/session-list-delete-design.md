# 设计：/resume 列表上限放宽 + 会话手动删除

> 2026-08-26 起草。两个诉求同源：列表被垃圾临时会话挤占，30 个窗口太小，
> 又没有清理手段。

## 1 现状与事实

| 事实 | 出处 |
|---|---|
| `/resume` 列表 = 全量记录 → 本工作区+非 subagent 过滤 → 读标题快照 → 剔除无标题 → **slice(0,30)** | lib/index.ts loadSessionItems |
| 标题快照读取已在 M1b-fix 优化为秒级（projectMany），30 上限的性能理由已大幅弱化 | gap 文档 M1b-fix 行 |
| SessionPicker 自带 `search>` 过滤行，长列表可用 | app.ts SessionPicker |
| **dsh 无标准会话删除 API**：持久层 remove 全是内部簿记（preparation 清理），jsonl 后端无 delete/purge | dsh-session-persistence 实查 |
| 会话日志落盘位置 `~/.dsh/sessions/<workspace-slug>/session-<id>/`，uuid 全局唯一，可按 id 跨 slug 定位 | 目录实查 |
| 投影缓存 `session_projcache.json` 的 `tables.sessions` 以 session-id 为键，可精确摘除 | storages 实查 |

## 2 F1：放宽列表上限

- slice(0, 30) → slice(0, **200**)；
- 保留「N older hidden」提示语义不变；
- 不做配置化（YAGNI：真超过 200 条时正确动作是删垃圾，见 F2）。

## 3 F2：会话手动删除（插件面，无标准缝）

数据面删除两处：

1. `~/.dsh/sessions/**/session-<id>/`（按 id 定位，不猜 slug 规则）；
2. `session_projcache.json` 的 `tables.sessions[<id>]` 键（读改写，原子替换）。

安全规则：

- 当前 live 会话拒绝删除；
- `rec.live === true`（store 在册）拒绝删除，仅允许 persisted；
- 删除前出确认卡（复用审批卡交互形态），默认焦点在取消；
- dsh-endless 记忆层的跨会话引用不在范围：悬空引用由其 as-of 注入保护兜底，不阻塞。

明确不做：批量/GC 式清理、回收站、跨 workspace 删除入口。

## 4 待决（2026-08-26 定稿）

| # | 决策点 | 选项 | 定稿 |
|---|---|---|---|
| D1 | 上限策略 | A=200 / B=彻底去上限 / C=维持 30 | **B：去上限**（picker 自带 search 过滤消化长度） |
| D2 | 删除入口 | A=仅命令 / B=仅 picker 键位 / C=A+B 都要 | **C**：`/rm <id-prefix>` + picker 内 Ctrl+D |

实现注记：

- 确认交互复用审批卡（`app.askApproval`，a 确认 · r/esc 取消），零新增 UI 组件；
- `/rm` 前缀在本工作区有标题会话内解析，须唯一命中（≥4 字符）；
- 守卫顺序：当前会话拒删 → store 在册（live）拒删 → 确认卡 → 删目录 → 摘投影缓存行；
- 投影缓存写回走同目录 tmp+rename 原子替换。

## 5 文件清单

| 文件 | 变更 |
|---|---|
| `lib/index.ts` | loadSessionItems 上限；doRm 命令（含确认卡 + fs 删除 + projcache 摘除） |
| `lib/app.ts` | （仅 D2 选 B/C 时）SessionPicker 删除键位与确认流 |
| profile | 无改动 |
