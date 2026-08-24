# 使用/开发版本分离部署设计

> 背景：v0.1.2 起，本仓库 TUI 成为日常开发工具，同时仍在持续迭代。当前
> `~/.dsh/profiles/tui/cordis.patch.yml` 以绝对路径直挂本仓源文件，日常工具与
> 开发工作树是同一份磁盘内容——任何半成品编辑立即进入日常使用。本文定稿
> 「使用版本」与「开发版本」的分离机制。

## 1. 结论

| 问题 | 决策 |
|---|---|
| 隔离机制 | git worktree 快照树：`~/opt/dsh-plugins` 检出发布 tag（detached HEAD） |
| 日常入口 | `dsh --profile tui` —— 路径全部改指部署树，只在打 tag 时前进 |
| 开发入口 | `dsh --profile tui-dev` —— 新 profile，路径保持指向 `/Users/vito/data/dev/dsh-plugins` |
| 发布动作 | `scripts/release.sh <version>`：校验 → bump → commit → tag → 切部署树 → 刷新依赖 |
| 回滚 | `git -C ~/opt/dsh-plugins checkout <旧tag>`，一条命令 |
| `endless-tui` | 不动（旧社区 TUI profile，仅存档） |

依据：插件为纯 TS、cordis loader 直接加载，无构建产物——「部署」就是
「把干净快照放到另一处磁盘路径」。worktree 与 dev 仓共享对象库，
切版/回滚零拷贝秒级完成；detached-at-tag 语义即"使用版本"本身。

## 2. 目录布局

```
/Users/vito/data/dev/dsh-plugins     # 开发工作树（main），随时可脏
~/opt/dsh-plugins                    # 部署快照（worktree, detached at tag）
~/.dsh/profiles/tui/                 # 日常：4 处路径指 ~/opt/dsh-plugins/...
~/.dsh/profiles/tui-dev/             # 开发：同构 patch，路径指 dev 仓
```

部署树首次创建：

```bash
git -C /Users/vito/data/dev/dsh-plugins worktree add --detach ~/opt/dsh-plugins v0.1.2
cd ~/opt/dsh-plugins && npm i --omit=dev && scripts/link-global-dsh.sh
```

此后升级 host（`npm i -g @deepseek-ai/dsh`）后只需重跑 link 脚本（幂等）。

## 3. profile 变更明细

`tui` 与 `tui-dev` 的 patch 同构，唯一差异是 dsh-plugins 四个挂载点的基路径；
其余插件（dsh-relay、endless-*）不在本仓范围，两个 profile 都维持原路径不动。

| 挂载点 | tui（日常 → 部署树） | tui-dev（开发 → 工作树） |
|---|---|---|
| tui-startup | `~/opt/dsh-plugins/lib/startup.ts` | `/Users/vito/data/dev/dsh-plugins/lib/startup.ts` |
| tui-runner | `~/opt/dsh-plugins/lib/index.ts` | `/Users/vito/data/dev/dsh-plugins/lib/index.ts` |
| tui-rename-session | `~/opt/dsh-plugins/plugins/rename-session.ts` | `.../dev/dsh-plugins/plugins/rename-session.ts` |
| dsh-rewind | `~/opt/dsh-plugins/plugins/rewind-dsh.ts` | `.../dev/dsh-plugins/plugins/rewind-dsh.ts` |

`tui-dev` 创建方式：`cp -R ~/.dsh/profiles/tui ~/.dsh/profiles/tui-dev` 后按上表
改回 dev 路径（profile 仅 3 个文件、无本地 node_modules，复制成本可忽略）。

版本肉眼校验：banner 版本号读自所在树的 package.json——日常窗口显示已发布
tag 版本，开发窗口显示工作树版本。

## 4. scripts/release.sh 规范

用法：`scripts/release.sh <version>`（如 `0.1.3`）。步骤：

1. 前置校验：工作区干净、`npx tsc --noEmit` 通过。
2. `package.json` version 改为 `<version>`，commit（`Release v<version>`）并打附注 tag。
3. 部署树不存在则先 `worktree add --detach ~/opt/dsh-plugins v<version>`；存在则 `checkout v<version>`。
4. 若 lockfile 相对上一检出有变化：部署树内 `npm i --omit=dev`；无条件重跑 `scripts/link-global-dsh.sh`（幂等，覆盖 host 升级场景）。
5. 打印结果行：`stable = ~/opt/dsh-plugins @ v<version>`；提示运行中的 TUI 需退出重启（或 /resume 重进）才吃到新代码。

边界约定：

- 脚本不 push（仓库无 remote）；不触碰 profile 文件（路径一次性配好后不变）。
- 中途失败即停（set -euo pipefail）；tag 已打而 checkout 失败时，手动
  `git -C ~/opt/dsh-plugins checkout <tag>` 补齐即可，脚本幂等可重跑。

## 5. 启动入口约定（shell 侧，自行配置）

```bash
alias dsh-tui='dsh --profile tui'      # 日常稳定版
alias dsh-tui-dev='dsh --profile tui-dev'  # 开发工作树
```

调试习惯随之收敛：stderr 重定向排查一律在 tui-dev 里做。

## 6. 边界与非目标

- **代码隔离 ≠ 状态隔离**：两个 profile 共享会话存储、settings、skills 与 endless
  记忆层——有意保留，`/resume <id>` 可跨 profile 取回会话；不做 DSH_HOME 级隔离。
- 不引入包管理器打包（npm pack / file: 依赖）：快照藏在 node_modules 里难检查、
  pnpm file: 是软链隔离无效。
- 将来有 remote：部署树换独立 clone + `release` 分支即可，profile 路径零改动。

## 7. 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| 忘记跑 release.sh 直接改了部署树 | 稳定版被污染 | worktree 处于 detached HEAD，任何改动都会在下次 checkout 时暴露冲突而非静默覆盖 |
| 部署树 node_modules 漂移（host 升级后） | 启动失败或行为错乱 | release.sh 每次 checkout 无条件重跑 link 脚本；link 脚本自带全局树存在性校验 |
| 两 profile 行为差异被误判为 bug | 排查绕路 | banner 版本号 + profile 名双确认；文档固定此口径 |

## 8. 实施清单

| # | 动作 | 验证 |
|---|---|---|
| 1 | 写入本文档并提交 | — |
| 2 | 创建 worktree + 部署树依赖 | 部署树内 tsc 通过、banner 显示 tag 版本 |
| 3 | 改 `tui/cordis.patch.yml` 四处路径 | `dsh --profile tui` 启动正常 |
| 4 | 复制建 `tui-dev` 并指回 dev 树 | `dsh --profile tui-dev` 启动正常，改动即时可见 |
| 5 | 落地 `scripts/release.sh` | 干跑一次（重复 release 同版本应幂等报错退出） |
