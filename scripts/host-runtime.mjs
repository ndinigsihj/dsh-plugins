/**
 * 宿主运行时定位 —— 让仓库内脚本不依赖本机绝对路径。
 *
 * 仓库的 `node_modules/@deepseek-ai` 由 `scripts/link-global-dsh.sh` 指向全局安装的
 * dsh 依赖树；因此宿主包一律用裸包名导入（实测其 `exports` 只暴露入口与 `./src/*`，
 * 深路径导入会被 ERR_PACKAGE_PATH_NOT_EXPORTED 拒绝），只有「不在依赖声明里的传递
 * 依赖」或「需要宿主安装锚点的 API」才需要在这里推导路径。
 */
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const DSH_APP_NAME = "@deepseek-ai/dsh";

/**
 * dsh 应用包（`@deepseek-ai/dsh`）的 package.json 绝对路径 ——
 * `loadProfile`/`boot` 的 installAnchor 参数，以及推导传递依赖（PTY、终端模拟器）的基准。
 *
 * 先按裸包名解析（宿主被提升到顶层时命中）；未命中则从 `dsh-app-boot` 位置逐级向上，
 * 找到 name 为 `@deepseek-ai/dsh` 的那层 package.json（宿主内嵌依赖树的常规布局）。
 */
export function installAnchor() {
  try {
    return require.resolve(`${DSH_APP_NAME}/package.json`);
  } catch {
    /* 内嵌布局，走下面的逐级查找 */
  }
  let dir = dirname(require.resolve("@deepseek-ai/dsh-app-boot/package.json"));
  for (;;) {
    const manifest = join(dir, "package.json");
    if (existsSync(manifest)) {
      try {
        if (JSON.parse(readFileSync(manifest, "utf8")).name === DSH_APP_NAME) return manifest;
      } catch {
        /* 无法解析的 package.json，继续向上 */
      }
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(
        "dsh host package not found: run scripts/link-global-dsh.sh (or set the repo's node_modules/@deepseek-ai link)",
      );
    }
    dir = parent;
  }
}
