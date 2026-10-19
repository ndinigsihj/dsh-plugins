# 04 — header 补丁随迁移移植（opencode / commandcode）

**What to build:** 把 `docs/opencode-go-x-opencode-session-local-patch.md` 与
`docs/commandcode-x-session-id-x-project-slug-local-patch.md` 记录的动态 header 补丁，
从「只打在 v22/v24 全局安装」扩展到 **stable 运行时的新 `dsh-llm-pi-ai`（0.1.7-rc.1）**，
使 stable 通道经 commandcode 系列端点时带 `x-session-id` / `x-project-slug`、
经 opencode.ai 端点时带 `x-opencode-session`（只看 baseURL，不看 provider 名）。

**Blocked by:** 03（新树就位）

**Status:** done — 2026-10-19（证据 `evidence/03-06-host-migration.md` §04；预演细节见 `evidence/01-dryrun.md` §1）

预演结论（证据 `evidence/01-dryrun.md` §1）：pristine（`npm pack`）→ 按已打补丁文件逐字取行拼接 →
与全局补丁文件**逐字节相同**、`node --check` 通过、grep 5 命中、8/8 mock 用例通过。
坑：手抄补丁块会踩缩进与正则转义（`\\` 被模板字符串吃掉），**必须逐字取行**。

施工步骤：

1. 以全局 v24 已打补丁的 `dsh-llm-pi-ai/lib/index.js` 与 pristine 0.1.7-rc.1 副本 **diff 出精确补丁**
   （同版本时可直接判定逐字节等价）；应用到 stable 运行时的同名文件（先备份为 `*.bak`）。
2. 校验：`node --check`；`grep -c "commandCodeSessionHeader\|resolveSessionCwd\|opencodeSessionHeader"` = 5；
   与全局补丁文件逐字节比对（同版本前提下）；8 条 mock 逻辑用例（含无 cwd、无 sessionId、非目标 baseURL）。
3. 配置面收口：确认 stable 侧 profile 配置 **不含** 静态 `x-session-id`/`x-project-slug`/`x-opencode-session`
   （补丁独家生成、无静态回退）；`~/.dsh/profiles/tui-dev` 的删除维持不动。
4. 文档回填：两篇 local-patch 文档的「已应用运行时」表增加 `dsh-runtime/stable`（升级前「未打」的注记改为已打 + 日期 + sha）。

- [x] 补丁三处落位（insert 块 / headers 合并 / `resolveSessionCwd` 配置）
- [x] `node --check` 通过；grep 5 命中；与全局补丁文件逐字节相同（sha256 `bd66963d…`）
- [x] 8 条 mock 用例通过（预演阶段对同一份补丁代码执行）
- [x] stable profile 无静态 header；tui-dev 维持无静态 header
- [x] 两篇补丁文档回填 stable 运行时行（commandcode 表 + opencode「已同步机器」追加 2026-10-19 条目）

**范围外（本票不做）:** 给 dev 全局/其他运行时重打补丁；改 profile 的 provider 定义（05 票负责搬迁）。
