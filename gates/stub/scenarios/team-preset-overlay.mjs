/**
 * 场景 team-preset-overlay —— 票据 08（B1.5）的进程内对照臂：
 * 在 headless + Team 组合包的隔离 profile 上挂载 minimal-plus preset，读**实际工具面**，
 * 回答「普通委派工具是否与 Team 创建工具并存、路由发现工具是否出现、teammate 是否继承
 * Lead 的 preset、成员权限的真实形状」。
 *
 * 不变量：
 *   - preset 真正生效：哨兵工具 `ask_user_question`（host base 不带，仅 preset 的
 *     `tool-ask-user` 行注册）出现在 Lead 与 teammate 的工具面；
 *   - 首轮锚定在 Team 组合下仍成立：R1 只暴露 bash + str_replace_editor，promotion 后
 *     才放行完整目录；
 *   - Team 创建工具存在；`subagent` / `list_subagent_models` 的存在性冻结为 B1.5 实测
 *     关系（`overlay.delegation-relation`）——上游行为变化时红，触发计划 §3.6 复评；
 *   - 权限不靠「工具是否存在」：teammate 的工具面里可见 `spawn_teammate`，但创建/中断
 *     调用都被 `TEAM_LEAD_REQUIRED` 拒绝。
 *
 * 测量机械（抓取时点、teammate 保活、promotion 续写）见 `gates/stub/team-overlay-probe.mjs`；
 * 本文件只保留场景契约与断言。
 *
 * 与 PTY 臂的分工：本臂是 spec 指定的进程内假模型对照（`agents.create({setup})` 挂
 * preset），能直接 `spawnTeammate` 并把成员权限拒绝留成证据；真实 preset 选择路径由
 * `scripts/tui-pty-smoke.mjs --probe-tools` 的 Team 模式覆盖。
 *
 * 命令：
 *   node gates/stub/run.mjs --scenario team-preset-overlay \
 *     --json docs/tickets/dsh-v0.1.7-rc.1-upgrade/evidence/08-control-team-overlay.json
 */
import { TEAM_BUNDLE } from '../../team-bundle.mjs';
import { PRESET, SENTINEL, TEAM_SAMPLE, hasTool, measureTeamOverlay, teamOverlayTurns } from '../team-overlay-probe.mjs';

export const id = 'team-preset-overlay';
export const finding = 'B1.5（票据 08）：Team Profile 下自研 preset 的真实叠加面（subagent 与 spawn_teammate 的关系、路由发现工具、成员权限）';
export const invariant = 'Team 组合下 preset 仍真正生效（哨兵可见、R1 仍锚定）；Team 创建工具存在；teammate 继承 Lead preset；成员创建/中断被 TEAM_LEAD_REQUIRED 拒绝';
export const bundles = [TEAM_BUNDLE];
export const turns = teamOverlayTurns();

export async function run(harness) {
  harness.facts.teamOverlay = await measureTeamOverlay(harness);
}

export function assert(events, { harness } = {}) {
  const out = [];
  const push = (id, ok, evidence) => out.push({ id, ok, evidence });
  const facts = harness?.facts?.teamOverlay;

  push('preset.bound', facts?.lead?.agentPreset === PRESET && facts?.lead?.headerPreset === PRESET, `lead composed=${String(facts?.lead?.agentPreset)} header=${String(facts?.lead?.headerPreset)}`);
  push('preset.sentinel-visible', hasTool(facts?.lead?.registryTools ?? [], SENTINEL), `lead tools=${String(facts?.lead?.registryCount)} sentinel=${String(hasTool(facts?.lead?.registryTools ?? [], SENTINEL))}`);

  const r1 = facts?.lead?.r1VisibleTools ?? [];
  push(
    'preset.anchored-first-turn',
    r1.includes('bash') && r1.includes('str_replace_editor') && !r1.includes('spawn_teammate') && !r1.includes('subagent'),
    `R1 visible=${JSON.stringify(r1)}`,
  );
  const promoted = facts?.lead?.promotedVisibleTools ?? [];
  push(
    'team.creation-tools-visible',
    TEAM_SAMPLE.every((name) => promoted.includes(name)),
    `promoted missing=${JSON.stringify(TEAM_SAMPLE.filter((name) => !promoted.includes(name)))}`,
  );
  // B1.5 实测关系冻结（并存）：上游改行为时红，触发计划 §3.6 的自研 preset 复评。
  push(
    'overlay.delegation-relation',
    facts?.lead?.hasDelegation === true && facts?.lead?.hasTeamCreation === true && facts?.lead?.hasRouteDiscovery === true,
    `registry subagent=${String(facts?.lead?.hasDelegation)} spawn_teammate=${String(facts?.lead?.hasTeamCreation)} list_subagent_models=${String(facts?.lead?.hasRouteDiscovery)} promoted subagent=${String(promoted.includes('subagent'))} subagent_fork=${String(promoted.includes('subagent_fork'))}`,
  );
  push(
    'overlay.teammate-inherits-preset',
    facts?.teammate?.agentPreset === PRESET && hasTool(facts?.teammate?.registryTools ?? [], SENTINEL),
    `teammate composed=${String(facts?.teammate?.agentPreset)} header=${String(facts?.teammate?.headerPreset)} role=${String(facts?.teammate?.role)} depth=${String(facts?.teammate?.delegationDepth)}`,
  );
  push(
    'permission.member-cannot-create',
    facts?.memberSpawnDenial?.ok === false && facts?.memberSpawnDenial?.code === 'TEAM_LEAD_REQUIRED',
    `spawn from teammate (live role=${String(facts?.teammate?.liveRoleAtProbe)}): ${String(facts?.memberSpawnDenial?.message ?? '<none>')}`,
  );
  push(
    'permission.member-cannot-interrupt',
    facts?.memberInterruptDenial?.ok === false && facts?.memberInterruptDenial?.code === 'TEAM_LEAD_REQUIRED',
    `interrupt from teammate (live role=${String(facts?.teammate?.liveRoleAtProbe)}): ${String(facts?.memberInterruptDenial?.message ?? '<none>')}`,
  );

  return out;
}
