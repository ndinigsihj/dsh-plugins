# 票据 01 证据 — 回滚点与基线记录

采集时间：2026-09-10T06:19:53Z（本地 14:19）。范围：开发侧 profile（`tui-dev`、`tui-central`）升级到
`@deepseek-ai/dsh@0.1.5-rc.1` **之前**的可逆性记录。本票只记录与备份，不改动任何运行配置。

## 1. 宿主与运行环境（升级前）

| 项 | 值 |
| --- | --- |
| 全局宿主 | `@deepseek-ai/dsh@0.1.1-rc.2` |
| 宿主可执行 | `/Users/vito/.nvm/versions/node/v22.22.1/bin/dsh` |
| Node | `v22.22.1`（`/Users/vito/.nvm/versions/node/v22.22.1/bin/node`） |
| npm | `10.9.4` |
| 全局安装根 | `/Users/vito/.nvm/versions/node/v22.22.1/lib/node_modules` |
| 稳定侧运行时（不受本轮影响） | `/Users/vito/data/dev/dsh-runtime/stable`，自带 `0.1.1-rc.2`；`bin/tui-stable` 执行 `node_modules/.bin/dsh --profile tui`，不经过全局宿主 |

## 2. 回滚命令

```bash
npm i -g @deepseek-ai/dsh@0.1.1-rc.2
dsh --version          # 期望输出 0.1.1-rc.2
```

- 配置侧回滚：用 §3 备份树中的副本覆盖回原位（`settings.yaml`、`~/.dsh/.agent-presets/minimal-plus/`、
  `~/.dsh/profiles/tui-dev/`、`~/.dsh/profiles/tui-central/`）。
- 稳定侧无需回滚动作：`tui` profile 由隔离运行时启动，与全局宿主版本无关（§1 末行）。
- 先决条件：Node 保持 v22 主版本（`0.1.5-rc.1` 未在本机验证过其他主版本）。

## 3. 备份树（仓库外，已校验可读且与源逐字节一致）

```
/Users/vito/.dsh/upgrade-backups/dsh-0.1.5-rc.1-20260910-141953/
├── meta/
│   ├── versions.txt          # 采集时刻的 dsh / node / npm 版本与绝对路径
│   ├── npm-global-list.txt   # npm ls -g --depth=0 快照
│   └── sha256-preset.txt     # 部署位组合 8 个文件的 sha256
├── settings/settings.yaml
├── presets/minimal-plus/     # 部署位组合整树（含 node_modules 符号链接，原样保留）
└── profiles/
    ├── tui-dev/              # cordis.patch.yml + cordis.yml + package.json
    └── tui-central/          # 同上 + cordis.patch.yml.v2-backup.yml
```

校验结果：`settings.yaml` 逐字节一致；`tui-dev`（3 文件）、`tui-central`（4 文件）清单与 sha256 集合一致；
`presets/minimal-plus/`（8 个文件，排除 `node_modules`）逐字节一致；`node_modules/@deepseek-ai` 符号链接目标
两侧相同；备份树内每个文件均可读取。共 19 个文件。

## 4. 目标 profile 与组合标识（升级前）

| profile | 生效组合标识 | 引用来源 |
| --- | --- | --- |
| `tui-dev` | `minimal-plus` | `cordis.patch.yml` 的 `tui-runner.config.preset = process.env.CC_TUI_PRESET ?? 'minimal-plus'` |
| `tui-central` | `minimal-plus` | 同上（另有 `mirrorRoot` 配置） |
| `tui`（稳定侧，本轮不动） | `minimal-plus` | 同上 |

`~/.dsh/settings.yaml` 另有 `agent-presets.default: minimal-plus`。组合解析自 harness-home user root
`~/.dsh/.agent-presets/minimal-plus/`（仓库源 `presets/minimal-plus/`，8 个文件逐字节一致）。
即在没有 `CC_TUI_PRESET` 覆盖时，三个 profile 引用的是**同一份部署位副本**。

## 5. 会话与长期记忆的存储位置

| 用途 | 位置 |
| --- | --- |
| 会话根 | `~/.dsh/sessions/<转义后的 cwd>/`，本仓库为 `~/.dsh/sessions/--Users-vito-data-dev-dsh-plugins--/`（记录时 222 个会话目录） |
| 长期记忆（endless storage） | `~/.dsh/storages/`（`@deepseek-ai/dsh-storage-json` 的 root），文件 `session_projcache.json`、`workspace.json` |
| relay 镜像根 | `/Users/vito/.dsh/relay/mirrors`（`tui-central` 的 `mirrorRoot` 默认值，按需创建；记录时尚不存在） |
| relay 旧 sink 缓冲 | `~/.dsh/relay/sink-buffer/`（已退役链路的遗留文件，4 个空/半空 jsonl） |
| 中央记忆（v3） | 远端 hub `ws://100.122.248.90:9877`，hub 侧单写，本机不落盘 |
| worker 隔离会话根 | `~/.dsh/worker/`（停用运行自用，含 `sessions/` 与 `tasks.jsonl`） |

## 6. 去重前的可见工具清单与请求头工具快照

数据源：本仓库既有自研后基线批次 `experiments/m4/results-liangshen-bash-selfhost-E-C-2026-09-03.jsonl`
（sha256 `e3e17ac5…86d`，E 组 9 次运行，headless + `experiments/m4/m4.patch.yml`，宿主 `0.1.1-rc.2`）。
抽取结果存档在同目录 `01-tools-before-dedupe.json`。

- 工具数量 **28**，`assemblyTools` 与请求头 `headerTools` 两个集合相同（9/9 逐字一致，无差集）。
- bash 参数指纹：`command, description, timeoutMs, workdir, run_in_background, sandbox_permissions, justification`
  → 含 `sandbox_permissions`，即二轮换用后的沙箱形态（`bashHasSandbox: true`，9/9）。
- 请求头 `reason: "change"`；二轮注入来源 `user, agent-instructions, skill-catalog, instruction-hint`。
- 组合侧指纹（部署位 = 仓库源，8 文件 sha256）一并存入同一 JSON，供票据 09 去重后做「工具集合未变 + 组合已变」的对照。

## 7. 本票发现（只记录，处置留给后续票据）

1. **组合的官方包解析走稳定侧运行时。** 部署位组合的 `node_modules/@deepseek-ai` 是指向
   `/Users/vito/data/dev/dsh-runtime/stable/node_modules/@deepseek-ai` 的符号链接，其中
   `dsh-persona`、`dsh-tool-bash`、`dsh-tool-subagent`、`dsh-agent-presets` 均为 `0.1.1-rc.2`。
   组合文件内的 `@deepseek-ai/*` 裸导入会解析到这里。全局宿主升到 rc.1 后，开发侧会出现
   「rc.1 宿主 + rc.2 组合插件」的跨版本混用 —— 属票据 02「依赖树中无旧版本宿主包残留」与
   票据 03「开发侧独立组合」的处理范围。
2. **`--dump-config` 会写回 profile 目录。** `dsh --profile tui-dev --dump-config` 会重写该 profile 的
   `cordis.yml`（内容相同、时间戳变化）；在无写权限时直接 `EPERM` 退出。票据 09 的配置闸门需在允许写
   profile 目录的条件下执行。
3. **稳定侧与开发侧共用同一组合标识与同一份部署位副本**（§4），这是票据 03 必须为开发侧分叉新标识的
   直接原因：任何字段迁移都会牵动稳定侧。

## 8. 未纳入备份／未触碰

- `~/.dsh/profiles/tui/` 未单独备份：本轮不改动该 profile；其引用的组合已通过 `minimal-plus` 整树备份覆盖。
- `~/.dsh/.credentials.yaml` 未备份：本轮不改动凭据；`settings.yaml` 内也不含密钥明文（仅 `apiKeyEnv` 引用）。
- 仓库工作树本轮未改动（`docs/` 与 `evidence/` 除外）。
