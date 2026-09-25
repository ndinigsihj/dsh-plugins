# 07 — Preset 载体迁移与同步工具 dry-run

**What to build:** 仓库目录保持唯一真源，生成 0.1.7 声明形态的 Preset 产物（在插件组合包中声明一条 Preset 行），仓库根冒烟可加载；同步工具改造为"生成 Profile 侧产物"，在写真实部署位之前支持 dry-run 并逐文件核对；旧目录形态按 02 结论过渡或退场。生成产物与真源指纹一致。

**Blocked by:** 02 — 前置取证；04 — 宿主升级与两个工作 Profile 到位

**Status:** done — 2026-09-25（生成器 + 入库产物 + 同步 dry-run + 仓库根/闸门/real 冒烟全绿；**改动未提交**，待用户确认后 commit；真实部署位写入按票面范围留给 12）

**施工图:** `docs/dsh-v0.1.7-rc.1-upgrade-spec.md`（Implementation Decisions：Preset 载体）；升级计划 §3.5、§6 P0 载体行

- [x] 生成产物在仓库根冒烟加载成功：Preset 名出现、首轮锚定行为保持
- [x] 生成产物包含自研插件行与委派行，二轮提权能力不丢
- [x] 同步工具 dry-run 输出与真源逐文件一致；未加 dry-run 时不写任何真实路径
- [x] 旧目录形态的过渡/退场按 02 结论执行并记录
- [x] 闸门组合全绿；产物指纹与真源一致
- [x] 证据归档到本票

**范围外（本票不做）:** 部署位真实写入（12）；Preset 瘦身或退役评估。

---

## 验收回填（2026-09-25）

证据：`evidence/07-preset-carrier-and-sync-dry-run.md`。要点：

- **载体**：仓库真源 `presets/minimal-plus/` 生成自包含 bundle `generated/minimal-plus-preset/`
  （registry 行 + `preset-minimal-plus` 声明行 + 逐字节复制的 7 个自研 `.mjs` + 真源 sha 清单）；
  相对插件名改写为 bundle 包子路径，`!!js` 与注释按原文搬运。
- **指纹**：`node scripts/agent-preset-bundle-cli.mjs --check` 10/10 一致；`npm test` 常驻「入库产物 =
  真源再生」漂移断言；`agent.cordis.yml` sha `8cd01c68…` 与 `gates/manifest.json` 一致。
- **冒烟**：`node presets/minimal-plus/smoke-boot.mjs` 默认直接装入库产物 → roster `minimal-plus`
  （名 `Minimal+提权+注入`）、R1 `[bash, str_replace_editor]`、R2 沙箱 bash + `skill_search/skill_load`
  + `instruction-hint` 注入、0 warning；`SMOKE_PRESET_ROOT` 给出时从该真源现场生成（degrade/real）。
- **同步**：`scripts/sync-agent-presets.sh` 默认 dry-run、逐文件 `repo:ok`、不写任何真实路径，
  目标位漂移 exit 1 且不覆写；`--profile <name>` 生成 Profile 侧产物（bundle + node_modules 链接 +
  `dsh.profile.bundles` 选择），`--dest` 为 staging 安装源。真实部署写留在 12。
- **退场**：闸门/冒烟/T2/real 渲染全部切到声明形态；实验与 T3 探针、trajectory、stable PTY 部署
  冒烟列入票 11/12；旧 `~/.dsh/.agent-presets/minimal-plus` 未删除（需用户批准，票 12）。
- **闸门**：`--tier 0,1,2 --composition gate --skip-deployment-check` 69/69；
  `--tier 1 --composition real --skip-deployment-check` 20/20；T0 = tsc 0 + `npm test` 178/178。
  部署位仍是旧目录形态，窗口豁免在 12 消除。
- **双轴只读评审**：Standards 的行数/重复实现问题与 Spec 的「同步未产生 profile 侧产物」问题
  已在本票修掉（详见证据 §6）。
- **附带门禁修正**（详见证据 §5）：expectations 移除 0.1.7 默认 disabled 的 `ralph`（行级差异 +
  理由入库）、T2 场景 reader 改 V4 first-class message 形状、v3-resume 格式前置改当前格式 4。
