# 05 — TUI 在新宿主上冷启动（首个可演示切片）

**What to build:** 开发 profile 能启动到可交互的终端界面：全屏渲染、输入、提交消息并收到流式响应、正常退出。本票同时是票据 04 的集成验证点，只有在本票完成后，接口迁移才算真正可用。

**Blocked by:** 03 — 组合分叉与 persona 字段迁移；04 — 会话事件读取迁移（宽重构）

**Status:** done — 2026-09-10（证据 `evidence/05-tui-cold-boot.md`：验收 5/5，另处置部署位 preset 漂移）

**Known blockers（票据 02 之后的实机失败，2026-09-10）：** 详见 `evidence/05-profile-boot-conflict.md`

- rc.1 的 `dsh-base` 现在挂载 `storage`、`storage-json`、`storage-domain`、`session-projection-cache`，而 `tui-dev`（及解除停用后的 `tui-central`）profile 补丁把这 4 个 id 又 insert 一次 → 启动即 `duplicate loader entry id: session-projection-cache`，整个 profile 挂载失败。修法：删掉 `storage`/`storage-json`/`storage-domain` 三行，`session-projection-cache` 改为按 id 的 config 覆盖（或跟随 base 默认）。`tui`（稳定侧）与 `tui` profile 补丁不动（rc.2 base 不含这 4 个 id）。
- `--dump-config` 对含重复 id 的树仍 exit 0（重复检测只发生在 boot 挂载阶段），所以本票必须实机冷启动验证；配置闸门另需做「每个 id 计数为 1」的校验。
- 安装侧的 `dsh-llm-pi-ai` 需要 `docs/opencode-go-x-opencode-session-local-patch.md` 记录的 `x-opencode-session` 本地补丁才能用 `opencode-go` 路由：票据 02 的宿主升级把全局 rc.1 那份冲掉了（stable 运行时是 9月9日 新建的、本来就没有），2026-09-10 已重打回两处。后续任何宿主升级/重装都要先重打，否则本票「提交消息并收到助手流式响应」在 opencode-go 路由上会 400 `MissingSessionID`。

- [x] 开发 profile 冷启动进入全屏终端界面
- [x] 提交一条消息并收到助手流式响应
- [x] 状态行与模型标签正常显示
- [x] 干净退出且退出码为 0
- [x] 启动过程无组合挂载或服务冲突错误
