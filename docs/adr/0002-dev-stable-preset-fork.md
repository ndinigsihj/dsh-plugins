# dev 与 stable 使用不同 preset，stable 宿主保持钉版

`tui`、`tui-dev`、`tui-central` 原先共用同一份 `minimal-plus` preset。dsh `0.1.5-rc.1` 把 persona 配置由 `text` 拆成 `prefix`/`suffix`（system-prompt 侧 `persona` 拆成 `personaPrefix`/`personaSuffix`），与 stable 宿主 `0.1.1-rc.2` 的字段不兼容，单份文件无法同时服务两个宿主。

决定：stable `tui` 继续使用 `minimal-plus`；新建 `minimal-plus-next` 承载 rc.1 字段，由 `tui-dev` 与 `tui-central` 使用。

理由：stable 宿主版本被刻意钉住，而 dev 侧明确不保留旧 API 兼容。

考虑过的替代：升级 stable 宿主至 rc.1（违反钉版约束）；在同一 preset 内按环境变量切换字段（长期脆弱分支）。
