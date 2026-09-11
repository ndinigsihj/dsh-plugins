# Preset 只声明与 base 的差异

`dsh-base@0.1.5-rc.1` 自带 delegation、compaction、planning 与既有模型可见工具行。本仓库 preset 曾逐字复制其中 17 行，后果已经显现：`plan-mode` 的提示正文与 base 静默漂移（一处措辞不同），而两份配置无人对账。

决定：模型可见工具以宿主层由 base 提供，preset 只保留确需不同的行（当前为恒禁的 `tool-bash` 与承载模型选择开关的 `tool-subagent`）。空掉的组一并删除。

代价：preset 不再自包含，需要 base 在场才能成立。收益：同一事实只有一处定义，遮蔽意图显式可见。

不要为了让 preset"重新自包含"而把 base 已有的行再抄回来。
