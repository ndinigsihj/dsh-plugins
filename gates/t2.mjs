/**
 * T2 假模型行为层（票据 01 从 `gates/run.mjs` 拆出）。
 *
 * 本模块只做编排与遏制扫描：逐场景调用 `gates/stub/run.mjs`（进程内 driver），
 * 把场景断言并入闸门报告。零网络、零额度、全程临时 home。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createAssertions, readJson, run, tailLines } from "./gate-helpers.mjs";
import { resolveDeploymentRoot } from "./manifest.mjs";
import { PRESET, REPO_ROOT, STUB_RUN, STUB_SCENARIOS_DIR } from "./paths.mjs";

/** 遏制扫描面：配置类文件里出现这些即命中（注释里的普通 "stub" 词不算）。 */
const STUB_CONFIG_PATTERNS = [/provider:\s*['"]?stub['"]?/u, /gate-stub/u, /gates[/\\]stub/u, /stub-model/u];

/** 递归列出某目录下指定后缀的文件。 */
function listConfigFiles(root, suffixes, out = []) {
  if (!existsSync(root)) return out;
  for (const dirent of readdirSync(root, { withFileTypes: true })) {
    const child = join(root, dirent.name);
    if (dirent.isDirectory()) listConfigFiles(child, suffixes, out);
    else if (suffixes.some((suffix) => dirent.name.endsWith(suffix))) out.push(child);
  }
  return out;
}

/**
 * 遏制断言（Q13 的闸门侧）：假模型只能出现在 `gates/stub/**`。
 * 扫描组合层、preset / 部署位副本与临时 home profile 的配置面；注释里的普通
 * "stub" 词不算，只有 provider 路由、插件 id、模块路径、模型名四种形态命中。
 */
function stubContainmentHits(config) {
  const deploymentEntry = config.manifestObj?.deployment?.[PRESET];
  const deploymentRoot = deploymentEntry === undefined ? undefined : resolveDeploymentRoot(deploymentEntry, homedir());
  const roots = [
    { label: "gates/composition", dir: join(REPO_ROOT, "gates", "composition") },
    { label: `presets/${PRESET}`, dir: join(REPO_ROOT, "presets", PRESET) },
    { label: "presets/minimal-plus", dir: join(REPO_ROOT, "presets", "minimal-plus") },
    { label: "temp-home-profiles", dir: join(config.tempHome, "profiles") },
    ...(deploymentRoot === undefined ? [] : [{ label: "deployment", dir: deploymentRoot }]),
  ];
  const hits = [];
  for (const { label, dir } of roots) {
    for (const file of listConfigFiles(dir, [".yml", ".yaml", ".json"])) {
      const text = readFileSync(file, "utf8");
      for (const pattern of STUB_CONFIG_PATTERNS) {
        if (pattern.test(text)) hits.push(`${label}:${file.startsWith(REPO_ROOT) ? file.slice(REPO_ROOT.length + 1) : file}`);
      }
    }
  }
  return hits;
}

/** 跑一个场景并把 runner 报告的断言逐条并入闸门断言流。 */
function runStubScenario(t, config, scenario, stubRoot) {
  const jsonPath = join(stubRoot, `${scenario}.json`);
  const result = run("node", [STUB_RUN, "--scenario", scenario, "--json", jsonPath], {
    cwd: REPO_ROOT,
    env: {
      ...config.env,
      STUB_HOME: config.tempHome,
      STUB_SESSION_ROOT: join(stubRoot, scenario, "sessions"),
      STUB_PRESET_ROOT: join(REPO_ROOT, "presets"),
    },
  });
  const report = readJson(jsonPath);
  const assertions = Array.isArray(report?.assertions) ? report.assertions : [];
  if (assertions.length === 0) {
    t.fail(`stub.${scenario}`, `exit ${String(result.status)} no scenario report at ${jsonPath}`, { stderr: tailLines(result.stderr, 4) });
    return { scenario, passed: 0, failed: 1, exit: result.status };
  }
  for (const assertion of assertions) {
    t[assertion.status === "pass" ? "pass" : "fail"](`stub.${scenario}.${assertion.id}`, assertion.evidence, assertion.detail);
  }
  const allPass = assertions.every((assertion) => assertion.status === "pass");
  t[(result.status === 0) === allPass ? "pass" : "fail"](
    `stub.${scenario}.process-exit`,
    `exit ${String(result.status)} report=${String(assertions.filter((assertion) => assertion.status === "pass").length)}/${String(assertions.length)} pass`,
  );
  return {
    scenario,
    passed: assertions.filter((assertion) => assertion.status === "pass").length,
    failed: assertions.filter((assertion) => assertion.status === "fail").length,
    exit: result.status,
    report: jsonPath,
  };
}

/** 逐场景跑 T2，把场景断言并入闸门报告。 */
export function runT2(config) {
  const t = createAssertions();
  const stubRoot = join(config.tempHome, "stub");
  mkdirSync(stubRoot, { recursive: true });

  const hits = stubContainmentHits(config);
  t[hits.length === 0 ? "pass" : "fail"](
    "stub.overlay-only",
    hits.length === 0
      ? "no stub provider/module/model reference outside gates/stub/**"
      : `stub references outside gates/stub: ${hits.join(", ")}`,
  );

  const scenarios = existsSync(STUB_SCENARIOS_DIR)
    ? readdirSync(STUB_SCENARIOS_DIR).filter((file) => file.endsWith(".mjs")).sort().map((file) => file.slice(0, -".mjs".length))
    : [];
  const summary = scenarios.map((scenario) => runStubScenario(t, config, scenario, stubRoot));
  if (scenarios.length === 0) t.fail("stub.scenarios", `no scenario files under ${STUB_SCENARIOS_DIR}`);
  config.report.stub = { scenarios: summary };
  return t.assertions;
}
