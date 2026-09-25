/**
 * Team 组合包与 Team 工作 Profile 的唯一名字来源（票据 08/09）：PTY 冒烟的 Team 断言、
 * T2 对照场景的 bundles 声明、T1 的 tui-team 配置导出检查与 render-real 单测共享，
 * 避免同一裸包名/派生规则在多处各写一遍。
 */

/** Team 实验组合包名。 */
export const TEAM_BUNDLE = "@deepseek-ai/dsh-experimental-agent-team-profile";

/**
 * Team 工作 Profile 名（C 方案：单独 Profile 承载 Team，见 spec「Team」）。
 * 真实 `~/.dsh/profiles/tui-team` 的物化归收口票 12；票据 09 在隔离 home 派生验证。
 */
export const TEAM_PROFILE = "tui-team";

/** 派生 tui-team 的只读源 profile（真实 dev 组合）。 */
export const TEAM_PROFILE_SOURCE = "tui-dev";

/** 目标 profile 名对应需要追加的 bundle（非 Team profile 为空；去重由调用方/render-real 负责）。 */
export function bundlesForProfile(profileName) {
  return profileName === TEAM_PROFILE ? [TEAM_BUNDLE] : [];
}
