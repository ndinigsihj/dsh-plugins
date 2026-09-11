# 票据 05 前置发现 — 开发 profile 在 rc.1 上的挂载冲突

日期：2026-09-10（票据 02 收尾后由实机失败触发）
状态：已修复（2026-09-10，票据 05 执行；修法与实测见 `evidence/05-tui-cold-boot.md` §1）

## 现象

用户在 `~/dev/dsh-plugins` 下执行 `1mdsh` / `1mdsh-dev` 后立即失败，退出前报：

```
Error: dsh: plugin tree failed to load: failed to apply loader entry include (cordis:include):
duplicate loader entry id: session-projection-cache
```

## 触发方是全局 rc.1 宿主（不是稳定运行时）

对比两份安装的入口文件哈希名：

| 安装 | `dsh/lib/` 中的 profile-boot 文件 |
| --- | --- |
| 全局（`~/.nvm/.../node_modules/@deepseek-ai/dsh`，rc.1） | `profile-boot-Dk-7KqJc.js`、`profile-boot-BP_C0vpU.js` |
| 稳定运行时（`~/data/dev/dsh-runtime/stable`，rc.2） | `profile-boot-BnJoK_kl.js`、`profile-boot-DG5t9aNs.js` |

错误栈里出现的是 `profile-boot-Dk-7KqJc.js`，即全局 rc.1 宿主。等价地：`1mdsh-dev`（`dsh --profile tui-dev`）必然走全局宿主；若 `1mdsh` 的 shell 里仍是旧别名（`dsh --profile tui`）也会走全局宿主。稳定入口 `tui-stable` 执行的确实是 rc.2（`$STABLE/node_modules/.bin/dsh --version` → `0.1.1-rc.2`）。

## 根因

rc.1 的 `dsh-base` 补丁新增挂载了 4 个 id（`dsh-base/cordis.patch.yml` L145–166）：

| id | rc.1 base 的配置 | rc.2 base 是否挂载 |
| --- | --- | --- |
| `storage` | 无 config | 否 |
| `storage-json` | `root: !!js dshHomePath('storages')` | 否 |
| `storage-domain` | `backend: json` | 否 |
| `session-projection-cache` | `writeEveryEvents: 200`、`writeIntervalMs: 5000` | 否 |

而 `tui-dev`（以及已停用的 `tui-central`）profile 补丁在 `insert` 里又把这 4 个 id 作为新行插入一次 → 同名两条 → loader 在整个 include 挂载阶段直接抛错（`mountRootInclude → EntryGroup.update`），整个 profile 无法启动。

稳定侧 `tui` profile 补丁保持原样是正确的：rc.2 base 不含这 4 个 id（计数 0），插入是唯一来源。

## 复现（不触碰 `~/.dsh`）

用临时 `DSH_HOME` 复制 profile 目录后导出配置，对 4 个 id 计数：

```bash
TMP=<仓库内临时目录>            # .dsh/ 已在 .gitignore
cp -R ~/.dsh/profiles/{tui-dev,tui} $TMP/profiles/
DSH_HOME=$TMP dsh --profile tui-dev --dump-config | grep -cE '^- id: session-projection-cache$'      # → 2
DSH_HOME=$TMP dsh --profile tui --dump-config | grep -cE '^- id: session-projection-cache$'          # → 2
DSH_HOME=$TMP /Users/vito/data/dev/dsh-runtime/stable/node_modules/.bin/dsh --profile tui --dump-config | grep -cE ...  # → 1
```

四个 id（`storage`、`storage-json`、`storage-domain`、`session-projection-cache`）在全局宿主的两份 dump 里都是 2 条，在稳定宿主 + `tui` 的 dump 里都是 1 条。

## 附带发现：`--dump-config` 不能发现这类冲突

三次 dump 全部 **exit 0**，重复 id 的树被正常打印出来（重复检测只发生在 boot 的 `mountRootInclude`）。即：配置导出可以作为装配形状的门禁，但不能作为 id 冲突的门禁；票据 09 的配置闸门需要额外做「每个 id 计数为 1」的校验（或实机冷启动）。

## 建议修法（票据 05 执行，动的是开发侧 profile）

在 `~/.dsh/profiles/tui-dev/cordis.patch.yml`（`tui-central` 解除停用时同样处理）：

1. 删除 `storage`、`storage-json`、`storage-domain` 三行——rc.1 base 已有等价挂载（`storage-json.root` 的 `dshHomePath('storages')` 就是 `/Users/vito/.dsh/storages`，`storage-domain.backend` 逐字相同）。
2. `session-projection-cache` 从 `insert` 里挪出，改为按 id 的 config 覆盖（顶层条目，只写 `id` + `config`），若要保留 400/30000 的节流；否则直接删除、跟随 base 的 200/5000。
3. `tui`（稳定侧）与 `tui` profile 补丁不动。

## 其他前置核查

对开发 profile 挂载的 relay/endless 源文件做过一次静态检查（`dsh-relay/src/client.ts`、`dsh-endless/src/{storage-plugin,capture,distill,inject,tools}.ts`），未见 `.events`、`ctx.agent`、`new Inbox`、`snapshotEvents`、`eventAt(` 的直接使用（0 命中）；但它们对宿主包的其他接口依赖未逐个核对，且 relay/endless 适配不在本轮范围——票据 05 冷启动时仍会实测到。
