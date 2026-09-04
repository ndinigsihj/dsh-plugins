# 思考强度（reasoning effort）接入设计

> 目标：TUI 显示并允许切换当前路由的思考强度，全部骑 harness 标准缝，零私有约定。
> 状态：**设计稿，待定稿后实现**。
> 证据均为安装包一手源码（node_modules/@deepseek-ai/*，rc.8 系）。
>
> 延伸：同一 `installModelSelection` 可变 seam 用于 `/model` provider/model 热切换，见
> [model-hot-switch-design.md](./model-hot-switch-design.md)。

## 0. 结论先行

dsh 本体已提供 effort 的完整读写机制，本特性是纯接线：

| 缝 | 提供 | 来源 |
|---|---|---|
| `agentDefaultModel.currentSelection()` | 读默认选择 `{provider, model, reasoningEffort?}` | `dsh-agent-default-model/lib/types/index.d.ts` |
| `agentDefaultModel.saveSelection(next)` | 写回（官方 settings namespace，用户层实时可读） | 同上 |
| `installModelSelection(agentCtx, ref)` | 会话作用域可变引用；`ref.current` 下一步 prompt assembly 即生效；effort 缺省 = 清除继承、恢复 provider 默认 | `dsh-agent/lib/types/model-selection.d.ts` |
| `llm.resolveModelInfo(provider, model)` | 该路由可选档位 `reasoning.efforts[]`（id/name/description/顺序）+ `defaultEffort` | `dsh-llm/lib/types/index.d.ts` L303-317、`types.d.ts` L231-254 |
| headless 消费样例 | create 时快照 `currentSelection()` 进 ref | `dsh-headless/lib/index.js` L67-83 |

## 1. 现状缺口（TUI 侧）

- `lib/index.ts#makeSetup` 给 `installModelSelection` 的引用只写了 `{provider, model}`（L545-552）——**effort 恒缺省，所有会话骑 provider 默认档**。
- TUI 无任何 effort 显示（状态栏/banner 均无）。
- 日志缺口：`request/context` 事件仅 `{provider, model, contextWindow}`（`dsh-session/lib/types/types.d.ts` L202-209），**effort 不入日志** → resume 无法从会话日志恢复当时的档位。

## 2. 数据流与真源

```
持久默认   agentDefaultModel settings ns        （跨会话；saveSelection 写）
会话即时   ModelSelectionRef.current             （本 TUI 持有；下一步生效）
有效档     ref.current?.reasoningEffort
           ?? currentSelection().reasoningEffort
           ?? resolveModelInfo().defaultEffort
           ?? provider 默认（不显示）
显示名     resolveModelInfo().reasoning.efforts 里按 id 映射 name
```

- `resolveModelInfo` 结果按 `(provider, model)` 缓存；boot、`/new`、`/model` 切换后各刷一次。
- **写入是会话作用域单写**（2026-08-23 定稿）：只写 `ref.current = { ...ref.current, reasoningEffort }`，**不调 `saveSelection`**——与 `/model` 的既定行为完全一致（会话级切换不动全局默认；默认只经 settings 通道变）。

## 3. 行为设计

### 3.1 `/effort` 命令

- 入口检查：running 否决（同 `/new` `/model`，措辞一致）。
- `resolveModelInfo(activeRoute())` 取档位；picker 每行标 `<name>` + 描述，`defaultEffort` 追加 `← default`，当前有效档追加 `← current`。
- 选择：写 `ref.current`（会话作用域，见 §2）；输出 `Thinking effort set to <name>（takes effect next turn）`；Esc 取消输出 cancelled。
- 路由无 `reasoning` 元数据 → notice「当前路由不暴露思考强度」。
- 注册进 commands registry（自动进补全菜单）。

### 3.2 显示

- **状态栏**：model 标签后追加 ` · think <name>`（dim 色）。有效档无法解析（无 reasoning 元数据 / resolveModelInfo 失败）→ 整段隐藏。数据就绪前（异步解析中）不占位。
- **欢迎 banner meta 行**：同一有效档值追加 ` · think <name>`；解析失败省略。
- 刷新时机：boot 解析完成后、`/effort` 选择后、`/model` 与 `/new` 重绑后。

### 3.3 boot / new / resume 接线

- `makeSetup` 的 route 参数升级为完整 `ModelSelection`：
  - fresh `/new`：`{ ...agentOptions, reasoningEffort: currentSelection().reasoningEffort }`；
  - boot fresh：同上；
  - resume：路由仍记录优先（`recordedRouteOf`）；effort = 该会话最后一条 `request/header`
    快照 `header.config.reasoningEffort`（**effort 实际入日志，2026-08-23 对真实会话
    核实并修正 §5 的误判**；`recordedEffortOf` 扫描），无记录时回落 settings 默认。
- `/model` 活体切换：**不携带旧 effort**（2026-09-04 定稿）——换模型后回到新模型默认档，如需会话档再
  对新模型用 `/effort` 选择。

## 4. 不做（v1）

- `/model` 内合并档位选择（先验证独立 `/effort` 的交互）。
- Web/host 侧同步（`dsh-client-ui-model-selection` 是 web 客户端自己的通道，与 TUI 无关）。
- ~~effort 的 per-session 持久化~~ 已实现（§3.3 resume 恢复）：日志形状本就支持——
  effort 记录在 `request/header` 而非 `request/context`，初版设计误判。

## 5. 已知限制

- `/effort` 是会话级临时档，不落盘 settings——新会话回到 settings 默认（与 `/model`
  行为对齐；用户拍板）。resume 会话不受此限：档位从该会话 header 记录恢复。

## 6. 验收

1. `/effort` 列表正确标注 default 与 current；选择后状态栏即时更新，下一轮对话生效。
2. 欢迎屏 meta 与状态栏数值一致；`/new` 后显示 settings 默认档（§3.3）；resume 后显示该会话最后使用的档位（header 记录恢复，无记录回落默认）。
3. 无 reasoning 元数据的路由：`/effort` 给出明确提示，状态栏/banner 不显示该段。
4. tsc 通过；rewind/phase-swap 既有测试全绿。
