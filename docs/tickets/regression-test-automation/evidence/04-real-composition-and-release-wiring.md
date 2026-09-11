# 04 — 真实组合模式与发版接线（证据）

日期：2026-09-11。基点 HEAD `36f3b20`（票据 03 提交后）。工作区改动：
新增 `gates/composition/{render-real.mjs,render-real.test.mjs}` 与实跑报告
`experiments/regression-gate/results-2026-09-11-real.json`；
修改 `gates/run.mjs`、`scripts/{regression-gate.sh,degrade-smoke.sh,release.sh}`、`package.json`（test 清单 +1）。
**stable 侧零改动**（`git status --porcelain -- presets/minimal-plus/` 为空）。工作区外零改动：
`~/.dsh/profiles/tui-dev/cordis.patch.yml` sha 实测前后一致。未 commit。

## 1. 组合模式开关与 real 实跑

`--composition gate|real`（默认 `gate`）本就存在，本票把 `real` 从「显式 exit 2」换成真实实现。
归档报告：`experiments/regression-gate/results-2026-09-11-real.json`（Q7 的 `results-<date>-<用途>.json`
约定；同日的 `results-2026-09-11.json` 保持票据 03 的 gate 报告不动）。

```
$ bash scripts/regression-gate.sh --tier 0,1,2 --composition real --json experiments/regression-gate/results-2026-09-11-real.json
[PRE] pass   host.cli / host.pin.hostVersion / host.pin.sessionFormatVersion
             composition.real-render — source=~/.dsh/profiles/tui-dev/cordis.patch.yml
               sha256=d6b283d68798 → rendered=<temp>/profiles/tui-dev/cordis.patch.yml
               sha256=d6b283d68798 preset=deployed
[T0]  pass   tsc.noEmit exit 0；npm.test exit 0 tests=132 pass=132 fail=0；testfile.list-consistency 12 files present
[T1]  pass   composition.dump-config exit 0 entries=99
             composition.loader-id-unique in-process ids=99 cli ids=99 duplicates=0
             composition.no-stub
             smoke.anchored-first-turn / smoke.promoted-catalog / degrade.fail-open / seeded-preview.probe
             deployment.repo-matches-manifest / deployment.repo-vs-deployed 8 files ok
             host.pin anchor=0.1.5-rc.1 farm=0.1.5-rc.1 expected=0.1.5-rc.1
             session.format-version runtime=3 manifest=3
             isolation.real-home-untouched / isolation.copy-rewrite-sha
               headless cordis.yml sha256=c300dcf2ebc5 tui-dev cordis.yml sha256=c300dcf2ebc5
             gate.no-deployment-sync no sync invocation in 7 gate sources
             composition.source-profile-unchanged before=d6b283d68798 after=d6b283d68798
[T2]  skip   stub.tier（票据 06/07 落地前显式 skip）
summary: 22 passed, 0 failed, 1 skipped
```

gate 模式回归：`--tier 0,1,2` → `20 passed, 0 failed, 1 skipped`（T1 仍是 14 条，报告 schema 与票据 03 兼容）。
单次 `--tier 0,1` 约 6s；T1 real 组合 99 个 loader id（gate 组合 92 个，差值 = relay-client + endless-* 5 行 +
官方 tool-ask-user / session-reference / file-reference-local 3 行）。

## 2. 渲染规则与物化结果（计划 §2.1）

`gates/composition/render-real.mjs`：

- **源**：`~/.dsh/profiles/tui-dev/cordis.patch.yml`（只读；报告记 `compositionSourceSha`）。
- **三类仓库根**（env 覆盖优先，默认本 checkout + 相邻 checkout）：
  `DSH_PLUGINS_ROOT`（默认 `<repo>`）、`DSH_RELAY_ROOT`（默认 `../dsh-relay`）、
  `DSH_ENDLESS_ROOT`（默认 `../dsh-endless`）。profile 文本里的 `<...>/dsh-plugins/`、`/dsh-relay/`、
  `/dsh-endless/` 前缀按 marker 替换（不写死旧路径，换 checkout/换机器可渲染）。
- **渲染后依赖校验**：解析渲染文本（复用 `gates/dump-parse.mjs` 的 `!!js` schema），逐条
  `id+name` 校验——绝对/相对路径必须存在，裸包名从宿主 installAnchor 解析。任一不可解析 → 抛
  `RenderRealError` → 前置失败 **exit 2**；**不**回落自持组合（T0/T1 均 skip，报告点名缺哪一项）。
- **物化**（实测目录）：

```
<temp home>/
├── .agent-presets/minimal-plus-next/{agent.cordis.yml,preset.yml,*.mjs,node_modules/@deepseek-ai}
├── profiles/tui-dev/{cordis.patch.yml(渲染后), package.json, cordis.yml}
├── profiles/headless/{...}        # 零 LLM 冒烟仍挂 headless 组合
├── settings.yaml                  # 真实 settings 的副本（600，含明文 provider 密钥）
├── sessions/                      # 会话根（SMOKE_SESSION_ROOT）
└── tui-dev-composition.yml        # 渲染产物（dump）
```

- 部署位 preset 存在（`preset.yml` 可读）→ 复制成临时副本（`preset.source="deployed"`），
  smoke/degrade 都从该副本加载（`SMOKE_PRESET_ROOT=$TMP/.agent-presets`）；部署位缺席 → 回落仓库
  preset 副本并在报告里标 `preset.source="repo"`（单测覆盖）。
- real 模式的 CLI 渲染路径改为 `dsh --profile tui-dev --dump-config`（DSH_HOME=临时 home），
  与进程内 `loadProfile("dsh","tui-dev",…) + renderConfigDump` 对照，两条路径分别计数。

## 3. 报告字段（票面「记两份 sha + 标明验的是哪一份」）

`experiments/regression-gate/results-*.json` 新增/改写的字段（实测值取自 real 全绿报告）：

| 字段 | real 实测 | 语义 |
| --- | --- | --- |
| `composition` | `"real"` | 模式开关 |
| `compositionVerified` | `"rendered-copy"` | **本次 T1 加载的那一份**（gate 模式为 `"repo-patch"`） |
| `compositionSourcePath` / `compositionSourceSha` | `~/.dsh/profiles/tui-dev/cordis.patch.yml` / `d6b283d68798…` | 源 profile |
| `compositionRenderedPath` / `compositionRenderedSha` | `<temp>/profiles/tui-dev/cordis.patch.yml` / `d6b283d68798…` | 渲染副本（T1 实际加载） |
| `compositionDumpSha` / `compositionArtifact` | `d6ee4f6badd5…` / `<temp>/tui-dev-composition.yml` | 进程内渲染产物 |
| `compositionEntriesSha` | `5b0206398a53…` | 组合条目哈希 |
| `compositionReal` | `{profile, roots[3], preset{source,stagedPath}, settings{sha}}` | 三类根、preset 来源、settings 副本 sha |

本机默认路径恰好等于 profile 里写死的路径，所以源 sha == 渲染后 sha；用 `DSH_RELAY_ROOT` 指向替代
checkout 实测两者分离：`source=d6b283d68798… → rendered=db5e1058e6e5…`，99 个 id、exit 0（§5）。
gate 模式保持票据 03 的既有语义（`compositionRenderedSha` = dump sha），另补
`compositionVerified="repo-patch"` 与显式路径。

## 4. 零写入真实用户目录 + 源 profile 只读

- `isolation.real-home-untouched`：严格区 `profiles` / `root:settings.yaml` / `deployment:minimal-plus-next` /
  `sessions` 前后指纹一致；`observedChanges: []`、`strictChanges: []`。
- `composition.source-profile-unchanged`（real 专属，T1 第 15 条）：`before == after == d6b283d68798…`；
  工作区外 `ls -la` 亦确认 `mtime` 未变（9月10 23:37）。
- 渲染副本、preset 副本、settings 副本全部只落 700 的 `mktemp -d` 临时 home；默认退出即删。
  **注意**：`--keep-temp` 会把含明文密钥的 `settings.yaml` 副本留在磁盘上，已写进
  `scripts/regression-gate.sh` 的用法注释，属排查专用、需手工删。

## 5. 负向矩阵（real 模式；副本/环境隔离，未动真实部署位与真实 profile）

| 注入 | 命令 | 退出码 | 报告中的红行 |
| --- | --- | --- | --- |
| 相邻 relay checkout 不存在 | `DSH_RELAY_ROOT=/tmp/…/nope` | **2** | `composition.real-render — missing repo checkout(s): relay: /tmp/…/nope; set DSH_RELAY_ROOT` + T1 skip |
| relay 根存在但 `src/client.ts` 缺失 | `DSH_RELAY_ROOT=/tmp/…/empty` | **2** | `rendered profile has 1 unresolvable dependencies: /tmp/…/empty/src/client.ts (missing)` |
| 本仓库根指向空目录 | `DSH_PLUGINS_ROOT=/tmp/…/empty` | **2** | `4 unresolvable dependencies`（startup/index/rename-session/rewind 逐个点名） |
| 同上但只跑 T0 | `--tier 0 --composition real` + 缺 endless | **2** | 前置断言先于分层生效（T0 skip，不静默降级） |
| 替代 checkout 正常解析 | `DSH_RELAY_ROOT=/tmp/gate-alt-04/dsh-relay`（symlink 到真文件） | **0** | 源 sha `d6b283d68798…` ≠ 渲染 sha `db5e1058e6e5…`，99 ids 全绿 |

失败路径的 PRE 计数：`3 passed, 1 failed, 1 skipped`（T1 skip 的 evidence 就是失败原因）。

## 6. 发版接线（票面「release 永不豁免」）

`scripts/release.sh` 在 bump 前、干净树/重复 tag 检查之后：

```bash
# Delivery sequence: explicit preset sync -> this gate -> T3 real-model layer on
# demand -> human sign-off.
scripts/regression-gate.sh --tier 0,1,2 --composition real
```

- 原 `npx tsc --noEmit` / `npm test` 两行删除：闸门 T0 逐条跑同一对命令（更严：多一条
  `testfile.list-consistency`），发版回归从此只有单一入口（计划 §5.1）。
- grep 可证无任何豁免参数：

```
$ grep -n "regression-gate" scripts/release.sh
34:scripts/regression-gate.sh --tier 0,1,2 --composition real
$ grep -nE "allow-stale-deployment|skip-deployment-check|--composition gate" scripts/release.sh
（无输出）
```

- 发版序列（计划 §5.1「交付前推荐序列」已同步写入 release.sh 注释）：
  ① 显式同步部署位（`scripts/sync-agent-presets.sh`，闸门自身绝不代做——`gate.no-deployment-sync` 扫
  7 个闸门源文件守住）→ ② `--tier 0,1,2 --composition real` 全绿 → ③ T3 真实模型层按需 →
  ④ 人工签收。T4b 按 D8 不在序列内。
- 已知副作用（照旧入库）：release 跑闸门会重写 `experiments/regression-gate/results-<date>.json`
  （Q7 的归档约定），发版后该文件呈 dirty，需随报告提交；否则下一次发版的「干净工作树」检查会拦下。

## 7. 顺带修掉的闸门 bug（`--tier 2` 的 skip 被吞）

票据 03 的 `skipPendingTiers(report, tiers)` 把 T2 推入 `report.tiers`，随后 `report.tiers = tiers`
整体覆盖 → **`--tier 2` 声称显式 skip，报告里却什么都没有**（release 现在固定传 0,1,2，必须诚实）。
改为推入局部 `tiers` 数组后：`[PRE, T0, T1, T2]`、`summary {22 passed, 0 failed, 1 skipped}`、
`T2 stub.tier — skip "stub behaviour tier lands with tickets 06/07"`（`--tier 2` 单跑亦可见）。

## 8. 单测与门禁

- 新增 `gates/composition/render-real.test.mjs` 6 条：marker 替换（不误伤 `-dsh-plugins` 子串）、
  `collectModuleNames` 只收 `id` 条目的 `name`、根解析 env 覆盖、端到端渲染（假 home/假 checkout：
  源只读、preset 取部署位、settings 副本）、部署位缺席回落 `source=repo`、三类 `RenderRealError`。
- `npm test` 132/132（126 + 6）；`gates/run.test.mjs` 9 条原样绿；`tsc --noEmit` exit 0；
  `testfile.list-consistency` 12 files present。
- `gate.no-deployment-sync` 扫描面从 6 源扩到 7 源（含 `render-real.mjs`），仍零命中。

## 9. 验收对照

| 票面项 | 结论 | 证据 |
| --- | --- | --- |
| 组合模式开关，默认自持，可切真实 | 成立 | §1 两种模式实跑；`--composition gate|real` 既有开关 |
| real 读源 profile、按 env 渲染三类根、物化隔离 home、源 sha 前后一致 | 成立 | §2 目录；§3 sha；§4 `composition.source-profile-unchanged` |
| 报告记源 sha + 渲染后 sha，并标明验的是哪一份 | 成立 | §3 字段表（`compositionVerified` + 双路径 + 双 sha） |
| 缺相邻仓库 / 渲染后依赖不可解析 → exit 2，不静默降级 | 成立 | §5 负向矩阵 4 例；T1 skip evidence 点名缺项 |
| real 模式真实用户目录零写入 | 成立 | §4 隔离指纹 + 源 sha/mtime |
| release 打包前调 real、命令行无豁免参数 | 成立 | §6 grep 实测；`bash -n` 通过 |
| 发版序列写进文档 | 成立 | 计划 §5.1（已批准施工图）+ release.sh 头注释 §6 |

## 10. 边界与留待后续

- T2 仍显式 skip（票据 06/07）；`--tier 0,1,2` 在 T2 落地前不构成「行为层已验证」。
- real 模式目前验的是**不带 TUI 的 headless 冒烟 + 真实组合导出**：真实 `tui-dev` profile 含
  tui-runner/relay/endless，进程内 boot 需要终端与相邻仓库服务，属 T4b/Q28 的覆盖缺口（D8 已裁定）。
- 报告 schema 在 gate/real 两种模式下对 `compositionRenderedSha` 的语义不同（gate=dump、real=渲染
  profile），已用 `compositionVerified` + 显式路径消歧；如需统一需另开票据改票据 03 的既有口径。
- `gates/run.mjs` 现约 830 行（票据 03 已记录超 300 行建议线），本票未拆。
- 未跑 `release.sh` 本体（红线：它会 bump/commit/tag/推进 stable worktree）；只按 §6 的调用形态实跑
  同一条闸门命令，并做 `bash -n` 语法校验。
- 报告与证据未提交（用户确认后再 commit）。
