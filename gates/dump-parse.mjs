/**
 * 解析 `dsh --dump-config` 的输出（票据 03 的独立复核路径）。
 *
 * 为什么需要：闸门在进程内用 `composeEntries` 组合（与 boot 同一算法），但
 * `--dump-config` 是**另一条**真实路径（CLI → `prepareProfile` → `renderConfigDump`）。
 * 两条路径对同一 patch 栈应产出同一组 loader id；只信其中一条会漏掉「CLI 渲染
 * 与 boot 组合漂移」这类回归，所以闸门分别计数并都断言无重复。
 *
 * `!!js` 标量是 app-boot 自定义的 YAML tag，必须补进 schema 才能解析 dump。
 * `js-yaml` 是 dsh-app-boot 的传递依赖，不在本仓库依赖声明里，因此从 app-boot
 * 的安装位置解析（与 `scripts/host-runtime.mjs` 的推导同源）。
 */
import { createRequire } from "node:module";

/** 从 app-boot 安装位置解析 js-yaml（仓库依赖面里没有它）。 */
function loadYaml() {
  const appBootManifest = createRequire(import.meta.url).resolve("@deepseek-ai/dsh-app-boot/package.json");
  const require = createRequire(appBootManifest);
  return require("js-yaml");
}

/**
 * 解析 dump 文本为条目数组。
 * @returns `{ entries }` 或 `{ error }`（不抛：调用方按断言失败处理）。
 */
export function parseCompositionDump(text) {
  const yaml = loadYaml();
  const jsExpr = new yaml.Type("tag:yaml.org,2002:js", {
    kind: "scalar",
    resolve: (data) => typeof data === "string",
    construct: (data) => ({ __jsExpr: data }),
  });
  const schema = yaml.JSON_SCHEMA.extend(jsExpr);
  try {
    const parsed = yaml.load(text, { schema });
    if (!Array.isArray(parsed)) return { error: "dump is not a top-level array" };
    return { entries: parsed };
  } catch (error) {
    return { error: String(error.message ?? error) };
  }
}
