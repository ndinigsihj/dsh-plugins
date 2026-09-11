# 05 — 清理执行记录（A + C 范围，用户已确认）

- 执行时间：2026-09-11 19:36（本地）
- 授权：用户在窗口内对 `evidence/05-cleanup-inventory.md` 清单明确选择「删 A + C（Q11 原文范围）」；
  B 层（worker store / projection cache 镜像）按该决定**不删**。
- 执行方式：脚本逐条校验（前缀、非符号链接、父目录实名匹配）后 `rm -rf`；A 用清单 57 个 ID，
  C 用显式 22 个名字，**未使用目录级通配**。
- 未 commit、未 push。

## 结果对账

| 指标 | 清理前 | 清理后 | 期望 |
| --- | --- | --- | --- |
| A 探针前缀（`session-m4-*` + `session-trajectory-*`） | 57（50 + 7） | **0** | 0 |
| A 所在项目目录条目总数 | 278 | **221** | 221（= 清理前非探针数） |
| `~/.dsh/sessions` 项目目录数 | 20 | **20** | 不变 |
| C `/tmp/dsh-ticket*`（含本次工作脚本 2 个） | 24 | **2**（均为我自己的临时脚本，收尾删除） | 0 |
| 其它 `/tmp/dsh-*` 前缀 | 54 | **54** | 不变 |
| B1 worker store 镜像 | 29 | **29** | 按决定不动（孤儿化） |
| B2 projcache 镜像 | 28 | **28** | 按决定不动（孤儿化） |

- A 实际删除 57/57，逐条 `DEL A <id>` 日志 57 行，无 skip、无失败。
- C 实际删除 22/22，无 skip、无失败。
- 首次执行时 A 组被文件沙箱拒绝（`rm: ... Operation not permitted`，目标在工作区外），
  C 组成功；随后经用户既有偏好提升一次权限，以同一脚本重跑，A 组 57/57 成功
  （重跑输出中 C 的 22 条为 `SKIP tmp missing`，系首轮已删，非异常）。

## 观测记录

清理前（首轮脚本输出）：

```
BEFORE main_total=278 probe=57 projdirs=20 tmp_dsh=78 tmp_ticket=24
```

清理后：

```
AFTER probe=0 main_total=221 projdirs=20 tmp_dsh=56 tmp_ticket=2
A deleted=57 failed_or_skipped=0
```

## 未处理 / 范围外（保持原样）

1. B1/B2 同 ID 镜像（58 项）：按本轮决定不删；A 删除后成为孤儿缓存，后续如需清理由你点名。
2. `session-ticket11-*`/`session-ticket12-*` projcache 9 项、`session-smoke-*` 12 项（dsh-tui 项目目录下）：
   范围外发现，未动。
3. 其它 `/tmp/dsh-*` 54 项：未动。
4. 消除再生长依赖本票前三条（隔离改造），方案见 `evidence/05-isolation-plan.md`。
