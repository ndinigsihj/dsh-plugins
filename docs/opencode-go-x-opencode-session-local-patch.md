# OpenCode Go 动态 x-opencode-session 本地补丁记录

> 状态：本机 + signer/mac-mini/git 已应用临时补丁（2026-09-07）
> 范围：`@deepseek-ai/dsh-llm-pi-ai`（dsh-base 挂载的官方 LLM 适配插件）
> 目的：dsh 升级/重装后需按本文重新打补丁

## 背景

dsh 使用 `opencode-go/deepseek-v4-flash` 时，OpenCode Go 网关返回：

```text
INVALID_REQUEST: 400: {"type":"MissingSessionID","message":"Error from provider (Console Go): Request is missing x-opencode-session and cannot be routed efficiently."}
```

根因：`dsh-llm-pi-ai` 虽然已经把 dsh 的 `options.sessionId` 透传给 pi-ai，但从未把它映射成 OpenCode 需要的 HTTP header `x-opencode-session`。OpenCode Go 从约 2026-09-06 起对缺失该 header 的 `deepseek-v4-flash` 请求直接 400。

## 方案

不采用 settings.yaml 静态 header（OpenCode session 应是动态的、随 dsh 会话变化），而是在 `dsh-llm-pi-ai` 适配器请求构造处加动态 header：

- 当请求带 `options.sessionId`
- 且 provider 为 `opencode` / `opencode-go`，或 baseURL 含 `opencode.ai`
- 则把 `String(options.sessionId)` 作为 `x-opencode-session` 发出去

dsh 会话 ID 的格式不统一：既可能是 `session-<uuid>`，也可能是裸 `<uuid>`（取决于创建路径/是否 resume）。header 只要求稳定且不透明，因此**原样透传 dsh session id，不做格式假设、不加前缀**。

参考实现：`~/dev/llm-proxy` main/v1.2.0 的 `lib/proxy.js` + `lib/request-key.js` 做过类似动态 session 持久化；dsh 侧不需要再持久化，因为 dsh 本身已有稳定 session id。

## 补丁位置

文件（随 @deepseek-ai/dsh 版本变化，升级后重新确认）：

```text
<dsh 安装目录>/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js
```

当前在 `PiAiAdapter.streamWithSnapshot()` 内、`snapshot.models.streamSimple(...)` 调用之前。

### 补丁 diff（语义）

在 `const iterator = toStreamChunks(...)` 前插入：

```js
const opencodeSessionHeader =
    (options.sessionId !== void 0 &&
    (model.provider === "opencode" || model.provider === "opencode-go" || model.baseUrl.includes("opencode.ai")))
        ? { "x-opencode-session": String(options.sessionId) }
        : {};
```

并把传给 pi-ai 的 headers 从：

```js
headers: requestHeaders(profile.headers)
```

改为：

```js
headers: requestHeaders({ ...profile.headers, ...opencodeSessionHeader })
```

### 校验

```bash
node --check "<dsh 安装目录>/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js"
```

应用补丁后需要重启对应 dsh 进程才会生效（node_modules 已加载到内存的旧模块不会热替换）。

## 已同步机器（2026-09-07）

| 机器 | dsh 安装路径 | 覆盖进程 | 重启方式 |
|---|---|---|---|
| mac-dev（本机） | `~/.nvm/versions/node/v22.22.1/lib/node_modules/@deepseek-ai/dsh` | 本地 TUI / v3 worker | 重启 TUI/LaunchAgent |
| signer | `/home/signer/.npm-global/lib/node_modules/@deepseek-ai/dsh` | v3 hub + signer v3 worker | `systemctl --user restart hub.service dsh-worker.service` |
| mac-mini | `/Users/vito/miniconda/envs/dsh/lib/node_modules/@deepseek-ai/dsh` | v3 worker | `launchctl kickstart -k gui/$(id -u)/com.dsh-relay.worker` |
| git | `/home/aisenz/.nvm/versions/node/v24.19.0/lib/node_modules/@deepseek-ai/dsh` | v3 worker（若 remote-agent/v2 再启用也同安装） | `systemctl --user restart dsh-worker.service` |

> 以上四台都已确认 `settings.yaml` 含 `llm-pi-ai.providers.opencode-go` 且 `.credentials.yaml` 有 `OPENCODE_GO_API_KEY`，所以统一打补丁。各台升级 dsh 包后需要按“升级/重装后重打补丁步骤”逐台重打。

## 升级/重装后重打补丁步骤

1. 每台确认新路径：
   ```bash
   find ~/.npm-global ~/.nvm/versions/node ~/miniconda/envs/dsh -path '*@deepseek-ai/dsh-llm-pi-ai/lib/index.js' 2>/dev/null
   ```
   - signer：`~/.npm-global/...`
   - mac-mini：`~/miniconda/envs/dsh/...`
   - git：`~/.nvm/versions/node/...`
   - mac-dev：`~/.nvm/versions/node/...`
2. 每台先备份：
   ```bash
   cp <路径>/index.js /tmp/dsh-llm-pi-ai-index.js.bak
   ```
3. 检查文件中是否仍存在旧标记（若上游已修复，则无需再打）：
   ```bash
   grep -n "requestHeaders(profile.headers)" <路径>/index.js
   ```
   - 无输出：上游可能已改结构或已修复，先阅读上下文再决定。
   - 有输出：按上面的 diff 重新修改。
4. 每台 `node --check` 校验语法。
5. 重启对应服务：
   - signer：`systemctl --user restart hub.service dsh-worker.service`
   - mac-mini：`launchctl kickstart -k gui/$(id -u)/com.dsh-relay.worker`
   - git：`systemctl --user restart dsh-worker.service`
   - mac-dev：重启 TUI/worker
6. 用 `opencode-go/deepseek-v4-flash` 发一条消息验证不再 400。

## 备注

- 本补丁不提交到 dsh-plugins 仓库代码，仅记录在 docs；node_modules 改动是临时的。
- 若后续 dsh 官方在 `dsh-llm-pi-ai` 中支持该 header，本补丁可整体移除。
- 当前只加 `x-opencode-session`；不模拟 `x-opencode-client: cli`，避免伪装官方客户端。
