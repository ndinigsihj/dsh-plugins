/**
 * T3 真实模型层的部署基线（允许路由集合）在 **T3 / 探针侧的单一来源**（票据 11）。
 *
 * 与 `~/.dsh/profiles/{tui-dev,headless}/cordis.patch.yml` 的
 * `subagent-model-selection-settings` 行逐字段一致（2026-09-12 起 2 条：opencode-go 与
 * commandcode v4-flash / deepseek-official v4-flash 退役后收敛）。用途：
 *   - `gates/t3/run.mjs` 用它预置两个探针的隔离 profile（设置编辑可用：配置在 profile 层，
 *     不经 `--patch` overlay 覆盖，`settings.update` 才被允许写入 user 层）；
 *   - `probe.mjs` 用它作为 a1/a10/a9 的期望集合；
 *   - `run.sh` / `run-route-probe.sh` 用 `--print-config` 读取同一份配置生成隔离 profile。
 *
 * **生产真相仍是两个真实 profile 条目**，本模块只消除 T3/探针侧的第三份拷贝；改集合时要
 * 同时改这里与两个 profile（维护流程见 docs/subagent-model-selection.md §5.1）。
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SETTINGS_BASELINE = {
  enabled: true,
  allowedModels: [
    { provider: "commandcode", model: "deepseek/deepseek-v4.1-flash" },
    { provider: "deepseek-official", model: "deepseek-flash" },
  ],
};

/** CLI：`--print-config` 输出 profile-home `--settings-config` 需要的 JSON（脚本共用，避免内联 import）。 */
if (process.argv[1] !== undefined && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  if (process.argv[2] !== "--print-config") {
    process.stderr.write("allowed-routes: only --print-config is supported\n");
    process.exit(2);
  }
  process.stdout.write(JSON.stringify(SETTINGS_BASELINE));
}
