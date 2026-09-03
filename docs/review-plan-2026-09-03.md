# 2026-09-03 dsh-plugins 详细代码评审计划

目标：对 `main @ d9bb6ad` 全量源码做一次详细评审，输出**可执行、可验证的具体问题**（文件路径 + 1-based 行号），不报风格偏好/假设性问题；干净模块返回空发现。

范围（10 个源码文件 + 关键配套）：

- `lib/startup.ts`、`lib/index.ts`（TUI runner，3353 行）
- `lib/app.ts`（TUI app，2738 行）
- `lib/transcript.ts`、`lib/palette.ts`、`lib/sanitize.ts`、`lib/terminal.ts`、`lib/clipboard.ts`、`lib/diff.ts`、`lib/export.ts`、`lib/presets.ts`
- `plugins/rename-session.ts`、`plugins/rewind-dsh.ts`（+ 测试）
- `presets/liangshen-bash/*`、`scripts/release.sh`、`scripts/sync-agent-presets.sh`

方法：

1. 先跑 `npm test` 与 `npx tsc --noEmit`，建立基线。
2. 逐文件阅读，重点找：
   - 数据形状不匹配（对照 dsh harness 真实事件/service 契约）
   - 竞态/异步未 await、超时导致挂死
   - 资源泄漏（child_process、终端 restore、事件监听）
   - 错误吞噬 / 路径拼接 / 用户输入未消毒
   - 发布脚本的假阳性/假阴性检测
   - 测试只测实现、不测真实契约
3. 对每个候选问题做最小验证（如 grep 事件形状、追 service 定义、跑单测）。
4. 输出按严重度分级的 findings 表：文件:行号 + 问题 + 影响 + 验证证据。

验证基线（已确认）：

- `npm test`：55 pass / 0 fail
- `npx tsc --noEmit`：通过

输出：最终回复给出完整 findings；如某模块干净则明确“无发现”。