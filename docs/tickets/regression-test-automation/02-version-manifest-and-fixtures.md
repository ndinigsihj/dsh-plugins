# 02 — 版本清单与基线资产入库

**What to build:** 给闸门准备一个**单一来源的版本清单**与一套自持的测试输入，使闸门能回答「这次结论是对哪套东西下的」以及「宿主升级后哪些基线失效」。清单记录宿主版本、会话格式版本、部署位生产文件的 sha 表、以及各真实模型基线的摘要与采集时的宿主版本。同时把此前依赖用户环境的三样输入固化成仓库资产：最小设置模板（无密钥、无个人 provider）、seeded 预览 fixture 的原样字节快照（含探针顺带读取的父会话基线），并让探针改从临时存储读取、自行创建工作目录——从而使「fixture 被清理导致探针静默失效」不再可能。

**Blocked by:** 01 — 路径可移植性与宿主依赖解析

**Status:** done — 2026-09-11（提交 `b735a49`，已 push）

**Evidence:** `evidence/02-version-manifest-and-fixtures.md`

**施工图:** `docs/regression-test-automation-plan.md` §4.3、§4.4；用户决策 Q5（原样字节快照而非脱敏改写）。

- [x] 版本清单文件入库：宿主版本、会话格式版本、部署位生产文件的 sha 表、真实模型基线摘要（含采集宿主版本与样本量）— `gates/manifest.json`（host 0.1.5-rc.1 / format 3 / 8 文件 sha / 2 条 M4 基线各 9 runs；证据 §1.1）
- [x] 清单被闸门读取时能区分「相符 / 不符 / 缺失」三种状态 — 新增 `gates/manifest.mjs`（清单 ok/missing/invalid；部署位 ok/stale/absent；宿主钉版 ok/mismatch；基线 ok/stale/absent）+ `gates/manifest.test.mjs` 11/11 进 `npm test`；真实环境三态实跑（证据 §1.2/§1.3）
- [x] 最小设置模板入库，不含任何密钥、账号标识或个人 provider 配置 — `gates/fixtures/settings.min.yaml`（正文仅 `llm-deepseek: {}`；敏感词扫描无命中；证据 §3）
- [x] seeded 预览 fixture 以原样字节快照入库（探测确认其红线语义未因搬运而改变） — `experiments/fixtures/session-preview-seeded/store/**`，子/父两会话源 sha 与入库逐字节一致；仓库 fixture 上红线仍抛 seeded 构造错（证据 §2）
- [x] seeded 预览探针改从仓库内 fixture + 临时存储读取，并自行创建其工作目录；探针在无用户环境依赖下全绿 — 探针 apply 时自建临时 store 并逐文件 sha256 双向校验；隔离 `DSH_HOME` 下 10/10、exit 0、真实 profile/sessions 零写；fixture 缺失与真实 store 指向两条路径均 FAIL + exit 1（证据 §4）
- [x] 探针报告写明它使用的是入库 fixture 而非用户真实会话 — 报告 `inputs.fixture.{origin,source,sessionsRoot,userSessionsRead:false,files[].sha256}`（证据 §4）
