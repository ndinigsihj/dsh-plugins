# 02 票执行记录 — 兄弟仓库稳版前进（2026-10-19）

## dsh-endless → v0.1.11

- dev 门禁：`npm run typecheck` 0 错；`npm test` **272/272**；`npm run check:host -- --require-host`
  全 PASS（host tree 0.1.7-rc.1 == declared）。
- 发布：`scripts/release.sh 0.1.11` → commit `a2b1d60 Release v0.1.11` + annotated tag `v0.1.11`。
- stable 快照 `/Users/vito/data/dev/dsh-endless-stable`：`describe = v0.1.11`、**clean**、
  `node_modules/@deepseek-ai` → `dsh-runtime/stable/node_modules/@deepseek-ai`、
  依赖声明 = cordis 4.0.4 / schemastery 3.18.4 / dsh-* 0.1.7-rc.1、`host-pin.json` = 0.1.7-rc.1。
- 安装耗时：`npm install`「added 44 / changed 2 in 2m」（`/tmp/dsh-recon-npm-cache` 热 cache 生效）。

## dsh-relay → v0.1.10

- 依赖声明对齐（用户批准）：commit `8db2465 chore(host): align declared dependency generation with dsh 0.1.7-rc.1`
  —— 8 个依赖：`@deepseek-ai/cordis` 4.0.2→4.0.4、`schemastery` 3.18.2→3.18.4、
  `dsh-agent/dsh-llm/dsh-session/dsh-tools/dsh-user-questions/dsh-util-values` 0.1.5-rc.2→0.1.7-rc.1；
  同批 `npm install --package-lock-only` 同步 lock（树内解析即这 8 个版本）。
- 发布：`scripts/release.sh 0.1.10` → 333/333 测试绿 → commit `00975fa Release v0.1.10` + tag `v0.1.10`。
- stable 快照 `/Users/vito/data/dev/dsh-relay-stable`：`describe = v0.1.10`、**clean**、scope 链接同前、
  声明 = 新代际；`npm install`「added 8 / removed 250 in 2s」。

## 执行中踩到的四个坑（对 03 票直接适用）

1. **沙箱**：两仓的写入（package.json / lock / tag / stable worktree）都在会话工作区外，被 EPERM 拒绝，
   需要提权执行（本会话已在同类写入上被拒过）。
2. **默认 npm cache 有 root 属主文件** → 任何 `npm install` 会 EPERM；必须 `npm_config_cache=<可写目录>`。
3. **代理慢 + npm 默认空闲超时**：dry-run 的 595 包安装以 `EIDLETIMEOUT` 失败（单包 4–8 分钟）；
   本次用 `npm_config_fetch_timeout=1800000 / fetch_retries=5 / maxsockets=4` + 热 cache 才稳。
4. **relay 的 release.sh 不更新 lock 根版本**：stable 树 `npm install` 后 lock 根版本漂到 0.1.10，
   部署树变脏；按 dsh-plugins 部署树口径 `git checkout -- package-lock.json` 还原。
   （可选：给 relay 的 release.sh 补一行 lock 版本同步。）

## 当前半代窗口（须尽快收）

两棵兄弟 stable 树现在是 **0.1.7 代码 + 0.1.5 宿主**（runtime scope 仍是 0.1.5）：
endless 的 digest 注入会静默停（`agent/created` 在 0.1.5 不触发），直到 03–05 完成。
