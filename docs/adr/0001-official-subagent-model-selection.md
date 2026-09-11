# 子代理模型选择采用官方机制，放弃自研 purpose 路由

dsh `0.1.5-rc.1` 的 `dsh-tool-subagent` 自带模型选择：开启后把允许路由记入 session、由子 session 继承、事后设置编辑不改写，并让模型在允许集合内指定 provider/model/reasoning_effort，另注册路由发现工具、在创建子代理前由真实 adapter 校验路由。本仓库原先已按其旧行为（官方工具不暴露路由参数）设计了一整套自研替代方案——自研 purpose（explorer/reviewer/worker）到模型的路由层、替换官方工具的 adapter、自建 fallback 与 session override 事件——该设计在 rc.1 发布后作废。

理由：官方机制覆盖了同一目标（会话级固定、子代继承、不可事后改写），且额外提供发现与创建前校验；自研层只会重复这些语义并与之持续漂移。

代价：放弃"按角色名固定模型"的表达。若日后确有该需求，用多个官方工具实例配静态 `agentOptions`（纯配置）表达，而不是恢复自研 adapter。
