# liangshen-bash 自研后首轮锚定轨迹实测（2026-09-03）

- 环境：真实 dsh headless（`dsh --profile headless --patch presets/liangshen-bash/trajectory.patch.yml`），模型 `opencode-go/deepseek-v4-flash`，preset 直挂 repo 自研文件（`roots:[<repo>/presets]`）。
- 方法：5 个新会话各发一个简单任务，读取 `request/header` 的 tools、首个请求前 `user/message` 的 source.kind、首条 `assistant/message` 首行。
- 判定（文档 §4 #5）：`tools == ['bash','str_replace_editor']`、首轮无 `agent-instructions/skill-catalog/instruction-hint` 注入、首行非 "Let me/I'll/我们/我来" 式未锚定开场。

| 会话 | 任务 | tools | 注入 | 首行 | 结果 |
| --- | --- | --- | --- | --- | --- |
| 1 | 列出当前目录 | bash, str_replace_editor | 无 | （空；模型直接工具调用） | ✅ |
| 2 | 显示当前目录下有哪些文件 | bash, str_replace_editor | 无 | （空） | ✅ |
| 3 | 打印当前工作目录 | bash, str_replace_editor | 无 | （空） | ✅ |
| 4 | 告诉我现在几点了 | bash, str_replace_editor | 无 | （空） | ✅ |
| 5 | 当前目录里最大的文件是什么 | bash, str_replace_editor | 无 | （空） | ✅ |

**结论：5/5 锚定通过**（按文档 Phase 3 判定）。原始记录：`1.json`–`5.json`。