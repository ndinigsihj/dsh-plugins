# session-preview-seeded fixture

seeded（rewind/fork）子会话预览探针的入库测试输入（票 02；决策 Q5 = **原样字节快照**，
不做脱敏改写）。

## 内容

`store/` 是 `dsh-session-persistence-jsonl` 会话根的一个最小切片，目录名保持磁盘原样
（`--<normalized-cwd>--` 编码；header 的 `cwd` 为 `/private/tmp/dsh-ticket06-ws3`）。
这不是装饰：后端在读取时用 header 的 `cwd` + id 重算物理路径并校验
（`assertStoredIdentity`），project 目录名必须与 header 一致，否则会话被判定为损坏。

| 会话 | 角色 | 事件 | sha256（原文件 = 入库文件） |
| --- | --- | --- | --- |
| `session-6846f8fa-18eb-4ce8-8f85-4b6a36b37aff` | seeded 子会话（探针红线：`readSession` 必抛） | 68（seq 0..67），`inheritedEventCount=34` | `d68f81ed28409da7962357a4b0a322b01aa4642d2b8c5857eb205022ae48cb0a` |
| `session-4c66af75-ff66-4311-9451-445c8ee3b7f5` | 父会话（探针非断言基线：`readSession` 快路径） | 65（seq 0..64） | `1bca8b63f8461d38c5fa72564748f133f5a55ba487c26545340fb80ea694953e` |

来源：`~/.dsh/sessions/--private-tmp-dsh-ticket06-ws3--/`（票据 06 的 rewind 实跑留存，
2026-09-10）。2026-09-11 由票 02 原样复制，只取 `session.v3.jsonl.zstd`；`session.lock`
是运行期空文件，不入库。逐字节一致性见 `docs/tickets/regression-test-automation/evidence/02-version-manifest-and-fixtures.md` §2。

## 使用

`experiments/session-preview-seeded/run.sh` 启动探针；探针在 apply 时把本目录复制到
临时 session store（`SEEDED_PREVIEW_SESSIONS_ROOT`），复制前后做 sha256 双向校验：

- fixture 缺失 → 探针记录 FAIL 并以非零退出（不再静默失效）；
- 复制后字节不一致 → 同 FAIL；
- 临时根指向真实 `~/.dsh/sessions` → 探针拒绝运行。

探针报告写明输入来自本目录（`inputs.fixture.source` = 仓库相对路径 + 逐文件 sha256），
不读用户真实会话。
