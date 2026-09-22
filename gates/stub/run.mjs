#!/usr/bin/env node
/**
 * T2 假模型行为层 runner（票据 06/07；计划 §3.1、§5.4）。
 *
 * 在一个进程内的 headless 组合（dsh-base + dsh-headless bundle + stub overlay）
 * 里跑真实 agent loop：装载场景脚本 → 注入 `stub` 路由的脚本化适配器 → 按场景契约驱动
 * （默认单 agent 单轮；多 agent 场景走 `run(harness)`）→ 只读会话事件断言。
 *
 * 用法（一条命令跑一层：scripts/regression-gate.sh --tier 2）：
 *   node gates/stub/run.mjs --scenario bash-first-call [--json <report.json>]
 *
 * 场景契约（票据 06 起）：导出 `{ id, finding, invariant, assert(events, context) }` +
 *   - 默认流程：`turns`（轮次→分块序列）+ `userMessage`，runner 建一个 agent 跑完；
 *   - 多 agent 流程：`run(harness)`（harness 见 gates/stub/harness.mjs），自己决定
 *     建/恢复 agent、压缩时点与工具调用；断言仍只读会话事件。
 *
 * 环境（缺省即自建隔离 home；闸门会显式注入，见 gates/run.mjs 的 runT2）：
 *   STUB_HOME            隔离 home（闸门注入；缺省 mktemp 后删除）。刻意不读 ambient
 *                        DSH_HOME——dsh 会话自身会把它设成真实 `~/.dsh`
 *   STUB_SESSION_ROOT    会话根（缺省 <home>/stub-sessions/<scenario>）
 *   STUB_PRESET_ROOT     preset 扫描根（缺省 repo presets/）
 *   STUB_TIMEOUT_MS      单次等待上限（缺省 120000）
 *   STUB_DUMP_EVENTS=1   额外把原始会话事件落 `<report>.events.json`（红绿取证/分诊用）
 *
 * 退出码：0 全过 / 1 任一断言失败（含组合引导失败——那不是环境前置，是机制坏了）。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { boot, healProfilesModuleFallback, loadOverlayPatches, loadProfile } from '@deepseek-ai/dsh-app-boot';
import { installAnchor } from '../../scripts/host-runtime.mjs';
import { STUB_MODEL, STUB_PROVIDER, stubState } from './adapter.mjs';
import { createHarness } from './harness.mjs';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const STUB_DIR = join(REPO_ROOT, 'gates', 'stub');
const STUB_PATCH = join(STUB_DIR, 'stub.patch.yml');
/** preset 的 delegation/tool-subagent 开了 modelSelectionSettings，缺宿主单例挂不起来（同 T1 冒烟）。 */
const SUBAGENT_SETTINGS_PATCH = join(REPO_ROOT, 'gates', 'composition', 'subagent-settings.patch.yml');
const SCENARIOS_DIR = join(STUB_DIR, 'scenarios');
const PRESET = 'minimal-plus';
const INSTALL_ANCHOR = installAnchor();

// ── CLI ─────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const options = { scenario: 'bash-first-call', json: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--scenario') {
      options.scenario = argv[++index];
    } else if (token.startsWith('--scenario=')) {
      options.scenario = token.slice('--scenario='.length);
    } else if (token === '--json') {
      options.json = argv[++index];
    } else if (token.startsWith('--json=')) {
      options.json = token.slice('--json='.length);
    } else {
      throw new Error(`gate-stub: unknown argument ${token}`);
    }
  }
  if (options.scenario === undefined || options.scenario.length === 0) {
    throw new Error('gate-stub: --scenario expects an id (e.g. bash-first-call) or a .mjs path');
  }
  return options;
}

/** 场景 id 或路径 → 绝对路径（只允许 gates/stub/scenarios/ 下的文件）。 */
function resolveScenarioPath(name) {
  const path = name.includes('/') || name.endsWith('.mjs') ? resolve(name) : join(SCENARIOS_DIR, `${name}.mjs`);
  if (!existsSync(path)) throw new Error(`gate-stub: scenario not found: ${path}`);
  return path;
}

function defaultReportPath(scenarioId) {
  return join(REPO_ROOT, 'experiments', 'regression-gate', `results-stub-${scenarioId}-${new Date().toISOString().slice(0, 10)}.json`);
}

// ── 隔离 home ──────────────────────────────────────────────────────────────

/** headless profile 骨架（与 CLI prepareProfile 同构；只为 standalone 运行兜底）。 */
function seedHeadlessProfile(home) {
  const profileDir = join(home, 'profiles', 'headless');
  mkdirSync(profileDir, { recursive: true });
  const manifestPath = join(profileDir, 'package.json');
  if (!existsSync(manifestPath)) {
    writeFileSync(
      manifestPath,
      `${JSON.stringify({
        name: 'dsh-profile-headless',
        private: true,
        dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless'], patchReload: 'startup' } },
      }, null, 2)}\n`,
    );
  }
  const cordisPath = join(profileDir, 'cordis.yml');
  if (!existsSync(cordisPath)) writeFileSync(cordisPath, '# dsh profile root — an empty entry list.\n[]\n');
}

/**
 * 解析隔离 home：闸门经 STUB_HOME 注入时直接用；standalone 时自建临时 home 并在退出时
 * 删除。刻意不读 ambient `DSH_HOME`——dsh 会话自身会把它设成真实 `~/.dsh`，直接采用会
 * 把 T2 的会话与 profile 回写写进用户目录。无论哪条路径都不写真实 `~/.dsh`。
 */
function resolveHome() {
  const provided = process.env.STUB_HOME;
  if (provided !== undefined && provided.length > 0) return { home: resolve(provided), owned: false };
  const home = mkdtempSync(join(tmpdir(), 'dsh-gate-stub-'));
  return { home, owned: true };
}

function prepareEnv(scenario) {
  const { home, owned } = resolveHome();
  process.env.HOME = home;
  process.env.DSH_HOME = home;
  if (process.env.STUB_SESSION_ROOT === undefined) {
    process.env.STUB_SESSION_ROOT = join(home, 'stub-sessions', scenario.id);
  }
  if (process.env.STUB_PRESET_ROOT === undefined) {
    process.env.STUB_PRESET_ROOT = join(REPO_ROOT, 'presets');
  }
  mkdirSync(process.env.STUB_SESSION_ROOT, { recursive: true });
  seedHeadlessProfile(home);
  return { home, owned };
}

// ── 场景契约 ────────────────────────────────────────────────────────────────

function assertScenarioShape(scenario, path) {
  if (typeof scenario.id !== 'string' || scenario.id.length === 0) throw new Error(`gate-stub: ${path} must export a string id`);
  if (typeof scenario.finding !== 'string') throw new Error(`gate-stub: ${path} must export finding (source of the regression)`);
  if (typeof scenario.invariant !== 'string' || scenario.invariant.length === 0) {
    throw new Error(`gate-stub: ${path} must export a non-empty invariant (what the scenario locks)`);
  }
  if (typeof scenario.assert !== 'function') throw new Error(`gate-stub: ${path} must export assert(events, context)`);
  if (typeof scenario.run === 'function') return;
  if (!Array.isArray(scenario.turns) || scenario.turns.length === 0) {
    throw new Error(`gate-stub: ${path} must export a non-empty turns array (or a run(harness) hook)`);
  }
  if (typeof scenario.userMessage !== 'string' || scenario.userMessage.length === 0) {
    throw new Error(`gate-stub: ${path} must export a non-empty userMessage (or a run(harness) hook)`);
  }
}

/** 场景断言 → 报告形状；断言函数抛错也算一条可定位的失败，不吞异常。 */
function normalizeAssertions(raw) {
  if (!Array.isArray(raw)) throw new Error('gate-stub: scenario assert() must return an array');
  return raw.map((entry, index) => {
    if (typeof entry?.id !== 'string' || typeof entry?.ok !== 'boolean') {
      throw new Error(`gate-stub: assertion #${String(index + 1)} must be { id: string, ok: boolean, evidence: string }`);
    }
    return {
      id: entry.id,
      status: entry.ok ? 'pass' : 'fail',
      evidence: String(entry.evidence ?? ''),
      ...(entry.detail === undefined ? {} : { detail: entry.detail }),
    };
  });
}

function withTimeout(promise, label) {
  const ms = Number(process.env.STUB_TIMEOUT_MS ?? 120_000);
  let timer;
  const guard = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`gate-stub: ${label} timed out after ${String(ms)}ms`)), ms);
  });
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
}

function hostVersion() {
  try {
    return JSON.parse(readFileSync(INSTALL_ANCHOR, 'utf8')).version;
  } catch {
    return undefined;
  }
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  return path;
}

// ── 主流程 ─────────────────────────────────────────────────────────────────

async function run(options) {
  const scenarioPath = resolveScenarioPath(options.scenario);
  const scenario = await import(pathToFileURL(scenarioPath).href);
  assertScenarioShape(scenario, scenarioPath);

  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const env = prepareEnv(scenario);
  const report = {
    schema: 'dsh-gate-stub/1',
    scenario: { id: scenario.id, finding: scenario.finding, invariant: scenario.invariant, path: scenarioPath },
    hostVersion: hostVersion(),
    startedAt,
    finishedAt: null,
    durationMs: null,
    route: { provider: STUB_PROVIDER, model: STUB_MODEL },
    sessionId: null,
    sessions: [],
    facts: {},
    calls: [],
    assertions: [],
    summary: { passed: 0, failed: 0 },
  };
  const reportPath = options.json ?? process.env.STUB_REPORT ?? defaultReportPath(scenario.id);
  let sessionDump = {};

  try {
    await healProfilesModuleFallback({ installAnchor: INSTALL_ANCHOR, home: env.home });
    const profile = loadProfile('dsh', 'headless', INSTALL_ANCHOR);
    const hostSettings = loadOverlayPatches('gate-stub', SUBAGENT_SETTINGS_PATCH);
    const overlay = loadOverlayPatches('gate-stub', STUB_PATCH);
    const patches = [...profile.layers.flatMap((layer) => layer.patches), ...profile.patches, ...hostSettings, ...overlay];
    const ctx = await boot('gate-stub', join(profile.dir, 'cordis.yml'), patches);
    await withTimeout(ctx.get('loader')?.await(), 'composition load');

    const llm = ctx.get('llm');
    const providers = (llm?.listProviders?.() ?? []).map((provider) => provider.id);
    if (!providers.includes(STUB_PROVIDER)) {
      throw new Error(`gate-stub: provider "${STUB_PROVIDER}" not registered after boot (providers: ${providers.join(', ')})`);
    }
    const agents = ctx.get('agents');
    const agentPresets = ctx.get('agentPresets');
    if (agents === undefined || agentPresets === undefined) {
      throw new Error('gate-stub: missing agents/agentPresets services in the booted composition');
    }

    // 适配器与 runner 共享同一模块实例（同一绝对路径导入）；场景在创建 agent 前装载。
    stubState.scenario = scenario;
    stubState.calls.length = 0;

    const harness = createHarness({ ctx, agents, agentPresets, preset: PRESET, wait: withTimeout, scenarioId: scenario.id });
    if (typeof scenario.run === 'function') {
      await withTimeout(scenario.run(harness), `scenario ${scenario.id} run`);
    } else {
      const { agent } = await harness.createAgent({ label: 'main' });
      await harness.followup(agent, scenario.userMessage);
    }

    const primary = harness.primary();
    if (primary === undefined) throw new Error('gate-stub: scenario created no agent session');
    const collected = primary.agent.session.snapshotEvents();
    report.sessionId = primary.id;
    report.sessions = harness.records();
    report.facts = harness.facts;
    report.calls = stubState.calls;
    sessionDump = Object.fromEntries(harness.feed.ids().map((id) => [id, harness.events(id)]));
    try {
      report.assertions = normalizeAssertions(scenario.assert(collected, { agent: primary.agent, ctx, stub: stubState, harness }));
    } catch (error) {
      report.assertions = [{ id: 'scenario.assert', status: 'fail', evidence: String(error?.message ?? error) }];
    }
  } catch (error) {
    report.assertions = [{ id: 'stub.bootstrap', status: 'fail', evidence: String(error?.message ?? error) }];
  } finally {
    if (env.owned) rmSync(env.home, { recursive: true, force: true });
  }

  report.finishedAt = new Date().toISOString();
  report.durationMs = Date.now() - startedMs;
  report.summary = {
    passed: report.assertions.filter((assertion) => assertion.status === 'pass').length,
    failed: report.assertions.filter((assertion) => assertion.status === 'fail').length,
  };
  writeJson(reportPath, report);
  if (process.env.STUB_DUMP_EVENTS === '1') {
    writeJson(`${reportPath}.events.json`, { sessionId: report.sessionId, sessions: sessionDump });
  }

  process.stdout.write(`[T2] scenario=${scenario.id} finding=${scenario.finding}\n`);
  for (const assertion of report.assertions) {
    process.stdout.write(`  ${assertion.status.toUpperCase().padEnd(4)} ${assertion.id} — ${assertion.evidence}\n`);
  }
  process.stdout.write(
    `[T2] summary: ${String(report.summary.passed)} passed, ${String(report.summary.failed)} failed — report ${reportPath}\n`,
  );
  return report.summary.failed === 0 ? 0 : 1;
}

const options = parseArgs(process.argv.slice(2));
process.exit(await run(options));
