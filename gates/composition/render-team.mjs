/**
 * tui-team 的派生渲染与配置导出接线（票据 09；从 `gates/run.mjs` 拆出，守住单文件 <300 行）。
 *
 * 与 `render-real.mjs` 的 tui-dev 渲染同源：在隔离 home 里从真实 tui-dev 派生、追加
 * Team bundle，并跑 `--dump-config`（实现见 `gates/team-profile.mjs`）。失败语义与 real
 * 一致：渲染/解析前置失败 → 环境前置失败（exit 2），绝不静默跳过。
 */
import { homedir } from "node:os";
import { installAnchor } from "../host-pin.mjs";
import { resolveDeploymentRoot } from "../manifest.mjs";
import { PRESET } from "../paths.mjs";
import { TEAM_PROFILE, TEAM_PROFILE_SOURCE } from "../team-bundle.mjs";
import { RenderRealError } from "./render-real.mjs";
import { checkTeamProfile } from "../team-profile.mjs";

/**
 * 渲染派生 tui-team 并落 PRE 断言/报告；返回 `checkTeamProfile` 结果供 T1 断言，
 * 非 real 模式或前置已失败时返回 null。
 */
export function renderTeamInto(ctx) {
  const { options, manifest, host, report, pre } = ctx;
  if (options.composition !== "real" || host === undefined || manifest.status !== "ok" || !ctx.preconditionsOk) return null;
  const deploymentEntry = manifest.manifest.deployment?.[PRESET];
  try {
    const team = checkTeamProfile({
      tempHome: ctx.tempHome,
      deploymentRoot: deploymentEntry === undefined ? undefined : resolveDeploymentRoot(deploymentEntry, homedir()),
      installAnchor: installAnchor(host),
      env: ctx.env,
      homeDir: homedir(),
    });
    pre.pass(
      "composition.team-render",
      `profile=${TEAM_PROFILE} source=${TEAM_PROFILE_SOURCE} rendered=${team.rendered.renderedSha.slice(0, 12)} dump exit=${String(team.dump.exit)} ids=${String(team.dump.ids)} duplicates=${String(team.dump.duplicates.length)}`,
      { bundles: team.bundles, presetSource: team.rendered.preset.source, renderedPath: team.rendered.renderedPath },
    );
    report.compositionTeam = {
      profile: TEAM_PROFILE,
      sourceProfile: TEAM_PROFILE_SOURCE,
      renderedPath: team.rendered.renderedPath,
      renderedSha: team.rendered.renderedSha,
      bundles: team.bundles,
      presetSource: team.rendered.preset.source,
      dump: team.dump,
    };
    return team;
  } catch (error) {
    ctx.preconditionsOk = false;
    ctx.preconditionDetail = error instanceof RenderRealError ? error.message : `tui-team composition render failed: ${String(error.message ?? error)}`;
    pre.fail("composition.team-render", ctx.preconditionDetail, error.detail);
    return null;
  }
}
