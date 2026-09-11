# 01 — 回滚点与基线记录

**What to build:** 让本次升级在动手之前就完全可逆。记录当前宿主与运行环境版本、目标 profile 与组合配置现状、会话与长期记忆的存储位置；备份设置文件、部署位组合副本与目标 profile 配置；写明回滚命令；存档当前的可见工具清单，供后续去重前后对比使用。

**Blocked by:** None — can start immediately.

**Status:** done — 2026-09-10

**Evidence:** `evidence/01-rollback-point.md`；工具快照 `evidence/01-tools-before-dedupe.json`；
备份树 `/Users/vito/.dsh/upgrade-backups/dsh-0.1.5-rc.1-20260910-141953/`（19 文件，已校验可读且与源一致）。

- [x] 记录当前全局宿主版本与 Node 版本
- [x] 记录宿主回滚命令（含精确版本号）
- [x] 备份设置文件、部署位组合副本与目标 profile 配置，且备份文件可读
- [x] 记录会话根目录与长期记忆存储位置
- [x] 存档去重前的可见工具清单与请求头工具快照
- [x] 记录目标 profile 当前使用的组合标识

**记录中另发现两条影响后续票据的事实**（详见证据 §7）：组合的官方包经 `node_modules` 符号链接解析到
稳定侧运行时的 rc.2 包（票据 02／03 处理）；`--dump-config` 会写回 profile 目录（票据 09 需注意）。
