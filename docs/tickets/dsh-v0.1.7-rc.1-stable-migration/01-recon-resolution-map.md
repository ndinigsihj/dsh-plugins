# 01 — 前置取证：解析面清单与 0.1.7 布局预演

**What to build:** 把 stable 侧「谁解析哪份 dsh」固定成可复核的矩阵（窗口计划 §1），并补三项待证事实：
① `@deepseek-ai/dsh@0.1.7-rc.1` 在自包含前缀里安装后的 **布局**（顶层 scoped 实体数 / nested 副本位置 /
是否需要扁平镜像，镜像补多少条）；② `~/.dsh/profiles/node_modules` farm 的 **归属与重建方式**（谁创建、
dangling 时谁自愈、升级后如何机械重链）；③ `tui` 与 `tui-dev` 两份 profile 的 **逐行差异清单**
（0.1.7 下 `tui` 必须补/必须删的行逐条判定，作为 05 票的施工输入）。

**Blocked by:** 无（只读 + `/tmp` 前缀写）

**Status:** in progress — 2026-10-19（矩阵与阻塞项已定稿；三项待证事实在做 `/tmp` 预演）

- [x] 六处解析点（三棵 stable 树 / 旧载体 / farm / 启动器）实测指向与版本落表
- [x] dev 侧跨代例外记录（preset bundle → farm → stable 0.1.5 副本）
- [x] 兄弟仓库 0.1.7 就绪度判定（endless 未适配、relay 基本同源）
- [x] 0.1.7-rc.1 自包含安装布局取证（`/tmp` 预演 + 真实安装）→ 顶层 scope 277 = 全树包名数，**镜像需补 0 条**
  （0.1.7 本地安装布局本身扁平；`04-stable-flat-mirror.sh` created=0，跳过的 7 条是 chokidar/readdirp/koffi 等非 dsh 嵌套包）
- [x] farm 机制定位（创建者 / 自愈规则 / 重链步骤）→ 预演 §2：名集重解析，6 个已消失名跳过
- [x] `tui` vs `tui-dev` 行集差异清单（含 `settings` 覆盖行、`agent-presets` 旧行、preset bundle 选择）→ 预演 §3

**范围外（本票不做）:** 修改任何真实部署位；发兄弟仓库版本；写 profile。

---

## 预演记录（2026-10-19，`/tmp`）

- 前缀：`/tmp/dsh-recon-017`（`package.json` 只钉 `@deepseek-ai/dsh@0.1.7-rc.1`，独立 cache `dsh-recon-npm-cache`）。
- 结论回填：见下方「布局取证」（安装完成 / 镜像重放后补）。
