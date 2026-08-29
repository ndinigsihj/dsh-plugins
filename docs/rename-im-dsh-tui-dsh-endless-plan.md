# 改名计划：TUI 包名 im-dsh-tui + endless-dsh → dsh-endless

> 日期：2026-08-29
> 状态：待确认后执行（dev 先行，验证后 stable）
> 用户已确认：
> - dsh-plugins 仓库名（目录/GitHub repo）**保留**，只改 TUI 包名；
> - TUI 包名定为 **`im-dsh-tui`**（npm 可注册，避免与社区 `dsh-tui` 重名）；
> - endless-dsh 改为 **`dsh-endless`**（目录 + GitHub repo + package.json 全改）；
> - 三个仓库计划后续 push 到 GitHub（个人账号 `ndinigsihj`）。

## 1. 总览

| 仓库 | 改什么 | 不改什么 |
| --- | --- | --- |
| `dsh-plugins`（dev） | package.json / package-lock.json 包名 `dsh-tui` → `im-dsh-tui`；README、ARCHITECTURE、根 `cordis.patch.yml` 中自研 bundle 标识同步 | 仓库目录仍叫 `dsh-plugins`；部署 profile 的绝对路径不变 |
| `endless-dsh` | 目录 → `dsh-endless`；package.json / package-lock.json 包名；内部 row id、绝对路径、README/DESIGN/docs、测试 fixture 路径 | 代码逻辑不变 |
| `dsh-relay` | 只改对 endless-dsh 的引用（文档 + smoke profile 路径） | 包名/目录不变 |
| 部署 `~/.dsh/profiles/*` | 仅 endless-dsh 相关 5 条挂载路径（tui / tui-dev / tui-central 各 5 条） | TUI 挂载路径不变（因为 dsh-plugins 目录没改） |

## 2. 阶段 A：dsh-plugins TUI 包名改 `im-dsh-tui`

### 2.1 修改清单

| 文件 | 改动 |
| --- | --- |
| `package.json` | `"name": "dsh-tui"` → `"im-dsh-tui"` |
| `package-lock.json` | 根 name 与 lock 内包 name（第 2/8 行附近）→ `im-dsh-tui` |
| `README.md` | 标题与 bundle 标识 `dsh-tui/startup` / `dsh-tui` → `im-dsh-tui/startup` / `im-dsh-tui` |
| `cordis.patch.yml`（仓库根） | `name: 'dsh-tui/startup'` / `name: 'dsh-tui'` → `im-dsh-tui/...` |
| `ARCHITECTURE.md` | 自研 bundle/包标识 `dsh-tui` → `im-dsh-tui`（**不动**第三方 `@deepseek-harness-tui/dsh-tui`） |

### 2.2 明确不替换

- `@deepseek-harness-tui/dsh-tui`（第三方）全部保留；
- docs 里作为“自研 TUI”泛称的 `dsh-tui` 字样，若指产品概念而非包名，可保留或按语境改名，避免大范围误伤；
- `docs/deployment.md` 里的 shell alias `dsh-tui='dsh --profile tui'` 是命令别名，与包名无关，默认保留（可选一并改）。

### 2.3 影响面

- 部署 profile 使用绝对路径 `/Users/vito/data/dev/dsh-plugins/lib/...`，不依赖包名 → **无需改 `~/.dsh/profiles/*`**；
- stable 快照 `dsh-plugins-stable` 同样有 `package.json`/README/`cordis.patch.yml`，在阶段 C（stable）同步同样的改法。

### 2.4 验证（dev）

1. `npm test`（53 用例）全绿；
2. `npx tsc --noEmit` 通过；
3. `dsh --profile tui-dev` 启动正常，TUI 可交互。

## 3. 阶段 B：endless-dsh → dsh-endless

### 3.1 目录与包名

| 文件/目录 | 改动 |
| --- | --- |
| 目录 | `/Users/vito/data/dev/endless-dsh` → `/Users/vito/data/dev/dsh-endless`（git mv 语义，提交时呈现为 rename） |
| `package.json` | `"name": "endless-dsh"` → `"dsh-endless"` |
| `package-lock.json` | 根 name 与 lock 内包 name → `dsh-endless` |
| `README.md` / `DESIGN.md` / `docs/*` | 标题与正文 `endless-dsh` → `dsh-endless`（代码逻辑内容不动） |
| `cordis.patch.yml`、`profile/cordis.patch.yml` | row id `endless-dsh/storage-plugin` 等 → `dsh-endless/...`；内部绝对路径 `/Users/vito/data/dev/endless-dsh/...` → `/Users/vito/data/dev/dsh-endless/...` |
| `src/*.test.ts` 等测试 fixture | `/Users/vito/data/dev/endless-dsh` → `/Users/vito/data/dev/dsh-endless`（纯字符串替换，约 20 处） |

### 3.2 关联仓库/部署更新（与目录改名同一批完成）

| 位置 | 改动 |
| --- | --- |
| `~/.dsh/profiles/tui/cordis.patch.yml` | 5 条 `/Users/vito/data/dev/endless-dsh/src/...` → `/Users/vito/data/dev/dsh-endless/src/...` |
| `~/.dsh/profiles/tui-dev/cordis.patch.yml` | 同上 5 条 |
| `~/.dsh/profiles/tui-central/cordis.patch.yml` | 同上 5 条 |
| `dsh-plugins` 内 docs | `docs/multi-device-fleet-design.md`、`docs/session-list-delete-design.md`、`docs/rc8-capability-assessment.md` 中 `endless-dsh` → `dsh-endless` |
| `dsh-relay` | `README.md`、`DESIGN.md`、`docs/deploy-hub-signer.md`、`src/*` 注释、`profiles/relay-client-smoke/cordis.patch.yml`（路径 `/Users/vito/dev/endless-dsh/...` → `/Users/vito/dev/dsh-endless/...`） |

### 3.3 注意：endless-dsh 没有独立 stable 快照

当前 tui / tui-central（stable 通道）也直接挂载 `/Users/vito/data/dev/endless-dsh/...` 这个 dev 路径，没有 endless 的 stable 工作树。因此：

- 目录改名和三个 profile 的路径更新必须**同一批完成**，否则改名瞬间 stable profile 会挂；
- 完成后先 `dsh --profile tui-dev` 验证 endless storage/capture/distill/inject/tools 正常，再日常使用 tui；
- 如果想严格隔离，可以另建 `dsh-endless-stable` 快照再分批切，但当前没有这个快照，优先级低。

### 3.4 验证（dev）

1. `cd /Users/vito/data/dev/dsh-endless && npm test && npx tsc --noEmit`；
2. `dsh --profile tui-dev` 启动，检查 endless 五件套无加载错误；
3. `dsh-relay` 的 smoke profile 若用到，顺带验证路径解析。

## 4. 阶段 C：push 到 GitHub（后续）

三个仓库当前均无 git remote。待改名验证通过、用户确认后：

| 仓库 | 建议 GitHub repo |
| --- | --- |
| `dsh-plugins` | `ndinigsihj/dsh-plugins`（保留名） |
| `dsh-relay` | `ndinigsihj/dsh-relay` |
| `dsh-endless`（改后） | `ndinigsihj/dsh-endless` |

执行时需用户提供/确认：

- GitHub 仓库是否已创建（或由我们提供 gh 命令创建，需确认 gh 已登录）；
- 仓库 public / private；
- 本地 remote 名称（默认 `origin`）。

push 前不合并 stable；push 属于用户明确批准后的动作。

## 5. 执行顺序与回滚

1. 阶段 A（dev TUI 包名）→ 验证 → 提交；
2. 阶段 B（endless 改名 + 所有引用）→ 验证 → 三个仓库分别提交；
3. stable（dsh-plugins-stable）同步阶段 A 的包名改动（用户验证 dev 后执行）；
4. 阶段 C（push）等用户指令。

回滚：目录改名用 `git mv` 反向即可；profile 路径批量替换前先备份（或依赖 git 历史）；若启动失败，`git checkout` 恢复对应仓库 + 手工还原 `~/.dsh/profiles/*` 三份路径。