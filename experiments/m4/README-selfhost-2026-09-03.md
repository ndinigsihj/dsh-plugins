# M4 统计重跑（自研后，2026-09-03）

与历史 M4 同口径：headless 组合 + agent-presets，`opencode-go/deepseek-v4-flash`，
每组 9 个新会话，任务模板逐字沿用历史 `m4-probe-{group}{run}.txt`。

- 数据：`results-liangshen-bash-selfhost-E-C-2026-09-03.jsonl`（18 条 + 注释头）
- 复算：`node experiments/m4/summarize.mjs <results.jsonl>`
- E = liangshen-bash（自研替换后，repo 内挂载）；C = liangshen（部署位基线 preset）

## 结果

| 组 | n | tool call | we need | let me | 锚定率 | check3（二轮 agent-instructions） | check4（二轮沙箱 bash） | 二轮工具数（均） |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **E** 自研 liangshen-bash | 9 | 9 | 0 | 0 | **100%** | 9/9 | **9/9** | 28 |
| **C** liangshen（基线） | 9 | 9 | 0 | 0 | 100% | 9/9 | 0/9（persistent，预期） | 28 |

## 与历史 M4（2026-08-21）对比

| 组 | 历史锚定率 | 本次锚定率 | 历史 check3 | 本次 check3 | 历史 check4 | 本次 check4 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| E | 89%（8 tool call / 1 let me） | **100%**（9/0/0） | 9/9 | 9/9 | 9/9 | 9/9 |
| C | 100% | 100% | 9/9 | 9/9 | 0/9 | 0/9 |

结论：自研替换后首轮锚定无回归（E 反而比历史批高 1 跑）；check3/check4 与历史一致。

## 口径说明

- 两次都是 headless（历史 M4 本就如此，见 `docs/liangshen-bash-preset-design.md` §5.4）。
- 本次 E 的 `injectedEvents` 含 `skill-catalog`（当前 dsh-base host 层 promotion 后会恢复），
  历史批未记录该项；不影响 check3/锚定判定，属 harness 侧变化。
- 历史 A 组（liangshen-plus）已删除，本次只重跑 E/C。
- 复算历史 A 组锚定率为 78%（原始 JSONL 为准；设计文档表内写 100% 与其 we need=2 不一致，本文未改历史表）。
- `scripts/custom-bash-win-smoke.mjs` + CI workflow 仍待 Windows runner 执行（Phase 2.5 阻塞）。