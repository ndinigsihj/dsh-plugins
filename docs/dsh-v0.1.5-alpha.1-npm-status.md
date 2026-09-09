# dsh v0.1.5 npm 发布状态核验

> 核验日期：2026-09-09  
> 范围：仅核验 DeepSeek Harness 官方 npm 包 `@deepseek-ai/dsh` 的公开发布状态；未升级本地依赖、未修改代码。

## 结论

GitHub 上的最新 release 是 **`dsh-v0.1.5-alpha.1`**，不是正式版 `0.1.5`。

npm Registry 中已经发布了同一预发布版本：

- `@deepseek-ai/dsh@0.1.5-alpha.1`：已发布，时间为 **2026-09-08T15:57:30.560Z**。
- npm `alpha` dist-tag：指向 `0.1.5-alpha.1`。
- npm `latest` / `next` dist-tag：仍都指向 `0.1.2-rc.1`。
- `@deepseek-ai/dsh@0.1.5`：**未发布**（Registry 查询返回 `E404`）。
- `@deepseek-ai/dsh@0.1.3`：**未发布**；有 `0.1.3-alpha.2`，发布于 **2026-09-07T13:11:36.213Z**。

因此，若要测试 0.1.5 的 npm 包，应显式安装 alpha tag 或精确版本，不能使用默认安装：

```bash
# 默认仍会得到 0.1.2-rc.1
npm i -g @deepseek-ai/dsh

# 获取当前 0.1.5 alpha
npm i -g @deepseek-ai/dsh@alpha
# 或锁定本次核验到的版本
npm i -g @deepseek-ai/dsh@0.1.5-alpha.1
```

## 一手证据

1. npm Registry 的包元数据：<https://registry.npmjs.org/@deepseek-ai%2fdsh>
   - `dist-tags`: `latest` 和 `next` 为 `0.1.2-rc.1`，`alpha` 为 `0.1.5-alpha.1`。
   - `versions` 含 `0.1.3-alpha.2` 与 `0.1.5-alpha.1`，不含 `0.1.3`、`0.1.5`。
   - `time["0.1.5-alpha.1"]` 为 `2026-09-08T15:57:30.560Z`。
2. 官方 GitHub release：<https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.5-alpha.1>
3. 官方 release commit：<https://github.com/deepseek-ai/deepseek-harness/commit/2faa751be99c8fbee0524e478f4c53d93b408131>

## 与旧记录的差异

仓库中 `docs/dsh-v0.1.2-rc.1-tui-impact.md` 的历史结论（当时 npm 尚无 `0.1.3-alpha.1`）已经过时：现在 npm 已有 `0.1.3-alpha.2` 与 `0.1.5-alpha.1`，但稳定 `latest` 尚未前移。
