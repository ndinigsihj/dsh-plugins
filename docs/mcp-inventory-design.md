# B4 设计：dsh-mcp-client 挂载 + /tools 工具清单

> 对应 tui-feature-gap.md §9.2 B4（2026-08-26 定稿）。

## 1 目标与边界

打通 MCP 外部工具生态入口：profile 挂载 `@deepseek-ai/dsh-mcp-client`，TUI 提供 `/tools`
只读清单命令展示当前会话可见工具目录（原生 + `mcp__<server>__<name>`）。

明确不做：

- MCP Resources / Prompts —— dsh-mcp-client 本身未桥接，只有 Tools；
- 重连状态面板 —— 插件无服务面暴露状态，只有日志；
- 工具启停/禁用管理 UI —— 注册表 restrict 是组合期语义，不适合运行时开关。

## 2 标准服务语义（依据包 README 与 dsh-tools README，未读第三方 dsh-tui 源码）

| 事实 | 来源 |
|---|---|
| dsh-mcp-client 一实例一服务器，`inject: ["tools"]`，纯注册不提供服务 | 包 README + lib/index.js 导出面 |
| 工具以 `mcp__<serverName>__<rawName>` 注册到 `ctx.tools`，名字是 `(serverName, rawName)` 的纯函数 | 包 README「Tool naming」 |
| `failOnStartupError` 默认 false：连接/发现失败打日志、不带工具照常激活，不打断 boot | 包 README「Behavior」 |
| HMR 热替换：改 entry 触发断连重连，同 serverName 复现同名工具 | 包 README「Usage」 |
| 重连有预算（默认指数退避 ×10 次），耗尽后注销该 server 全部工具直至重载 | 包 README「Behavior」 |
| `ctx.tools.schemas(scope?): ToolSchema[]` 读目录；`get(name, scope?)` 单查 | dsh-tools README「Public API」 |
| scope 层：agent.ctx 内调用 = 该 agent 可见集（shadowing/restrict 已折算） | dsh-tools README register/get 条目 |
| dsh-tools 由 base 挂载（cordis.patch.yml:425），无重复挂载风险；mcp 行 base 不带 | dsh-base/cordis.patch.yml 实查 |
| mcp 工具调用渲染零成本：走既有 ToolRow generic 卡通用路径 | 本仓库 ToolRow 实现 |

## 3 方案

### 3.1 Profile 挂载（tui-dev 先行）

```yaml
- id: mcp-<serverName>
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: <serverName>
    transport: stdio            # 或 streamable-http
    command: npx                # stdio 形参：command/args/env/cwd
    args: ['-y', '<pkg>']
    env: { KEY: !!js process.env.KEY }
```

- 行 id 与 serverName 一一对应（`mcp-<serverName>`），便于 HMR 定位与排障；
- stable 通道暂不挂，随下一次 release（0.1.4）步骤统一评估；
- 具体服务器清单待定（§6）。

### 3.2 `/tools` 清单命令

数据源：**每次调用现读**，不做快照、不订阅事件——

```
agent.ctx.get("tools")?.schemas?.()      // 主路径：agent 可见集（restrict/shadow 折算后）
ctx.get("tools")?.schemas?.()            // 回退：boot 早期 agent 未就绪时全局视图
```

现读的理由：MCP `list_changed` 再同步与重连恢复都会改目录，任何快照都会过期；
schemas() 是同步纯读，成本可忽略。

展示形态（v1，只读）：

```
/tools            头行统计 + 分组列表
/tools <query>    名称+描述子串过滤
────────────────────────────────────
12 tools · native 10 · mcp 2 (github)
  github (2)
    mcp__github__create_issue    Create an issue…
    mcp__github__search          Search repositories…
  native (10)
    bash, read, edit, …
```

- mcp 工具按 server 聚合小节，带描述截断一行；原生工具折叠为名单（数量大时省纸）;
- 无 mcp server 时自然退化为纯原生清单，头行注明；
- 描述截断遵守逐行 SGR 规则（pi-tui 换行重置样式）。

### 3.3 Spike 验证点

| # | 验证 | 通过标准 |
|---|---|---|
| S1 | `agent.ctx.get("tools").schemas()` 可用 | 非空数组，含 `str-replace-editor` |
| S2 | ToolSchema 字段形状确认 | name/description/parameters 实际字段名 |
| S3 | 真实 server 挂载后 `mcp__` 前缀出现，/tools 分组正确 | 模型可调用 + 清单可见 |

S1/S2 在实现中顺带验证（presentersFor 已有同路径先例）；S3 需要真实 server（§6）。

## 4 文件清单

| 文件 | 变更 |
|---|---|
| `lib/index.ts` | `/tools` 命令处理器 + commands/autocomplete 注册 |
| `~/.dsh/profiles/tui-dev/cordis.patch.yml` | mcp 服务器实例行（待 §6 定案） |
| `docs/tui-feature-gap.md` | §9.2 B4 行落地标记 |

## 5 发布切面

- tui-dev 即时生效；stable 的 mcp 行随 release.sh 0.1.4 的 mount 同步步骤走；
- 无宿主代码改动，全部走插件/profile 面。

## 6 待决

要挂载哪些 MCP 服务器？候选形态：

1. **spike 用最小 server**：如 `npx -y @modelcontextprotocol/server-everything`（官方测试器，
   工具多而无副作用，适合 S3）；
2. **实际生产 server**：用户提供（GitHub / fetch / 自建等），按 §3.1 模板填；
3. **先不挂**：/tools 上线即只显示原生清单，server 后续自行加行。
