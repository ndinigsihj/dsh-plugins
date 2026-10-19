# 窗口计划 — stable 侧迁 0.1.7-rc.1（宿主 + 解析面 + header 补丁）

> 状态：**已执行（2026-10-19）** —— 01–06 全部 done；改动未提交，等用户确认后 commit。
> 缘起：`docs/dsh-v0.1.7-rc.1-upgrade-closeout.md` §7.1-2「stable 通道迁移未做」；
> 触发：v0.2.2 发布把 stable 的 **仓库代码** 带到 0.1.7 适配态，宿主仍钉 0.1.5-rc.2（跨代）。
> 范围：`dsh-runtime/stable`（宿主）＋ `tui` profile ＋ 三棵 stable 树/载体/farm 的解析面 ＋
> `dsh-llm-pi-ai` 的 opencode/commandcode 动态 header 补丁。dev 通道（全局宿主 + `tui-dev`/`tui-team`）不动。

## 1. 现状（只读取证，2026-10-19）

| 解析点 | 目标 | 版本 |
| --- | --- | --- |
| `dsh-plugins-stable/node_modules/@deepseek-ai` | → `dsh-runtime/stable/node_modules/@deepseek-ai` | 0.1.5-rc.2/rc.3 |
| `dsh-relay-stable/node_modules/@deepseek-ai` | → 同一处 | 同上 |
| `dsh-endless-stable/node_modules/@deepseek-ai` | → 同一处 | 同上 |
| stable preset 旧载体 `~/.dsh/.agent-presets/minimal-plus/node_modules/@deepseek-ai` | → 同一处 | 同上 |
| `~/.dsh/profiles/node_modules` farm 的 `@deepseek-ai/*` 链接 | → 同一处的具体包路径 | 同上 |
| 启动器 `dsh-runtime/stable/bin/tui-stable` | → `dsh-runtime/stable` 的 CLI | 0.1.5-rc.2 |
| **dev 例外**：`profiles/tui-dev/preset-bundles/minimal-plus-preset` 里 `import '@deepseek-ai/dsh-tool-bash'` | 经 farm → **stable 运行时** 的 nested 副本 | 0.1.5-rc.3（宿主是 0.1.7-rc.1，属跨代） |

结论：stable 侧**部署位置已统一**（全部经 `dsh-runtime/stable` 这一个 scope），**版本未统一**（都是 0.1.5 线）；
升宿主后版本与位置同时收敛（需重建 farm 链与扁平镜像，否则 dangling）。

## 2. 前置阻塞（不解决就会复现 09-27 故障）

1. `dsh-endless-stable`（v0.1.10，`host-pin.json` = 0.1.5）仍是 0.1.5 代：`src/distill.ts:123` 注册
   `agent/session-start`、`src/inject-v3.ts:103` / `src/distill.ts:164` 写裸 `kind:"plugin"` 源。
   dev 仓库修复 `1381e89`（0.1.7 适配：`agent/created` + `plugin:endless/*` 生产者源）**未发布**。
2. `dsh-relay-stable`（v0.1.9）与 dev 基本同源（dev 已在 0.1.7 下跑），但缺 dev 的 `bdc5deb`
   （`dsh-session-projection` 钉 rc.2，防 fresh install 被 rc.3 peer 拒）；不重装依赖暂不触发。

## 3. 执行顺序

`01 前置取证` → `02 兄弟仓库稳版前进` → `03 宿主升级 + 镜像/farm` → `04 header 补丁移植` →
`05 tui profile 迁移` → `06 验收与收口`。其中 03 之后 stable 通道依赖 02 完成，否则 endless 行报错。

## 4. 验收（全绿才算窗口完成）

- `tui-stable --version` → `0.1.7-rc.1`；`tui-stable --dump-config` exit 0、loader ids 无重复。
- 解析面矩阵（上表全部行）指向 `dsh-runtime/stable` 且版本 `0.1.7-rc.1`；farm dangling = 0；
  扁平镜像 top-level = 全树 scoped 包名数。
- `dsh-llm-pi-ai`：`node --check` 通过、三标记 grep 5 命中、8 条 mock 用例通过；
  stable profile 配置无静态 `x-session-id`/`x-project-slug`/`x-opencode-session`（补丁独家生成）。
- stable profile PTY 冒烟（真 PTY + 真 profile + 部署位载体）：boot 渲染 + preset 挂载 + 无挂载报错。
- `scripts/regression-gate.sh --tier 0,1,2 --composition real` 复跑绿（dev 侧组合，验解析面重建没伤 dev）。
- 证据入 `docs/tickets/dsh-v0.1.7-rc.1-stable-migration/evidence/`，文档回填 `deployment.md` §4/§5 与
  收口 §7.1-2 状态。

## 5. 回滚

- 旧运行时整树保留：`dsh-runtime/stable/node_modules` → 改名 `node_modules.pre-0.1.7-rc.1.bak`
  （外加 `package.json`/`package-lock.json` 副本）；回滚 = 改名切回 + 还原 profile 备份。
- 备份：`~/.dsh/profiles/tui`（cordis.patch.yml / package.json / preset-bundles 状态）、`settings.stable.yaml`。
- 不可逆边界：会话格式 V4 —— 0.1.7 读写 V4，回退 0.1.5 读不了已迁移会话（既存边界，非本窗口引入）；
  冷备口径见升级收口 §8，保留期不变。

## 6. 风险

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 兄弟稳定树未适配就换宿主 | endless 注入静默失效 + V4 落盘拒绝（09-27 事故复现） | 02 先行；冒烟断言覆盖 |
| npm 重装后 chunk 布局变化 | farm/镜像 dangling → preset/插件 import 失败 | 03 机械重算镜像 + farm 校验 dangling=0 |
| profile 迁移漏行（`agent-presets` / `settings` 覆盖） | `1mdsh` 起不来或设置丢失 | 05 逐行 diff tui-dev 对照 + dump-config 验 |
| settings 一次导入消费 `~/.dsh/settings.yaml` | stable 丢模型配置 | 迁移前备份；配置落 profile；不依赖该文件 |
| 迁移窗口内 `1mdsh` 不可用 | 日常入口中断 | 一次窗口内完成 + 预演先行 + 回滚一条命令 |
