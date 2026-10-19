# Command Code 动态 x-session-id / x-project-slug 本地补丁记录

> 状态：本机全局两份 dsh 安装已应用（2026-09-29，v22.22.1 与 v24.21.0 为同一 inode 硬链接）
> 范围：`@deepseek-ai/dsh-llm-pi-ai`（0.1.7-rc.1，与 opencode `x-opencode-session` 补丁同文件共存）
> 目的：宿主升级/重装后需按本文重新打补丁

## 背景

- commandcode 网关（`https://api.commandcode.ai/provider/v1`）的请求需要 `x-session-id`、
  `x-project-slug`；这两个值原先写死在
  `~/.dsh/profiles/tui-dev/cordis.patch.yml` 的 `commandcode` / `cc` provider `headers` 里
  （`x-session-id: 91b07d55-d637-47bc-a3d6-d706c33e64b3`、`x-project-slug: mumu`），
  跨 dsh 会话/项目不会变化。2026-09-29 已把这 4 行静态配置删除，改由本补丁动态生成，
  **不再有静态回退**。
- commandcode 的其余默认 header（`User-Agent`、`x-command-code-version`、`x-cli-environment`、
  `x-taste-learning`、`x-cmd-provider-deepseek-internal`）由 `~/.dsh/settings.yaml` 的
  `llm-pi-ai.providers.{commandcode,cc}.headers` 提供；tui-dev profile 里的同名块是重复项。
  本次只删了 `x-session-id` / `x-project-slug` 4 行，未动其余 header。
- dsh 传给适配器的 `GenerateOptions` 只有 `sessionId`，没有 cwd / project / slug 字段
  （`dsh-llm/lib/types/types.d.ts`）；项目信息在 live session 的 durable header 里：
  `ctx.get("sessions").get(sessionId).header.cwd`（`dsh-session/lib/types/types.d.ts` 的
  `SessionHeader.cwd`；服务名见 `dsh-session/lib/index.js` 的 `super(ctx, "sessions")`）。
- 用户 2026-09-29 裁定口径：
  - `x-session-id` = dsh sessionId **去掉 `session-` 前缀**的裸 UUID（与既有静态值同形）；
  - `x-project-slug` = `basename(session.cwd)`（如 `/Users/vito/data/dev/mumu` → `mumu`；
    与 dsh workspace 默认 title 同口径：路径最后一段）；
  - session 没有 cwd（headless/worker 等）时**只发 `x-session-id`，不发 `x-project-slug`**；
  - 条件只匹配 `baseURL`：含 `commandcode.ai` 即生效，不看 provider 名或 model id（opencode 补丁同日同样修正为只匹配 `baseURL` 含 `opencode.ai`）。

## 方案

与 `x-opencode-session` 补丁同型：在 `PiAiAdapter.streamWithSnapshot()` 里、`const iterator = toStreamChunks(...)` 之前构造动态 header，并用展开合并覆盖 `profile.headers` 的同名项（`x-session-id` / `x-project-slug` 已从 profile 删除）；项目路径通过适配器配置新增的 resolver 从 sessions 服务查。

生效矩阵：

| 路线 / 会话 | x-session-id | x-project-slug |
|---|---|---|
| baseURL 含 commandcode.ai，有 cwd | dsh sessionId 去 `session-` 前缀 | basename(cwd) |
| baseURL 含 commandcode.ai，无 cwd | dsh sessionId 去前缀 | 不发 |
| 非 commandcode.ai baseURL，或请求无 sessionId | 不发 | 不发 |
| baseURL 含 opencode.ai | 不发（走 `x-opencode-session` 补丁，同样只按 baseURL 匹配） | 不发 |

## 补丁位置

```text
<dsh 安装目录>/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js
```

两处：`PiAiAdapter.streamWithSnapshot()` 内（约 1877 行，opencode 补丁旁）与 `new PiAiAdapter({...})` 构造处（约 2582 行）。

### 补丁 diff（语义）

在 `const iterator = toStreamChunks(...)` 之前（opencode 条件同日一并改为只按 baseURL）：

```js
const opencodeSessionHeader = options.sessionId !== void 0 && String(model.baseUrl ?? "").includes("opencode.ai") ? { "x-opencode-session": String(options.sessionId) } : {};
const commandCodeSessionId = options.sessionId === void 0 ? void 0 : String(options.sessionId).replace(/^session-/, "");
const commandCodeCwd = options.sessionId === void 0 ? void 0 : this.config.resolveSessionCwd?.(options.sessionId);
const commandCodeSlug = typeof commandCodeCwd === "string" ? String(commandCodeCwd).replace(/[/\\]+$/, "").split(/[/\\]/).pop() : void 0;
const commandCodeSessionHeader = commandCodeSessionId !== void 0 && String(model.baseUrl ?? "").includes("commandcode.ai") ? {
	"x-session-id": commandCodeSessionId,
	...commandCodeSlug === void 0 || commandCodeSlug === "" ? {} : { "x-project-slug": commandCodeSlug }
} : {};
```

headers 合并从：

```js
headers: requestHeaders({ ...profile.headers, ...opencodeSessionHeader })
```

改为：

```js
headers: requestHeaders({ ...profile.headers, ...opencodeSessionHeader, ...commandCodeSessionHeader })
```

`new PiAiAdapter({` 配置处（`resolveApiKey,` 之后）新增：

```js
resolveSessionCwd: (sessionId) => ctx.get("sessions")?.get(sessionId)?.header?.cwd,
```

## 校验

```bash
node --check "<dsh 安装目录>/.../dsh-llm-pi-ai/lib/index.js"
grep -n "commandCodeSessionHeader\|commandCodeSessionId\|resolveSessionCwd" <路径>/index.js
```

逻辑用例（2026-09-29 用从补丁文件抽取的代码 + mock session/ctx 实跑；profile 已无这两个静态值，mock 中只保留其他静态 header 如 `User-Agent`）：

| # | 输入 | 输出 |
|---|---|---|
| 1 | baseURL 含 commandcode.ai + deepseek，session-abc-123，cwd=/Users/vito/data/dev/mumu | `x-session-id=abc-123`、`x-project-slug=mumu` |
| 2 | 同上但 session 无 cwd | 只发 `x-session-id=nocwd`，不发 `x-project-slug` |
| 3 | 裸 uuid + cwd=/Users/vito/data/dev/dsh-plugins/（带尾斜杠） | uuid 原样、slug=dsh-plugins |
| 4 | baseURL 含 commandcode.ai + mimo（非 deepseek，只看 baseURL） | `x-session-id=abc-123`、`x-project-slug=mumu` |
| 5 | 请求无 sessionId | 两个都不发 |
| 6 | 非 commandcode.ai baseURL | 两个都不发 |
| 7 | provider 名任意，baseURL 含 opencode.ai | 发 `x-opencode-session`（不再看 provider 名） |
| 8 | provider 名为 opencode-go，但 baseURL 不含 opencode.ai | 不发 `x-opencode-session` |

改完需重启对应 dsh 进程才生效（node_modules 已在内存的旧模块不热替换）。

## 已应用运行时（2026-09-29）

| 运行时 | 路径 | 备注 |
|---|---|---|
| 全局 v22.22.1 | `~/.nvm/versions/node/v22.22.1/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js` | 与 v24 路径 **同一 inode（硬链接）**，改一份即两份 |
| 全局 v24.21.0 | `~/.nvm/versions/node/v24.21.0/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js` | 同上 |
| dsh-runtime/stable（1mdsh） | `~/data/dev/dsh-runtime/stable/node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js` | **2026-10-19 已打**（随 stable 通道迁 0.1.7-rc.1；与全局补丁文件逐字节相同，两处 sha256 均为 `bd66963d…`） |

关联 profile 改动（2026-09-29）：`~/.dsh/profiles/tui-dev/cordis.patch.yml` 删除 `commandcode` / `cc` 两处各 2 行静态 header（共 4 行），改由本补丁独家生成。

备份：

```text
/tmp/dsh-llm-pi-ai-index.v22.22.1.before-commandcode-patch.js.bak  sha256 2a03aa44…
/tmp/dsh-llm-pi-ai-index.v24.21.0.before-commandcode-patch.js.bak  sha256 2a03aa44…
/tmp/tui-dev.cordis.patch.yml.before-dynamic-headers.bak           sha256 3e7d6dc8…
```

应用后文件 sha256 `bd66963d…`（114235 → 115075 bytes；2026-09-29 baseURL-only 修正后）。

## 升级/重装后重打补丁步骤

1. 确认新路径并检查是否已有补丁：
   ```bash
   find ~/.nvm/versions/node ~/.npm-global ~/miniconda/envs/dsh -path '*@deepseek-ai/dsh-llm-pi-ai/lib/index.js' 2>/dev/null
   grep -c "commandCodeSessionHeader\|resolveSessionCwd" <路径>/index.js   # 打过的应有 4 处命中
   ```
   - 命中 0：按本文 diff 打；若上游已改结构（例如 `streamWithSnapshot` 重写），先读上下文再决定。
   - 有命中：检查是否仍与本文 diff 一致（升级可能解耦 v22/v24 的硬链接）。
2. 每份先备份：`cp <路径>/index.js /tmp/dsh-llm-pi-ai-index.<runtime>.bak`。
3. 打三处补丁（insert 块、headers 合并、`resolveSessionCwd` 配置），`node --check` 校验。
4. 重启对应 dsh/worker 进程。
5. 用任意 commandcode 路线发一条消息验证：请求带动态 `x-session-id`，在 mumu 目录发起时带 `x-project-slug: mumu`；无 cwd 时只有 `x-session-id`（不要再往 profile 里恢复这两个静态 header）。

## 备注

- 本补丁不提交到 dsh-plugins 仓库代码，仅记录在 docs；node_modules 改动是临时的。
- **未实测** commandcode 服务端是否要求 `x-project-slug` 必须先在其账号下注册：动态值在非 mumu 项目会发 `dsh-plugins` 等新 slug，若网关返回 4xx，需要另定项目→slug 映射（tui-dev profile 的静态 header 已删除，不做回退）。
- 无 cwd 的 session（headless/worker 等）只发 `x-session-id`；请求完全没有 sessionId 时两个 header 都不发。
- 条件只看 `baseURL`（commandcode 补丁看 `commandcode.ai`，opencode 补丁看 `opencode.ai`），不看 provider 名或 model id；同网关的不同 provider 名（commandcode/cc 等）都会被覆盖。
- 与 `docs/opencode-go-x-opencode-session-local-patch.md` 同文件共存；两处补丁互不影响（条件按 baseURL 区分）。
