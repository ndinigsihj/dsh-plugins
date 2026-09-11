# 02 — 版本清单与基线资产入库（证据）

日期：2026-09-11。基点 HEAD `7f837ea`（票据 01 提交后）。工作区改动：
新增 `gates/manifest.json`、`gates/manifest.mjs`、`gates/manifest.test.mjs`、
`gates/fixtures/settings.min.yaml`、`experiments/fixtures/session-preview-seeded/**`；
修改 `experiments/session-preview-seeded/{probe.mjs,probe.patch.yml,run.sh}` 与 `package.json`
（test 清单 +1 行）。**stable 侧零改动**（`git status --porcelain -- presets/minimal-plus/` 为空），
未 commit。

## 1. 版本清单与三态（票面 1、2）

### 1.1 清单内容（`gates/manifest.json`，`gateVersion: 1`）

| 键 | 记录 | 实据 |
| --- | --- | --- |
| `hostVersion` | `0.1.5-rc.1` | 全局宿主 `@deepseek-ai/dsh/package.json` → `0.1.5-rc.1`；`dsh --version` 同 |
| `sessionFormatVersion` | `3` | 运行期 `@deepseek-ai/dsh-session` 的 `SESSION_FORMAT_VERSION` = 3；fixture 物理文件名 `session.v3.jsonl.zstd` |
| `deployment["minimal-plus-next"]` | `path: ~/.dsh/.agent-presets/minimal-plus-next` + 8 个生产文件 sha256 | 与 `scripts/sync-agent-presets.sh` 的部署清单一一对应；当前 **repo == deployed**（§1.3） |
| `baselines["m4-upgrade-only-2026-09-10"]` | `path`、`sha256 2fc45393…`、`hostVersion 0.1.5-rc.1`、`runs 9`、`model opencode-go/deepseek-v4-flash`、`preset minimal-plus-next`、`capturedAt 2026-09-10T12:11:52.000Z` | 文件 10 行 = 表头 + 9 跑；表头逐字段含 `runs=9 model=… (dsh 0.1.5-rc.1 …)` |
| `baselines["m4-deduped-2026-09-10"]` | 同上，`sha256 c2d4ef22…`、`capturedAt 2026-09-10T14:25:33.000Z` | 同上（票据 10 批次） |

### 1.2 三态读取（`gates/manifest.mjs`）

纯函数 + 只读 fs，闸门（03）直接消费；三态语义：

| 对象 | 相符 | 不符 | 缺失 |
| --- | --- | --- | --- |
| 清单文件 | `readManifest` → `ok` | JSON 坏 / 结构缺字段 / sha 非 hex → `invalid` | 文件不存在 → `missing` |
| 部署位逐文件（仓库 ↔ 清单 ↔ 部署位） | `state: ok`（另带 `repoMatches`） | `state: stale` | `state: absent`（文件或缺整个目录） |
| 宿主钉版 | `checkHostPin` → `ok`（逐字段） | `mismatch` | —（运行值必在） |
| 真实模型基线文件 | `checkBaselines` → `ok` | `stale` | `absent` |

单测 11/11（`gates/manifest.test.mjs`；用 tmpdir 伪造仓库与家目录部署位）：

```
$ node --test gates/manifest.test.mjs
# tests 11
# pass 11
# fail 0
```

### 1.3 真实环境三态演示

相符（真实仓库 + 真实部署位 + 真实宿主模块常量）：

```
manifest: ok gateVersion 1
deployment: ok [["agent.cordis.yml","ok",true],["preset.yml","ok",true],
  ["compaction-epoch.mjs","ok",true],["phase-swap-bash.mjs","ok",true],
  ["tool-bootstrap.mjs","ok",true],["instruction-hint.mjs","ok",true],
  ["skill-search.mjs","ok",true],["custom-bash.mjs","ok",true]]
baselines: ok [["m4-upgrade-only-2026-09-10","ok",9],["m4-deduped-2026-09-10","ok",9]]
host pin: ok [{"id":"hostVersion","expected":"0.1.5-rc.1","actual":"0.1.5-rc.1","status":"ok"},
              {"id":"sessionFormatVersion","expected":3,"actual":3,"status":"ok"}]
```

不符 / 缺失（把真实部署位复制到 `/tmp/dsh-tamper-home` 后篡改，再对真实清单比对）：

```
A) 全相符: ok 0 处异常
B) 改 preset.yml:      stale [["preset.yml","stale"]]
C) 删 custom-bash.mjs: absent [["preset.yml","stale"],["custom-bash.mjs","absent"]]
```

清单更新纪律：`manifest.test.mjs` 最后一条对**真实清单**跑仓库侧比对
（`repoMatches` 与基线 sha），preset/基线改动而清单不更新时会变红。

## 2. fixture 原样字节快照（票面 4）

入库内容（Q5 原样字节，不做脱敏改写）：

| 会话 | 角色 | 事件 | 字节 | sha256（源 = 入库） |
| --- | --- | --- | --- | --- |
| `session-6846f8fa-…` | seeded 子会话（红线） | 68（seq 0..67），inherited 34 | 47594 | `d68f81ed28409da7962357a4b0a322b01aa4642d2b8c5857eb205022ae48cb0a` |
| `session-4c66af75-…` | 父会话（非断言基线） | 65（seq 0..64） | 43802 | `1bca8b63f8461d38c5fa72564748f133f5a55ba487c26545340fb80ea694953e` |

来源 `~/.dsh/sessions/--private-tmp-dsh-ticket06-ws3--/`（票据 06 留存）；只复制
`session.v3.jsonl.zstd`（`session.lock` 为运行期 0 字节文件，不入库）。逐字节一致：

```
$ shasum -a 256 <源>/<id>/session.v3.jsonl.zstd <入库>/.../session.v3.jsonl.zstd
d68f81ed…  equal=yes
1bca8b63…  equal=yes
```

目录名保持 `--private-tmp-dsh-ticket06-ws3--`：持久化后端用 header 的 cwd + id 重算物理路径
并校验（`assertStoredIdentity`），改动目录名会判定会话损坏。**红线语义未因搬运改变**：
探针在入库 fixture 上仍得到

```
PASS red-readSession-rejects-seeded {"error":"seeded session constructor seed must equal its inherited prefix"}
PASS listEvents-has-corpus {"events":68,...}
PASS green-count-and-seq-match {"events":68,"records":68,"firstSeq":0,"lastSeq":67}
PASS green-inherited-count-recorded {"inheritedEventCount":34}
PASS baseline-readSession-fastpath {"events":65,...}
```

fixture 原 cwd（`/private/tmp/dsh-ticket06-ws3`）已删；实测读写路径不依赖它（`stat` 按
header cwd 的编码目录全局扫描），故探针不重建该目录。

## 3. 最小设置模板（票面 3）

`gates/fixtures/settings.min.yaml` 正文仅 `llm-deepseek: {}`（其余为注释）：

```
$ grep -nEi "key|token|secret|baseurl|provider|api|@|displayname|password" gates/fixtures/settings.min.yaml
3:# 刻意不含任何 API key、账号标识或个人 provider 配置：…   ← 仅注释命中
7:# 实测：seeded 预览探针在此文档下 10/10 通过…
```

无密钥、无账号标识、无个人 provider；seeded 探针在该模板下的临时副本上 10/10 通过（§4）。

## 4. 探针去用户环境依赖（票面 5、6）

改动后的输入链：

```
run.sh：临时根 $SEEDED_PREVIEW_ROOT（默认 ${TMPDIR:-/tmp}/dsh-seeded-preview，先清后建）
        ├─ 复制 gates/fixtures/settings.min.yaml → <根>/settings.yaml（不再复制 ~/.dsh/settings.yaml）
        └─ export SEEDED_PREVIEW_{ROOT,SESSIONS_ROOT,SETTINGS} + PROBE_OUT
probe.patch.yml：settings.path / session-persistence-jsonl.root 用
        `!!js process.env.X ?? '<默认>'`（预算内票 01 机制）；不再指向真实 store
probe.mjs：apply 时自建 <根>/sessions，把仓库 fixture 原样复制进去，逐文件 sha256
        双向校验；报告写明输入来源；指向真实 ~/.dsh/sessions 的配置直接拒绝
```

实跑（隔离 `DSH_HOME=/tmp/dsh-seeded-preview-home`，headless profile 副本）：

```
PASS fixture-store-prepared {"source":"experiments/fixtures/session-preview-seeded/store",
     "sessionsRoot":"…/dsh-seeded-preview/sessions","files":2}
PASS fixture-copied-byte-identical {"files":["…session-4c66af75… 1bca8b63f846… 43802B",
                                             "…session-6846f8fa… d68f81ed2840… 47594B"]}
PASS red-readSession-rejects-seeded … PASS baseline-readSession-fastpath {"events":65,…}
session-preview-seeded probe: 10/10 pass report=…/probe.json
seeded-preview probe exit=0
```

**真实用户目录零写**（同一跑前后对比）：

```
real profile sha: c300dcf2… -> c300dcf2…
real sessions dirs: 20 -> 20
```

失败路径也实测为「响铃」而非静默：

| 情形 | 结果 |
| --- | --- |
| 临时根指向真实用户 store（`$HOME/.dsh/sessions`） | `FAIL fixture-store-prepared {"error":"refusing to run against the real user session store: …"}`，exit 1，报告 0/1 |
| 仓库 fixture 缺失（把探针复制到无 fixture 的目录） | `FAIL … {"error":"repo fixture store is missing: …"}`，exit 1，报告 0/1 |

报告字段（节选 `probe.json`）——票面「写明使用的是入库 fixture 而非用户真实会话」：

```json
"inputs": { "fixture": {
  "origin": "repository raw-byte snapshot (ticket 02 / Q5)",
  "source": "experiments/fixtures/session-preview-seeded/store",
  "sessionsRoot": "…/dsh-seeded-preview/sessions",
  "userSessionsRead": false,
  "files": [ { "path": "…/session-4c66af75…/session.v3.jsonl.zstd", "bytes": 43802,
               "sha256": "1bca8b63…", "copiedByteIdentical": true }, … ] } }
```

留待后续（非本票）：宿主 profile 规范化回写（finding 01-2）在**默认** `DSH_HOME` 下仍会写真实
`~/.dsh/profiles/headless/cordis.yml`——本票验收一律用隔离副本证明零写，闸门级隔离 home 属票据 03；
报告默认落临时根、跨轮覆盖的归档规范化属票据 03/05。

## 5. 静态层回归

```
$ npx tsc --noEmit   → exit 0
$ npm test           → tests 108 / pass 108 / fail 0   （原 97 + manifest 11）
```

`package.json` 仅 test 清单追加 `gates/manifest.test.mjs`；新增/改动文件中无本机绝对路径
（`grep -rn "/Users/" gates/ experiments/fixtures experiments/session-preview-seeded` 零命中）。

## 6. 验收对照

| 票面项 | 结论 | 证据 |
| --- | --- | --- |
| 版本清单入库（宿主/格式/部署 sha 表/基线摘要） | 成立 | §1.1、§1.3 |
| 闸门读取可区分「相符 / 不符 / 缺失」 | 成立 | §1.2 单测 11/11、§1.3 三态实跑 |
| 最小设置模板，无密钥/账号/个人 provider | 成立 | §3 |
| fixture 原样字节快照，红线语义未变 | 成立 | §2 |
| 探针读仓库 fixture + 临时存储、自建工作目录、无用户环境依赖全绿 | 成立 | §4（10/10、零写、两条 FAIL 路径） |
| 探针报告写明用入库 fixture 而非真实会话 | 成立 | §4 报告字段 |
