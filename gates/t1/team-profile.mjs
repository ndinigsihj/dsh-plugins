/**
 * T1 的 tui-team 配置导出断言（票据 09）。
 *
 * 派生渲染与 `dsh --profile tui-team --dump-config` 在 `gates/team-profile.mjs` 完成
 * （real 模式下由 `gates/run.mjs` 的 `renderTeamInto` 预跑），本模块只把结果落成闸门断言：
 * 组合导出 exit 0、逐 loader id 递归计数为 1（验收项「组合无重复 id、可启动」）。
 *
 * `gate` 组合模式没有真实 tui-dev 源 profile，不产生该断言（real 专属）。
 */
import { TEAM_PROFILE, TEAM_PROFILE_SOURCE } from "../team-bundle.mjs";

/** ⑬ 派生 tui-team 的配置导出与 loader id 唯一性（real 模式）。 */
export function assertTeamProfile(t, config, report) {
  if (config.composition !== "real") return;
  const team = config.realTeam;
  if (team === undefined || team === null) {
    t.fail("composition.team-profile", "tui-team derive/dump unavailable (see composition.team-render)");
    return;
  }
  const { dump, rendered, bundles } = team;
  const ok = team.ok;
  t[ok ? "pass" : "fail"](
    "composition.team-profile",
    `exit ${String(dump.exit)} ids=${String(dump.ids)} duplicates=${String(dump.duplicates.length)} bundles=[${bundles.join(", ")}]`,
    {
      profile: TEAM_PROFILE,
      sourceProfile: TEAM_PROFILE_SOURCE,
      renderedPath: rendered.renderedPath,
      renderedSha: rendered.renderedSha,
      presetSource: rendered.preset.source,
      parseError: dump.parseError,
      duplicates: dump.duplicates,
    },
  );
  report.teamProfile = {
    profile: TEAM_PROFILE,
    sourceProfile: TEAM_PROFILE_SOURCE,
    ids: dump.ids,
    duplicates: dump.duplicates,
    dumpExit: dump.exit,
    bundles,
    renderedSha: rendered.renderedSha,
  };
}
