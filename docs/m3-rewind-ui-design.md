# M3 设计：双击 Esc 回溯 UI

> 对应 tui-feature-gap.md M3（2026-08-26 起草）。原则：**引擎零改动**——fork +
> 工具日志逆向文件恢复全部留在 `plugins/rewind-dsh.ts`，本设计只补手势与选择器。

## 1 目标与边界

给既有 `/rewind` 能力补 UI 层：

```
双击 Esc → 弹出历史消息选择器 → 选中某条 user 消息 → 以该点为界回退会话+文件
```

明确不做：

- 不改 rewind-dsh.ts 的 fork / 文件回滚逻辑（方案 2 已验证）；
- 不做 diff 预览、多选、跨 fork 选择等增强；
- 不新增命令——`/rewind <seq>` 保持原样，选择器是它的快捷方式。

## 2 现状锚点（实现时直接引用）

| 锚点 | 位置 | 复用方式 |
|---|---|---|
| Esc 全局分支 | `lib/app.ts` handleGlobalInput escape 段 | 在此加双击判定 |
| 600ms 双击先例 | 同函数 Ctrl+C 双击退出 | 同款时间窗常量 |
| overlay 让路 | escape 段首行 `hasOverlay()` 即返回 | picker 自身的 Esc 关闭不受全局手势干扰 |
| 图片移除分支 | idle + 队列图 + 空编辑器 → removeLastPendingImage 且 consume | 优先级高于手势，consume 后**不**武装窗口 |
| 泛用弹层基建 | `tui.showOverlay()` + SelectList + setFocus（pickSession 为样板） | 新增 pickRewindPoint 同构方法 |
| 命令执行链 | `services.commands.execute(agent, line, [], signal)`（index.ts:2246） | 合成 `/rewind <seq>` 原路下发 |
| 消息列举规则 | rewind-dsh.ts handler 无参分支：`type === "user/message"` 且 `source.kind` 缺省或 `"user"`，seq + 截断摘要 | TUI 侧按同一规则扫 events |

## 3 设计

### 3.1 手势（app.ts）

idle 态（无 overlay、agent 非 running）每次 Esc **武装窗口**并记时刻；600ms 内第二次
Esc → 清窗、调 `options.onDoubleEscape?.()`。已 consume 的路径（取消运行、移除图片）
不武装。编辑器有文字或补全菜单打开时的 Esc 照旧透传给编辑器（dismiss 菜单），同时武装
——菜单关掉后第二击没有别的语义，误弹再按一下 Esc 关掉即可，代价为零。

运行中 Esc = 取消（不变）；连按两次取消也只取消一次，不开选择器（running 不武装）。

### 3.2 回调缝（app ↔ index 解耦）

TuiApp options 增加 `onDoubleEscape?: () => void`，由 index.ts 注入。app 层不知道
commands 服务存在——与其他 options.onCancel/onExit 同构。

### 3.3 选择器（app.ts 新增 pickRewindPoint）

```ts
pickRewindPoint(items: Array<{ seq: number; summary: string }>): Promise<number | null>
```

- SelectList 锚 bottom-left，行文 `[seq] summary`（60 字符截断，与 /rewind 列表一致）；
- onSelect 回 seq，onCancel/Esc 回 null；
- 空列表由调用方拦截（见 3.4），组件本身不处理空态。

### 3.4 数据与执行（index.ts 注入的 onDoubleEscape 实现）

1. 扫 `agent.session.events`，按 §2 同款规则取候选（倒序，最新在上）；
2. 候选 < 1（空会话）→ notice「无可回退的历史」；
3. dsh-rewind 未挂载（registry 无 rewind 命令）→ execute 抛未知命令 → 捕获后
   notice「rewind 插件未挂载」——优雅降级，不强依赖 profile 组合；
4. 弹 pickRewindPoint；null 直接返回；
5. 合成 `/rewind <seq>` 走 services.commands.execute 原路下发——与手敲完全同一条
   路径，后续 execve 重启 + resume 由插件自管。

### 3.5 时序要点

- execute 是同步返回 CommandResult 的调用（插件内部 fork/persist 后 execve），picker
  hide 后再执行，避免 overlay 残留；
- execve 会整进程替换，无需清理 TUI 状态；
- AbortController.signal 用完即弃（与 2246 行现状一致）。

## 4 文件清单

| 文件 | 变更 |
|---|---|
| `lib/app.ts` | lastEscape 字段 + 双击判定；options.onDoubleEscape；pickRewindPoint |
| `lib/index.ts` | 注入 onDoubleEscape：事件扫描 → 降级守卫 → picker → execute |
| `docs/tui-feature-gap.md` | M3 行落地标记 |

profile 无改动（dsh-rewind 已在 tui-dev/tui 两 profile 挂载）。

## 5 验证点

| # | 验证 | 通过标准 |
|---|---|---|
| V1 | 空闲双击 Esc | 选择器弹出，列历史消息（最新在上） |
| V2 | 选中 → 确认 | 与手敲 `/rewind <seq>` 行为一致：重启后 resume 到边界前 |
| V3 | 单击 Esc 各既有语义 | 取消运行 / 移除图片 / dismiss 菜单全部不回归 |
| V4 | 未挂 dsh-rewind 的组合 | notice 降级，不崩 |

## 6 决策点 D1（定稿项）

武装范围二选一：

- **A（建议）**：任意 idle Esc 都武装（含编辑器有字/菜单开）——CC 同款肌肉记忆，
  规则只有一条；
- **B**：仅编辑器为空时武装——更保守，但打字中途想回退必须先清空草稿。
