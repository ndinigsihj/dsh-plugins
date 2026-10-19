# 03 — 宿主升级：`dsh-runtime/stable` → 0.1.7-rc.1（+ 扁平镜像与 farm 重链）

**What to build:** 把 stable 自包含运行时的宿主从 `0.1.5-rc.2`（子包 rc.3）升到 `0.1.7-rc.1`，
并让它对外暴露的解析面完整可用：顶层 scoped 镜像补齐、`~/.dsh/profiles/node_modules` farm 重链、
三棵 stable 树与旧载体的别名仍然有效（dangling = 0）。旧树整棵保留作回滚资产。

**Blocked by:** 02（兄弟 stable 树先适配）

**Status:** done — 2026-10-19（证据 `evidence/03-06-host-migration.md` §03）

- [x] 备份可一键切回（`node_modules.pre-0.1.7-rc.1.bak` 289M + package.json/lock 副本）
- [x] 安装 exit 0、`tui-stable --version` = 0.1.7-rc.1
- [x] 镜像重放后 top-level = 277（= 全树包名数，需补 0）、dangling = 0
- [x] farm 链接 234 条全部有效且指向 `dsh-runtime/stable`（移除 6 个 0.1.7 已消失名）
- [x] 六处解析点矩阵（01 票）逐项复测为新版本
- [ ] 回滚演练：切回旧树后 `tui-stable --version` = 0.1.5-rc.2（**未做**，按记录的回滚步骤留待需要时执行）

**范围外（本票不做）:** profile 内容迁移（05 票）；header 补丁（04 票）；删除旧载体。
