/**
 * 真实组合渲染单测的共享 fixture 构造（票据 08）：`render-real.test.mjs` 与
 * `render-real-derived.test.mjs` 共用假 checkout 目录树与最小可用 preset 真源。
 * 只写调用方给出的临时目录，不碰真实 `~/.dsh`。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { BUNDLE_PLUGIN_FILES } from "../../scripts/agent-preset-bundle.mjs";

/** 按「相对路径 → 内容」写一棵目录树（自动建父目录）。 */
export function writeTree(root, files) {
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(join(root, dirname(file)), { recursive: true });
    writeFileSync(join(root, file), content);
  }
}

/** 最小可用 preset 真源（生成器只需要 preset.yml + agent.cordis.yml + 被引用的插件文件）。 */
export function writePresetSource(dir, { name = "Fixture" } = {}) {
  const files = {
    "preset.yml": `name: ${name}\ndescription: ${name} fixture.\norder: 1\n`,
    "agent.cordis.yml": "- id: tool-bootstrap\n  name: './tool-bootstrap.mjs'\n  config:\n    bootstrapTools: [bash, str_replace_editor]\n",
  };
  for (const plugin of BUNDLE_PLUGIN_FILES) files[plugin] = `// ${plugin} fixture\n`;
  writeTree(dir, files);
}
