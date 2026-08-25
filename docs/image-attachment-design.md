# 图片附件设计：@ 图片 / 粘贴 / 待发队列（M3 + §9-B2 合并）

> 背景：§9-B2 盘点确认 harness 的图片管线**宿主侧已全部建成**——`ctx.attachments`
> 内容寻址存储、`dsh-attachment-local` 归一化后端（尺寸/字节/像素预算与压缩）、
> pi-ai 适配器请求时按路由策略转换 `type:"image"` 内容块、超限自动降载省略。
> 缺的只是 TUI 前端：获取图片 → 存附件 → 组装带图消息 → 回放占位。
> 本文定稿 M3「@ 图片附件」的前端方案，供新会话直接实现。

## 1. 结论

| 问题 | 决策 |
|---|---|
| 图片进入方式 | ① `/img <path>…` 本地命令（可多路径）；② 粘贴文本若为存在的图片文件路径 → 自动转待发；③ 拖拽落成路径文本者同 ② |
| 存储 | `ctx.attachments.saveImage`（dsh-attachment-local），提交消息时统一入库，日志只存引用 |
| 消息组装 | 文本块 + `{type:"image", attachment: ref}` 内容块，走 createUserMessage |
| 挂载 | `dsh-attachment-local` 先进 tui-dev（通道规则），随发版进 tui |
| 非目标 | 终端内嵌位图预览（kitty/sixel）、剪贴板位图直读（stretch 单列）、模型生成图 |

## 2. 宿主既有设施（零新增依赖，全部结构类型接线）

| 设施 | 提供能力 | 关键签名/默认值 |
|---|---|---|
| `ctx.attachments.saveImage(input)` | 校验+归一化+内容寻址入库 | input `{data: Uint8Array, mediaType, name?}`；mediaType ∈ png/jpeg/webp/gif |
| 同上 `imageLimits` | 部署级预算 | maxImageBytes/maxImagesPerMessage(20)/maxMessageImageBytes/像素与边长上限 |
| pi-ai 适配器 | 请求时 `readImageRequest(ref, policy)` 按路由像素/字节预算转换；超限最旧优先降载为文本占位 | 全自动，前端无感 |
| 命令 attachments 参数 | 斜杠命令已收图片（/plan off 的守卫即证据） | 本期不用，记录存在 |

## 3. 交互定稿

| 动作 | 行为 |
|---|---|
| `/img <path> [<path>…]` | 逐个校验存在性+扩展名 → 加入待发队列；坏路径给 notice 不入队 |
| 粘贴/输入文本命中图片路径 | onChange 检测整行恰为一个存在的图片文件路径（png/jpe?g/webp/gif）→ 清空输入框并入队 |
| 待发展示 | 编辑器上方 ambient 行：`🖼 a.png · b.jpg ×2 · esc 移除最后一个`（esc 无待发时保持原语义）|
| 提交 | 队列非空时先逐个 saveImage（任一失败：notice 指明哪张、整条退回不发送）；成功后清队列 |

Esc 移除与 Esc 打断 agent 的冲突处理：有待发队列且 agent 空闲时，Esc 优先移除最后一张；agent 运行中维持打断语义不变。

## 4. 技术方案

- **S1 挂载**：无需新增——`dsh-base` 已挂 `dsh-attachment-local`（默认 dshHome=~/.dsh）。
  教训：设计时只查了 §9 清单没复查 base 行，重复挂载导致 loader duplicate id 拒启
  （2026-08-25 实际发生，删行即愈）。后续任何挂载前先 grep base patch。
- **S2 接线**：CoreServices 增 `attachments?: { saveImage(input): Promise<{attachmentId: string; …ref 字段}>; imageLimits?: unknown }` 结构类型；mediaType 判定表 = 扩展名映射，未知扩展拒绝入队。
- **S3 待发队列**：TuiApp 增 pendingImages 状态 + setPendingImages 渲染 ambient 行；`/img` 与粘贴识别都调 `app.addPendingImage(path)`；提交钩子在 onPrompt 前。
- **S4 组装**：onPrompt 时若有队列：读文件字节 → saveImage → content = `[{text}, {type:"image", attachment: ref}…]`；createUserMessage 走既有 createMessage 通路。失败策略见 §3。
- **S5 回放占位**：transcript.ts user 分支对 image block 渲染 `[图片 <name||id 前 8 位>]` 标记行；export.ts 导出同样占位。resume 后从日志 image block 直接可见（引用外存，日志体积不受影响）。
- **S6 测试模型**：视觉验证需 vision 路由——settings 已有 `opencode-go/deepseek-v4-flash-vision-exp`（supportsReasoningEffort 已配）。验收时 `/model` 切到它再问「图里是什么」。

## 5. 风险

| 风险 | 缓解 |
|---|---|
| 非 vision 路由收到 image block | pi-ai 已内建降载/占位叙事（OFFLOADED_IMAGE_TEXT）；文档标注需 vision 路由才真正"看得见" |
| 大图 token 成本 | host 归一化+预算已兜底；前端不做二次限制 |
| 粘贴误判（恰好粘贴一个 .png 结尾的非路径文本） | 入队前 fs 存在性校验，失败则当普通文本放行 |
| 日志膨胀 | 日志只存 ImageAttachmentRef，字节在 storages 外存 |

## 6. 验收清单

1. `/img docs/a.png b.png` → chips 出现两枚；esc 移除一枚。
2. 粘贴合法图片路径 → 自动入队；粘贴不存在路径 → 保持普通文本。
3. 带 chip 提交「图里是什么」（vision 路由）→ 模型正确描述图片内容；转录 user 行显示 `[图片 …]` 占位。
4. 单图超 maxImageBytes → notice 指明该图，消息未发出。
5. resume 该会话 → 占位标记回放正常。
6. tsc 通过；stable（v0.1.3）行为不变（挂载只在 tui-dev）。

## 7. 实施顺序

S1 → S2 → S3 → S4 → S5 → S6。每步独立 commit；S3/S5 可并行。
