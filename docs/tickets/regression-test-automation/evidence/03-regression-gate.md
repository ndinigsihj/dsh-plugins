# 03 — 回归闸门脚本（静态层 + 零 LLM 组合层）（证据）

日期：2026-09-11。基点 HEAD `e43343a`（票据 08 提交后）。工作区改动：
新增 `gates/{run.mjs,gate-helpers.mjs,unique-ids.mjs,dump-parse.mjs,expectations.json,run.test.mjs}`、
`gates/composition/{gate.patch.yml,subagent-settings.patch.yml}`、
`gates/fixtures/gate-home/{AGENTS.md,skills/gate-fixture/SKILL.md}`、`scripts/regression-gate.sh`、
`experiments/regression-gate/results-2026-09-11.json`（实跑报告）；
修改 `presets/minimal-plus-next/smoke-boot.mjs`、`scripts/degrade-smoke.sh`、`package.json`（test 清单 +1）。
**stable 侧零改动**（`git status --porcelain -- presets/minimal-plus/` 为空）。未 commit。

## 1. 入口与三态（票面 1、2、11）

```bash
scripts/regression-gate.sh [--tier 0,1] [--composition gate|real]
                           [--json <path>] [--skip-deployment-check]
                           [--allow-stale-deployment] [--keep-temp]
```

- 默认报告落 `experiments/regression-gate/results-<UTC 日期>.json`；本票实跑报告：
  `experiments/regression-gate/results-2026-09-11.json`。
- 退出码：`0` 全过 / `1` 任一断言失败 / `2` 环境前置不满足。
- **全绿实跑**（最终代码，含 126 个单测）：

```
$ bash scripts/regression-gate.sh --tier 0,1
[PRE] pass   host.cli / host.pin.hostVersion / host.pin.sessionFormatVersion
[T0]  pass   tsc.noEmit exit 0；npm.test exit 0 tests=126 pass=126 fail=0；testfile.list-consistency 11 files present
[T1]  pass   composition.dump-config exit 0 entries=92
             composition.loader-id-unique in-process ids=92 cli ids=92 duplicates=0
             composition.no-stub
             smoke.anchored-first-turn exit 0 R1=["bash","str_replace_editor"]
             smoke.promoted-catalog tools=29 missing=[] unexpected=[] bashParamsMissing=[] preStepMissing=[]
             degrade.fail-open exit 0 warning=true R1 tools=29
             seeded-preview.probe exit 0 10/10 pass missing=0
             deployment.repo-matches-manifest 8 files match
             deployment.repo-vs-deployed 8 files ok
             host.pin anchor=0.1.5-rc.1 farm=0.1.5-rc.1 expected=0.1.5-rc.1
             session.format-version runtime=3 manifest=3
             isolation.real-home-untouched
             isolation.copy-rewrite-sha cordis.yml sha256=c300dcf2ebc5
             gate.no-deployment-sync no sync invocation in 6 gate sources
summary: 20 passed, 0 failed, 0 skipped
regression-gate: exit=0
```

单次耗时约 5.8s（`--tier 0,1`，含 npm test 与 tsc）。

### 负向矩阵（最终代码，副本 checkout `/tmp/gate-neg-final` 实跑）

| 注入 | 命令 | 退出码 | 报告中的红行 |
| --- | --- | --- | --- |
| group 内两条同 id | `--tier 1` | **1** | `duplicates: negative-dup-group/negative-dup-row` |
| 清单 `hostVersion` 改 9.9.9 | `--tier 0,1` | **2** | `host.pin.hostVersion expected=9.9.9 actual=0.1.5-rc.1` + hint「re-capture the baseline」+ T0/T1 skip |
| 组合注入假模型行 | `--tier 1` | **1** | `stub references: composed[92].name=gates/stub/adapter.mjs, dump:377, dump:379` |
| `expectations.json` 删 `skill_search` | `--tier 1` | **1** | `smoke.promoted-catalog … unexpected=["skill_search"]` |
| 部署位 `preset.yml` 篡改（stale） | `--tier 1` | **1** | `deployment.repo-vs-deployed stale: preset.yml:stale` |
| 同上 + `--allow-stale-deployment` | `--tier 1 --allow-stale-deployment` | **0** | `exempted (stale) …` + `exemptions:[{layer:"deployment-sha",reason:"stale",detail:"preset.yml:stale"}]` + stdout `!!! EXEMPTIONS APPLIED` |
| 部署位目录不存在（absent） | `--tier 1` | **1** | `absent: agent.cordis.yml:absent, …`（8 文件逐个点名） |
| 同上 + `--skip-deployment-check` | `--tier 1 --skip-deployment-check` | **0** | 同上豁免路径（`reason:"absent"`） |
| 删掉清单里列出的 `gates/run.test.mjs` | `--tier 0` | **1** | `testfile.list-consistency missing: gates/run.test.mjs` |
| 锁被活进程持有 | `GATE_LOCK_TIMEOUT=3` | **2** | `lock … still held after 3s (another gate running?)` |
| 锁为陈死 PID | `GATE_LOCK_TIMEOUT=5` | **0** | `removing stale lock held by pid 999999` 后正常跑完 |
| `--composition real`（票据 04 未落） | `--composition real` | **2** | `composition.real real composition mode needs dsh-relay + dsh-endless runtime render` + T0/T1 skip |

两条「为什么必须单独断言」的实测：

- 同一份含重复 id 的组合，`dsh --dump-config` **exit 0**（patch 按 id 覆盖，导出本身不报重复），
  只有 `composition.loader-id-unique` 变红 → 票面「导出本身不检测重复，必须单独断言」。
- 缺一个测试文件时 `npm test` 仍 **exit 0 / tests 117**（Node 多文件模式下静默忽略缺失路径；
  单文件才报 `Could not find`），只有 `testfile.list-consistency` 变红。

## 2. 组合层断言（票面 3、4、8）

**闸门自持组合** `gates/composition/gate.patch.yml`：`dsh-base` bundle + 本仓库四个生产插件
（`lib/startup.ts`、`lib/index.ts`、`plugins/rename-session.ts`、`plugins/rewind-dsh.ts`，相对补丁文件
锚定）+ repo preset 根（`GATE_PRESET_ROOT`，默认 `presets`，`includeUserRoot:false`）。不含
`dsh-relay` / `dsh-endless`（零外部仓库）、不读 `~/.dsh/.agent-presets`（部署位漂移不污染组合断言）。

**逐 id 递归计数** `gates/unique-ids.mjs`：按 `EntryGroup.update` 的真实判定域（同层兄弟）递归进
`group:true` 条目的 `config` 子数组，收集重复。单测 4 条（顶层重复 / 嵌套重复 / 跨 group 同名不冲突 / 计数）。

**零 LLM 冒烟**（`smoke-boot.mjs` + `smoke-driver.mjs`，repo preset 根）：

- R1 工具集合**精确等于** `["bash","str_replace_editor"]`，且 R1 bash 参数不含 `sandbox_permissions`；
- R2 工具集合精确等于 29 项（含 `skill_search`/`skill_load`），bash 参数含 `sandbox_permissions`/`justification`，
  二轮 pre-step 来源含 `agent-instructions`/`instruction-hint`/`skill-catalog`；
- 期望面存 `gates/expectations.json`（宿主换代时先由清单 exit 2 拦下，重采基线时同步更新它）。

**降级路径**：`scripts/degrade-smoke.sh` 改为默认 dev 侧 `minimal-plus-next`，preset id 参数化
（`DEGRADE_SMOKE_PRESET`，stable 手验仍可设 `minimal-plus`），并沿透 `SMOKE_SESSION_ROOT`。
实跑：注入 `__missing__` bootstrap 工具 → `warnOnce "bootstrap disabled, full catalog exposed"` →
R1 全量目录（29 工具）→ 两轮冒烟通过、exit 0。

**seeded 预览探针**：`experiments/session-preview-seeded/run.sh` 在临时根跑，10/10 PASS；
闸门另按 id 白名单核对 7 条断言仍在（含红线 `red-readSession-rejects-seeded`），任何一条被删即红。

**反劫持（Q13）**：结构化扫描组合条目（`provider: stub`、任何指向 `gates/stub` 的字符串）+
CLI dump 文本逐行扫描；负向注入即红（见上表）。

## 3. 部署位一致性与豁免（票面 5、6）

前置断言两条：

- `deployment.repo-matches-manifest`：仓库生产文件 ↔ 清单 sha（`gates/manifest.json`）——读不到部署位也要红；
- `deployment.repo-vs-deployed`：清单 ↔ 部署位，`ok` / `stale` / `absent` 三态，报告逐文件写
  `repo`/`deployed`/`expected` 完整 sha 与 `state`。

默认拒绝；豁免键与状态一一对应（`stale → --allow-stale-deployment`，`absent → --skip-deployment-check`，
用错键无效）。豁免时：**该条断言转 pass**、报告 `exemptions` 数组记录
`{layer:"deployment-sha", reason:"stale"|"absent", detail}`、stdout 打印
`!!! EXEMPTIONS APPLIED (report stays green but this run is NOT a full verification)`。
其余断言逐条结果不变（负向实跑：红→豁免后仅 deployment 一条换状态，16→17 passed）。

## 4. 宿主代与隔离（票面 9、10）

**宿主代**：`host.pin` 同时核对**两个来源**——本仓库解析到的 installAnchor 版本
（`@deepseek-ai/dsh/package.json` 的 realpath + version）与**临时 farm**（`$DSH_HOME/profiles/node_modules`
下解析到的 `@deepseek-ai/dsh`）版本，均须等于清单 `hostVersion`。报告记录两者的绝对路径与版本。
会话格式单独一条 `session.format-version`（运行期 `SESSION_FORMAT_VERSION` = 3 = 清单）。

**隔离**：

- 临时 home（`mktemp -d …/dsh-regression-gate-XXXXXX/home`，`DSH_HOME` + `HOME` 都指过去），
  退出删除（`--keep-temp` 可留）；报告 `copies.profileCordisSha` 记录副本侧被宿主规范化回写的
  `profiles/headless/cordis.yml` sha（本次 `c300dcf2ebc5…`）。
- 真实 `~/.dsh` 前后指纹比对：严格区 `profiles`、`root:settings.yaml`、`deployment:minimal-plus-next`、
  `sessions`（只数条目）；`storages` 标记 `strict:false` 只记录不判红（活跃 TUI 会话会合法写投影缓存，
  避免闸门假红），两类变化都进报告 `isolation`。本次实跑 `observedChanges: []`、`strictChanges: []`。
- 隔离 home 里的二轮注入来源由 `gates/fixtures/gate-home/` 提供（user-global `AGENTS.md` +
  `skills/gate-fixture/SKILL.md`）：不复制则 `agent-instructions`/`skill-catalog` 在隔离 home 下恒缺席，
  断言会退化成「读真实用户家目录」。fixture 正文声明为惰性占位（该 AGENTS.md 仅服务于冒烟）。

**串行锁**：`$REPO/.git/dsh-regression-gate.lock`（计划 §2.2），原子 `mkdir` + PID；
无 `.git` 的 checkout（CI 导出）退化为 `$TMPDIR/dsh-regression-gate-<repo 路径哈希>.lock`；
活锁超时 exit 2、死锁自动清理（均实跑，见 §1）。

**不自同步**：`gate.no-deployment-sync` 扫描闸门自身 6 个源文件，剥离注释行后不得出现部署同步脚本名；
同步仍是显式 `scripts/sync-agent-presets.sh`（本轮未改该脚本，也未改 `release.sh`——发版接线属票据 04）。

## 5. 报告 schema（票面 7）

`experiments/regression-gate/results-2026-09-11.json` 字段核对（脚本化）：`gateVersion`、
`startedAt`/`finishedAt`、`gitHead`+`gitDirty`、`hostVersion`、`sessionFormatVersion`、`composition`、
`compositionSourceSha`/`compositionRenderedSha`、`deployment{status,files{repo,deployed,expected,state}}`、
`tiers[]{id,status,startedAt,durationMs,assertions[]{id,status,evidence,detail}}`、`exemptions`、
`summary{passed,failed,skipped}`、另有 `host`（anchor+farm）、`isolation`、`copies`、`smoke`、
`seededPreview` 明细；全部断言均带非空 `evidence`。

```
gateVersion 1 / hostVersion 0.1.5-rc.1 / sessionFormatVersion 3 / composition gate
compositionSourceSha a8fb9b41ce38… / compositionRenderedSha 8fa1112c7b9d…
summary {passed: 20, failed: 0, skipped: 0} exemptions []
```

## 6. 锚点设计（本票新增，均为计划字面外的必要小件）

| 件 | 为什么必须 |
| --- | --- |
| `gates/composition/subagent-settings.patch.yml` | `minimal-plus-next` 的 `delegation/tool-subagent` 开了 `modelSelectionSettings: true`，宿主作用域缺 `@deepseek-ai/dsh-tool-subagent/model-selection-settings` 时 preset 挂不起来（2026-09-11 实测）；闸门组合断言与零 LLM 冒烟分别加载它（后者经 `SMOKE_EXTRA_PATCHES` 在 repo 原位加载） |
| `smoke-boot.mjs` 的 `SMOKE_SESSION_ROOT` / `SMOKE_EXTRA_PATCHES` / `includeUserRoot:false` | 会话根落临时 home；追加宿主行；不再扫真实 `~/.dsh/.agent-presets` |
| `scripts/degrade-smoke.sh` 参数化 + 副本 `node_modules` 链接 | 默认 dev preset；preset 自研 `.mjs` 的裸包名导入在仓库外副本需要解析回退（真实部署位靠 farm 提供同一层） |
| `gates/dump-parse.mjs` | `--dump-config` 是**另一条**渲染路径（CLI → `prepareProfile`），与进程内 `composeEntries` 分别计数才能抓「CLI 渲染漂移」；`!!js` tag 需补 schema，`js-yaml` 从 app-boot 安装位置解析 |
| `gates/gate-helpers.mjs`、`gates/unique-ids.mjs` | 断言/报告/子进程/稳定哈希与递归 id 判定的单一来源，便于单测钉住 |

## 7. 验收对照

| 票面项 | 结论 | 证据 |
| --- | --- | --- |
| 单一入口跑 T0+T1，全绿 exit 0 | 成立 | §1 实跑（20/20，5.8s） |
| 破坏断言 exit 1；宿主/格式不符 exit 2 并提示重采 | 成立 | §1 负向矩阵 6 例 exit 1、1 例 exit 2（含 hint） |
| 配置导出 exit 0 且逐 loader id 递归计数 = 1 | 成立 | `composition.dump-config` + `composition.loader-id-unique`；嵌套重复负向；导出不报重复的对照 |
| 冒烟工具集合与首轮锚定符合期望；降级通过；seeded 全绿含红线 | 成立 | R1/R2 精确集合断言 + `expectations.json`；`degrade.fail-open`；`seeded-preview.probe` 10/10 + 白名单 |
| 部署位前置断言，「陈旧/缺席」分别表达、默认拒绝、各自可豁免 | 成立 | §3 + 负向矩阵 stale/absent 与两种豁免 |
| 豁免入报告 + 终端醒目警告；不影响其余断言 | 成立 | §3；负向实跑仅 deployment 一条换状态 |
| 结构化报告落实验目录、带日期、字段齐全 | 成立 | §5；`experiments/regression-gate/results-2026-09-11.json` |
| 组合中不出现假模型 provider / 模块路径 | 成立 | `composition.no-stub` + 负向注入红 |
| 依赖树宿主版本 = 清单；持锁运行 | 成立 | `host.pin`（anchor + farm）；锁三态实跑 |
| 真实用户目录零写入；报告记副本侧回写 sha | 成立 | `isolation.real-home-untouched`（严格区全同）+ `copies.profileCordisSha` |
| 闸门不自动同步部署位 | 成立 | `gate.no-deployment-sync` 扫 6 源文件 |

## 8. 边界与留待后续

- `--composition real` 按票据 04 落地；现在显式 exit 2（不静默降级）。`release.sh` 接线同属票据 04。
- T2 stub 行为层未落地：`--tier 2` 显式 skip（报告可见），不假装绿；票据 06/07 承接。
- README 的闸门用法与 CI workflow 属票据 09；本轮未动 README。
- 报告与票据证据均未提交（用户确认后再 commit）；`gates/run.mjs` 现 746 行，超出 CLAUDE.md 的
  300 行建议，但与本仓库既有大文件（`lib/index.ts`）同量级，如需拆分建议作为独立整理项。
- 单测新增 `gates/run.test.mjs` 9 条（`npm test` 126 全绿）；stable 侧测试与文件零改动。
