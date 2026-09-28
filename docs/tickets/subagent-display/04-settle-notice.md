# A4 — settle 通知呈现（subagent-settled）

**What to build:** 把 continuable 子代理 settle 时投递给 parent 的 runtime 记账消息（`source.kind === "subagent-settled"`）渲染为独立的「子代理已结束」行，而不是混在 dim 注入正文里；有/无收尾文本两种形态可区分，且**绝不**呈现为子代理自己说的话或 user 气泡。

**Blocked by:** 无（0.1.7 producer-owned source kind 适配已由 `da7052b` 落地）。

**Status:** proposed（2026-09-28 二稿；覆盖面已按契约核实收窄，待开工）

**施工图:** `docs/tui-feature-plan.md` §3.2、§4.4

**覆盖面（二稿核实）**

- settle 消息**只来自 continuable**：`createSettlementMessage` 唯一调用点在 continuation manager 的 disposal 路径（`dsh-subagent/lib/index.js:1248-1268`），且需 `announced` 与父 Agent 仍 live；one-shot 结束只发 `subagent/end`（`index.js:255-275`），不给父会话投 user 消息。
- 因此**本票不覆盖 one-shot 完成**：one-shot 完成不产生任何 UI 信号（用户已裁定接受无痕）。「one-shot 完成信号」登记为后续票（需在 TUI 侧新造呈现），不在本票范围。
- settle 行到达时会顺带触发 A1 的气氛行刷新（父会话 feed 已有 `refreshSubagents()` 接线），两者不需要额外耦合。

**改动面**

- `lib/transcript.ts`：
  - `TranscriptRow` 新增 `{ kind: "settled"; text: string; closing?: string; childId?: string; seq: number }`。
  - `user/message` 分支（261-298）：在通用非 `user` → context 行判定（286-287）之前，先判 `source.kind === "subagent-settled"`；`text` 取 `source.summary`（缺失回退首个 text 块），`closing` 取紧随的收尾文本（无正文时保留 `It left no closing message.` 的等价文案），`childId` 取 `source.senderSessionId`（指向子会话）。
  - `rebuild`（231-236）自然走同一 `apply` 判定，resume 后形态一致。
- `lib/app.ts`：`buildRowComponent`（657-677）为 `settled` 出组件：首行 `◌ subagent <id8> · <summary>`（正常色，非 dim 正文），`closing` 续 dim `↳ <closing>` 行；不参与 user 气泡样式。
- `lib/export.ts`：`renderTranscriptMarkdown`（15-55，分支 switch 22-52）补 `settled` 分支（引用块输出 summary + closing，不丢内容）。
- 测试：`lib/transcript-area.test.ts`（或同层）构造两种 settle（有/无收尾文本）断言可区分、来源不是 user 行；`rebuild` 重放同一事件断言一致。

**验收**

- [ ] 有收尾文本 / 无收尾文本两种 settle 渲染可区分（前者展示 `↳ …`，后者展示「无收尾」等价文案）
- [ ] settle 行不进入 user 气泡路径，也不与普通 `plugin:*` / `agent-instructions` 注入行同形
- [ ] `rebuild` 重放后形态一致（resume 场景）
- [ ] `lib/export.ts` 含该行，导出不丢内容
- [ ] `npx tsc --noEmit` exit 0；`npm test` 全绿（新测试文件需登记进 `package.json` 的 test 清单）；`scripts/regression-gate.sh --tier 0,1` 零豁免
- [ ] 证据归档（T4a/transcript 测试输出）

**范围外:** one-shot 完成信号（后续票）、`agent-message`（`form: 'relay'`）与其它 source kind 的独立呈现（现状 context 行，另立决策）、打断/停止语义与 `/rewind` 交互、Team 成员 settle 视图。
