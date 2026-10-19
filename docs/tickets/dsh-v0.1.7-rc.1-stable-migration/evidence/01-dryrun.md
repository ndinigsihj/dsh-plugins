# 预演记录 — 2026-10-19（`/tmp`，真实部署位零改动）

目的：在不碰真实环境的前提下，把 03/04/05 票的步骤各跑一遍，暴露问题后再动真环境。
前缀：`/tmp/dsh-recon-017`（0.1.7-rc.1 自包含安装，独立 cache `dsh-recon-npm-cache`）、
`/tmp/dsh-stable-dryrun/home`（临时 home：迁移后的 `tui` profile + 重链 farm + 部署位 bundle）。

## 1. header 补丁移植（04 票）— 通过

- 取 pristine：`npm pack @deepseek-ai/dsh-llm-pi-ai@0.1.7-rc.1`（113953 B）→ 与全局已打补丁文件
  （114957 B）的差异 = **3 处 hunk / 15 行**（insert 8 行 + headers 合并 1 行 + `resolveSessionCwd` 1 行）。
- 第一次按文档手写插入块：**`node --check` 红**（缩进多一层 + 正则 `\\` 被模板字符串吃掉成 `/[/\]+$/`）——
  预演的第一个价值点：手抄补丁不可靠。
- 改为「从已打补丁文件逐字取 3 处行 → 定位 pristine 锚点拼接」：产物与全局补丁文件 **逐字节相同 ✔**、
  `node --check` 通过、标记 grep = 5 命中。
- 8 条 mock 行为用例（用补丁后文件里抽出的真实代码 + mock `options/model/this.config`）**8/8 通过**：
  commandcode 带/不带 cwd、裸 uuid + 尾斜杠 cwd、任意 provider 名、无 sessionId、非目标 baseURL、
  opencode 端点、provider=opencode-go 但 baseURL 非 opencode.ai（不发 `x-opencode-session`）。
  过程中修正了 mock 自身的两处期望错误（漏 mock 基线 header；case 8 只断言"不发 x-opencode-session"）。

## 2. farm 重链（03 票）— 机制通过

- 真实 farm 名集 240 个；按 0.1.7 树重新解析每个名字 → **234 条链接重建，6 个名字在新树中已不存在**：
  `cordis-plugin-hmr`（0.1.7 更名 `dsh-hmr`）、`dsh-agent-presets`（0.1.7 已移除）、
  `dsh-code-runtime`、`dsh-code-runtime-worker-thread`、`dsh-settings-file`、`dsh-workflow-worker-thread`。
- 临时 home 里 bundle 的 bare import 验证：`preset-bundles/minimal-plus-preset` 处
  `require.resolve('@deepseek-ai/dsh-tool-bash')` → 经 farm 解析到 **0.1.7-rc.1**（全局树副本）——
  即「farm 重链后 preset 不再落 0.1.5 副本」这一收敛点成立。

## 3. `tui` profile 迁移（05 票）— 组合通过

- 迁移模板：`tui-dev/cordis.patch.yml`（0.1.7 已验证的行集）→ 路径换回三棵 stable 树
  （`dsh-plugins-stable` / `dsh-relay-stable` / `dsh-endless-stable`）→ `llm-pi-ai` /
  `agent-default-model` 两段内容换成 `settings.stable.yaml` 同段（文本重缩进）；`settings` 覆盖行与
  `agent-presets` 旧行自然消失（模板里没有）。
- 载体：`generated/minimal-plus-preset/` → `profiles/tui/preset-bundles/minimal-plus-preset/`，
  `node_modules/@dsh-plugins/minimal-plus-preset` 符号链接到它，`package.json` bundles 加
  `@dsh-plugins/minimal-plus-preset`。
- `DSH_HOME=HOME=/tmp/dsh-stable-dryrun/home` + 全局 0.1.7 CLI `--profile tui --dump-config`：
  **exit 0**、756 行、**loader ids = 108、duplicates = 0**；`minimal-plus-agent-preset-registry` /
  `preset-minimal-plus` 在、`agent-presets` 旧行不在；`session-reference` / `file-reference-local` 在。
- 对照：真实 `tui-dev` 同口径 dump 为 112 ids —— 差 4 来自 dev bundles 里的
  `dsh-antigravity-auth`（stable settings 无 antigravity provider，候选未带该 bundle）。
  **列为 05 票待裁决项**（带 / 不带，理由入票面）。

## 4. 未完成项（继续中）

- **真实本地安装布局与镜像条数**：`npm i`（本地布局）在 `/tmp/dsh-recon-017` 仍在跑——代理对 tarball
  极慢（单包 4–7 分钟），当前 237M/约 157 顶层目录。完成后补：布局（顶层 scoped 实体数 / nested 位置）
  + 镜像脚本补的条数。
  附注：真实窗口的 `npm i` 可复用这份热 cache（`--cache /tmp/dsh-recon-npm-cache`），但总时长仍以小时计。
- 兄弟仓库稳版前进（02 票）未动：`dsh-endless-stable` 仍 0.1.5 代，宿主切换前必须先完成。
