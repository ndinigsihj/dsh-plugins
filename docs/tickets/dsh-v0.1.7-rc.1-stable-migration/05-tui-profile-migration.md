# 05 — `tui` profile 迁移到 0.1.7 形态（settings 解耦 / 载体换 bundle / 行集对齐）

**What to build:** 让 stable 日常 profile（`~/.dsh/profiles/tui`）在 0.1.7 宿主下等价可用：
去掉 0.1.5 专有面，补上 0.1.7 的配置与载体形态，保持与 dev profile 同一套 TUI 代码（v0.2.2）的功能面。

**Blocked by:** 03（宿主）、04（补丁）；行集输入来自 01 票的 diff 清单

**Status:** done — 2026-10-19（证据 `evidence/03-06-host-migration.md` §05；预演细节见 `evidence/01-dryrun.md` §3）

预演结论（证据 `evidence/01-dryrun.md` §3）：以 `tui-dev` 行集为模板换回三棵 stable 路径 +
`settings.stable.yaml` 的 `llm-pi-ai`/`agent-default-model` 段 → 临时 home `--dump-config`
**exit 0、108 ids、0 duplicates**；preset bundle 声明在、旧 `agent-presets` 行不在。
待裁决项：**`dsh-antigravity-auth` bundle 带不带**（dev 带、stable settings 无 antigravity provider；
带则 +4 loader ids）。

施工步骤：

1. 备份 `~/.dsh/profiles/tui`（`cordis.patch.yml` / `package.json` / `preset-bundles/` 现状）与
   `~/.dsh/settings.stable.yaml`（`.bak-<date>`）。
2. 摘 0.1.5 专有面：删 `settings` 覆盖行（现第 99–101 行，指向 `settings.stable.yaml`）与
   `agent-presets` 旧目录服务行（0.1.7 已移除该包；旧目录载体不再被读取，只留作回滚）。
3. 设置搬迁：把 `settings.stable.yaml` 的段按 0.1.7 落成 profile 插件配置（`llm-pi-ai` providers
   含 commandcode/muse/volcengine/cc/gjx/baorong 的模型定义、`agent-default-model`、`llm-deepseek`、
   `ui-onboarding` 等），形态对齐 `tui-dev`；**不写静态 session header**（04 票口径）。
4. 载体换 bundle：`generated/minimal-plus-preset/` → `~/.dsh/profiles/tui/preset-bundles/minimal-plus-preset/`；
   `tui/package.json` 的 `dsh.profile.bundles` 增加 `@dsh-plugins/minimal-plus-preset`；
   `tui-runner` 的 `preset: minimal-plus` 选择保持。
5. 行集对齐：逐条判定 01 票清单里 `tui-dev` 有而 `tui` 没有的行（`session-reference`、
   `file-reference-local`、relay 行的 `approval` inject 等）与 `inject` 列表差异；路径保持 stable 侧
   （`dsh-plugins-stable` / `dsh-relay-stable` / `dsh-endless-stable`）。
6. `~/.dsh/.agent-presets/minimal-plus` 保留不动（删除需另行批准）。

- [x] `tui/cordis.patch.yml` 在 0.1.7 下 `--dump-config` exit 0、108 ids、0 duplicates
- [x] settings 内容落到 profile 配置（`llm-pi-ai` + `agent-default-model`；`ui-onboarding`/`llm-deepseek`/`agent-presets` 三段在 0.1.7 无对应条目，按导入语义跳过）；`settings.stable.yaml` 备份保留
- [x] preset bundle 落位（10 文件）且被 profile 选中；旧目录载体不再被读取
- [x] 行集差异逐条判定（含 `dsh-antigravity-auth` **不带** + 理由：stable settings 无 antigravity provider，带则 +4 ids）
- [x] 功能面（TUI + relay + endless + preset）经 PTY 冒烟 3/3 与 real 闸门 85/0/0 复核

**范围外（本票不做）:** dev profile（`tui-dev`/`tui-team`）改动；删除旧目录载体；改兄弟仓库代码。
