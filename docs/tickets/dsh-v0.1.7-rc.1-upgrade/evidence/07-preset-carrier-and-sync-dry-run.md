# 票据 07 验收回填 —— Preset 载体迁移与同步工具 dry-run

生成时间：2026-09-25（宿主 `@deepseek-ai/dsh@0.1.7-rc.1`，会话格式 4）
施工图：`docs/dsh-v0.1.7-rc.1-upgrade-spec.md`（Implementation Decisions：Preset 载体；Testing Decisions：Preset 载体 seam）

## 0. 结论

预设载体已从 0.1.5 的目录形态（`~/.dsh/.agent-presets/<id>/`，C0 ④ 确认 0.1.7 不再读取）
硬切到 0.1.7 声明形态：仓库真源 `presets/minimal-plus/` 生成一个自包含 bundle
（`generated/minimal-plus-preset/`，入库），bundle patch insert
`minimal-plus-agent-preset-registry` + `preset-minimal-plus`（`@deepseek-ai/dsh-agent-preset`）
两行，插件列表逐行搬运 `agent.cordis.yml`（相对插件名改写成 bundle 包子路径）。同步工具改为
「生成 Profile 侧产物 + dry-run 逐文件核对」：默认不写任何真实路径；`--dest` 落 bundle staging，
`--profile <name>` 直接接进 profile（bundle 目录 + node_modules 链接 + `dsh.profile.bundles` 选择）。

闸门结果：T0 全绿（`npm test` 178/178 + tsc 0）、T1 `gate` 18/18、T1 `real` 20/20、T2 51/51，
`--tier 0,1,2 --composition gate` 合计 69/69；部署位仍是 0.1.5 目录形态，窗口内按既有
`--skip-deployment-check` 记账（收口票 12 消除）。

## 1. 生成产物与真源指纹

真源（`presets/minimal-plus/`）不变；生成器 `scripts/agent-preset-bundle.mjs`（CLI
`scripts/agent-preset-bundle-cli.mjs`）输出 10 个文件：

```
$ node scripts/agent-preset-bundle-cli.mjs --check
ok    compaction-epoch.mjs a17cdce7b871
ok    cordis.patch.yml e29ae81cd00c
ok    custom-bash.mjs 8422b4acd6f8
ok    instruction-hint.mjs 4a2a26cb74ee
ok    package.json e478937e5eb6
ok    phase-swap-bash.mjs 8248a7d8aa7f
ok    plugin-teardown.mjs f3f49a4933eb
ok    skill-search.mjs 25eb10fa9d2b
ok    source-manifest.json 79f1b7f351c0
ok    tool-bootstrap.mjs e3e05e677289
agent-preset-bundle: 10 files match generated/minimal-plus-preset
```

`generated/minimal-plus-preset/source-manifest.json` 记录真源逐文件 sha256；最关键的
`agent.cordis.yml` = `8cd01c685032eda95f68ded9b0796f72d0578e9d22a2274fe50aad8435dcc47b`，
与 `gates/manifest.json` 的部署位记录一致（仓库 ↔ 清单未漂移）。`scripts/agent-preset-bundle.test.mjs`
在 `npm test` 里每次再生并与入库产物逐字节比对，漂移即红。

声明形态（`generated/minimal-plus-preset/cordis.patch.yml`）：

```yaml
- insert:
    - id: minimal-plus-agent-preset-registry
      name: '@deepseek-ai/dsh-agent-preset-registry'
      config:
        default: minimal-plus
    - id: preset-minimal-plus
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: minimal-plus
        name: "Minimal+提权+注入"
        description: "..."
        order: 6
        plugins:
          - id: tool-bootstrap
            name: '@dsh-plugins/minimal-plus-preset/tool-bootstrap.mjs'
            config: ...
          - id: phase-swap-bash   # 二轮沙箱 bash 提权
          - id: instruction-hint
          - id: custom-bash
          - id: skill-search
          - id: delegation
            config:
              - id: tool-subagent   # modelSelectionSettings: true
```

验收点 2「自研插件行与委派行、二轮提权不丢」由两层证据覆盖：

- 单测逐行断言 6 个行 id（tool-bootstrap / phase-swap-bash / instruction-hint /
  skill-search / custom-bash / delegation）与 `tool-subagent.modelSelectionSettings: true`
  在生成产物里；`!!js` 表达式与注释按原文搬运。
- T1 冒烟真实挂载后：R2 目录 bash 参数含 `sandbox_permissions`（二轮提权生效）、
  `skill_search`/`skill_load` 出现、二轮 pre-step 注入 `instruction-hint`。

## 2. 仓库根冒烟（验收点 1）

默认路径直接装入库产物（`generated/minimal-plus-preset/`）并让隔离 headless profile 选择它：

```
$ node presets/minimal-plus/smoke-boot.mjs
SMOKE bundle: …/profiles/headless/preset-bundles/minimal-plus-preset (committed artifact)
ROSTER preset: {"id":"minimal-plus","name":"Minimal+提权+注入","description":"…","order":6}
SMOKE preset: minimal-plus
ROUND1 catalog: {"tools":["bash","str_replace_editor"],"bashParams":["command"],…}
ROUND1 pre-step sources: []
ROUND2 catalog: {…,"bashParams":["command","description","timeoutMs","workdir","run_in_background","sandbox_permissions","justification"],…}
WARNINGS: []
ROUND2 pre-step sources: ["agent-instructions","skill-catalog","instruction-hint"]
WARNINGS: []
```

冒烟不读真实 `~/.dsh`：`smoke-boot.mjs` 自建临时 home（`seedHeadlessProfile` 共享骨架 +
fixtures），把 bundle 接进 profile。`SMOKE_PRESET_ROOT` 给出时改为从该真源根现场生成
（degrade 冒烟传改坏副本；闸门 real 模式传真源根）；degrade 的 fail-open 断言由 T1
`degrade.fail-open` 覆盖（R1 全量目录 28 个工具 + warn）。

## 3. 同步工具（验收点 3）

默认 staging 目标（`$DSH_HOME/agent-presets/<id>-preset`）的 dry-run：

```
$ scripts/sync-agent-presets.sh
sync-agent-presets: minimal-plus (bundle @dsh-plugins/minimal-plus-preset) → /Users/vito/.dsh/agent-presets/minimal-plus-preset (dry-run)
  compaction-epoch.mjs     repo:ok   target:-      sha256=a17cdce7b871
  cordis.patch.yml         repo:ok   target:-      sha256=e29ae81cd00c
  …（10 个文件逐一 repo:ok）
sync-agent-presets: dry-run — target absent; nothing written (rerun with --write to deploy)
sync-agent-presets: legacy directory /Users/vito/.dsh/.agent-presets/minimal-plus is no longer read by 0.1.7; removal is deferred to the deployment ticket (needs approval)
```

profile 侧目标（票据 12 的落位路径）在同一工具里，dry-run 会报告 profile 是否已选择 bundle：

```
$ node scripts/sync-agent-presets.mjs --profile tui-dev            # 未选择时 exit 1
sync-agent-presets: profile tui-dev bundles selection: MISSING
sync-agent-presets: dry-run — profile does not select the bundle; rerun with --write to wire it

$ node scripts/sync-agent-presets.mjs --write --profile tui-dev    # 显式写：bundle + 链接 + bundles 选择
sync-agent-presets: wired bundle into profile tui-dev (…/profiles/tui-dev/preset-bundles/minimal-plus-preset)

$ node scripts/sync-agent-presets.mjs --profile tui-dev            # 复核
sync-agent-presets: profile tui-dev bundles selection: selected
sync-agent-presets: dry-run — target already matches (10 files)
```

- `repo:ok` = 现场再生产物与入库产物逐文件 sha 一致；任一漂移会打印 `repo:DRIFT` 并 exit 1。
- 未加 dry-run（含无参数默认）不写任何真实路径：运行后真实 `~/.dsh/agent-presets/` 未创建，
  `~/.dsh/.agent-presets/minimal-plus` 只读探测未触碰。
- 写路径由单测在临时目标位验证：`--dest` 逐文件与入库产物一致、二次 dry-run 报
  `target already matches`、改坏目标位后 dry-run 报 `target:STALE` + exit 1 且不覆写；
  `--profile` 模式验证 bundles 选择、`preset-bundles/` 落位、node_modules 链接，以及
  不存在的 profile 是 exit 2 错误。
- 入口 `scripts/sync-agent-presets.sh` 保留同名、参数透传（旧调用 `<preset>` 仍可用）；
  `release.sh` 已改为显式 `--dry-run` 并注明真实部署归票 12。

## 4. 旧目录形态的退场（验收点 4，按 02 结论）

02 结论是硬切换、无过渡分支（0.1.7 全树零代码引用 `.agent-presets`）。本票把仓库内
**所有运行路径**从旧服务 `@deepseek-ai/dsh-agent-presets` 切到声明行/bundle：

| 位置 | 旧形态 | 新形态 |
| --- | --- | --- |
| `gates/composition/gate.patch.yml` | `gate-agent-presets` 行 + `GATE_PRESET_ROOT` | 删除；`gates/gate-home.mjs` 把生成 bundle 装进临时 headless profile |
| `presets/minimal-plus/smoke-boot.mjs` | insert 旧服务 + repo preset 根 | 自建 home + 装入库产物 / 生成 bundle |
| `gates/stub/stub.patch.yml` + `gates/stub/run.mjs` | `gate-stub-agent-presets` 根 | 删除；runner 的临时 profile 选择生成 bundle |
| `gates/composition/render-real.mjs` | 复制 `.agent-presets` 目录副本 | 摘掉真实 profile 里的旧行 + 生成 bundle 装进渲染 profile |
| `scripts/sync-agent-presets.sh` | 复制目录到 `~/.dsh/.agent-presets` | dry-run 默认的 Profile 侧产物生成器（`--write`/`--profile` 显式） |

仍未迁移、显式记为后续票（不属本票范围）：

- `experiments/m4/m4.patch.yml`、`experiments/subagent-model-selection/{probe,route-probe}.patch.yml`、
  `gates/t3/run.mjs` 的 `.agent-presets` staging：T3 真实模型层当前因宿主/基线代不符整体拒绝运行，
  重采基线归**票 11**（该层会在票 11 一并切载体）。
- `presets/minimal-plus/trajectory.patch.yml`：手工测量工具，与 T3 探针同批（票 11）。
- `scripts/preset-mount-smoke.mjs`：stable 通道（0.1.5 宿主）的部署位 PTY 冒烟，随**票 12**
  的部署位迁移一起改；当前仍按旧目录形态工作。
- 真实部署位 `~/.dsh/.agent-presets/minimal-plus` 仍在磁盘上（只读探测 + 提示），删除需用户批准
  （票 12）。

## 5. 闸门（验收点 5）

```
$ scripts/regression-gate.sh --tier 0,1,2 --composition gate --skip-deployment-check
[T0] pass   tsc.noEmit exit 0；npm.test exit 0 tests=178 pass=178 fail=0；testfile.list-consistency 18 files
[T1] pass   composition.dump-config entries=100 / loader-id-unique duplicates=0 /
            smoke.preset-roster id=minimal-plus name=Minimal+提权+注入 / smoke.anchored-first-turn /
            smoke.promoted-catalog / degrade.fail-open / seeded-preview.probe 10/10 /
            deployment.repo-matches-manifest 9 files match / host.pin / isolation.* / gate.no-deployment-sync
[T2] pass   51/51（bash-first-call、step-batch、promotion-visible、delegation ×2、v3-resume-route）
summary: 69 passed, 0 failed, 0 skipped

$ scripts/regression-gate.sh --tier 1 --composition real --skip-deployment-check
composition.real-render: source ~/.dsh/profiles/tui-dev/cordis.patch.yml → rendered 副本；preset=repo
T1: 20 passed, 0 failed（source-profile-unchanged、real-home-untouched 均过）
```

豁免与遗留：`deployment.repo-vs-deployed` 记为 `absent`（`plugin-teardown.mjs` 未部署 +
4 个文件 stale），按窗口显式 `--skip-deployment-check` 豁免；收口票 12 部署后必须回到零豁免。

**为让闸门在 0.1.7 上跑通而做的门禁修正（行级差异 + 理由）**：

1. `gates/expectations.json` round2 移除 `ralph`：`dsh-base@0.1.7-rc.1` 默认
   `tool-ralph disabled: true`（上游 cordis.patch.yml:444-447，理由：完成是 worker 自述而非独立
   评估）；旧期望录的是 0.1.5 base。JSON 里新增 `changes[]` 记录该行级差异。
2. `gates/stub/inspect.mjs`（`bash-first-call.mjs` 改为复用同一份助手）：tool/result 的调用身份与
   错误位改读 V4 first-class message（`data.message.toolCallId` / `isError`），内容块不再有
   V3 的 `tool-result` 包装（V4 明确拒收）。这是会话格式升级的既有事实，不是载体引入。
3. `gates/stub/scenarios/v3-resume-route.mjs` 的格式前置断言 `resume.format-v3`（期望 3）改为
   `resume.format-current`（期望 4）：0.1.7 新会话直接落 v4；0.1.5 v3 日志的迁移执行归票 10。
4. `presets/minimal-plus/smoke-driver.mjs` 的合成 tool 事件改为合法 V4 生命周期（turn/start →
   step/start → assistant/message（含 tool-call）→ tool/call → tool/result（first-class message）→
   step/end）；旧形状在 V4 持久化时被拒。

## 6. 双轴只读评审判定与处置（2026-09-25）

- Standards（硬规则）：`agent-preset-bundle.mjs` 322 行 / `runSyncCli` 56 行超限 → 拆出 CLI
  (`agent-preset-bundle-cli.mjs`)、抽出 `reportPlan`/`applyPlan`；headless profile 骨架第 4 份复制
  → 收拢到 `scripts/profile-home.mjs`（gate-home / stub runner / smoke 共用），fixtures 复制同源；
  V4 助手两处重复 → `bash-first-call.mjs` 改为复用 `inspect.mjs`；`presetSourceRequirements` 与
  生成器文件清单重复 → 导出 `PRESET_SOURCE_REQUIREMENTS` 单一来源；`--package-name` 与未用导出
  删除；`release.sh` 去掉新工具已不用的 `DSH_HOST_DEPS_DIR=` 前缀。
- Spec（口径）：同步工具原实现只落 staging、profile 从不选择，不满足「生成 Profile 侧产物」→
  新增 `--profile <name>` 模式（同一 `stagePresetBundle` 接线：`preset-bundles/` + node_modules
  链接 + `dsh.profile.bundles` 选择），`--dest` 保留为 staging 安装源；「生成产物在仓库根冒烟
  加载」原先只加载现场再生产物 → smoke 默认路径改为直接装入库产物，入库产物与真源的逐字节相等
  由 `npm test` 常驻断言兜底。
- 保留判定：`renderRealComposition` 仍 75 行（拆分前 93 行的既有编排函数，本票已把新增的 preset
  段落抽出）；`v3-resume-route` 的 id 保留历史命名但头部注明 v4 事实；T3/experiments/trajectory/
  stable PTY 冒烟按 §4 记为 11/12 的后续项。

## 7. 新增/改动文件

- 新增：`scripts/agent-preset-bundle.mjs`（生成器库）、`scripts/agent-preset-bundle-cli.mjs`
  （CLI）、`scripts/agent-preset-bundle.test.mjs`、`scripts/sync-agent-presets.mjs`（sync CLI）、
  `scripts/sync-agent-presets.test.mjs`、`scripts/profile-home.mjs`（隔离 profile 骨架/fixture）、
  `generated/minimal-plus-preset/**`（入库产物）。
- 改动：见 §4 表 + `gates/t1/preset.mjs`（新增 `smoke.preset-roster` 断言）、
  `gates/expectations.json`、`gates/stub/inspect.mjs`、`gates/stub/scenarios/*`、
  `presets/minimal-plus/smoke-{boot,driver}.mjs`、`scripts/{degrade-smoke.sh,release.sh,sync-agent-presets.sh}`、
  `package.json`（新测试入 `npm test`）、`README.md`、`docs/deployment.md`。

## 8. 未提交状态

以上改动全部在工作树，**未 commit**（每票完成停下汇报、用户确认后提交）。
