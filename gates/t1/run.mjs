/**
 * T1 零 LLM 组合层编排（票据 01 从 `gates/run.mjs` 拆出）。
 *
 * 组合面见 `./composition.mjs`，preset 行为面见 `./preset.mjs`；
 * 本模块保留部署位、宿主钉版、隔离与副本 sha 这几组断言及 ①–⑫ 的调用顺序。
 */
import { join } from "node:path";
import { createAssertions, diffRealHome, sha256File } from "../gate-helpers.mjs";
import { scanRealHome, strictIsolationDiffs } from "../isolation.mjs";
import { appendHostPinAssertions } from "../host-pin.mjs";
import { REAL_PROFILE_NAME } from "../composition/render-real.mjs";
import { assertCompositionDump, assertLoaderIdsUnique, assertNoDeploymentSync, assertNoStub } from "./composition.mjs";
import { assertDeployment } from "./deployment.mjs";
import { assertDegradeFailOpen, assertPresetSmoke, assertSeededPreview } from "./preset.mjs";

/**
 * ⑨ 真实 home 零写入（前快照在闸门启动时、后快照在本层子进程全部跑完后取；
 *    storages 等活跃写入区只记录）。
 */
function assertRealHomeIsolation(t, config, report) {
  const realHomeAfter = scanRealHome(config.manifestObj);
  const diffs = diffRealHome(config.realHomeBefore, realHomeAfter);
  const strictDiffs = strictIsolationDiffs(config.realHomeBefore, diffs);
  report.isolation = {
    strictZones: Object.entries(config.realHomeBefore)
      .filter(([, zone]) => zone.strict !== false)
      .map(([label]) => label),
    observedChanges: diffs,
    strictChanges: strictDiffs,
  };
  t[strictDiffs.length === 0 ? "pass" : "fail"](
    "isolation.real-home-untouched",
    strictDiffs.length === 0
      ? `signature identical before/after (strict zones; ${String(diffs.length)} observed-only changes)`
      : JSON.stringify(strictDiffs),
    { strictZones: report.isolation.strictZones, observedChanges: diffs },
  );
}

/** ⑩ 副本侧被回写文件的 sha（宿主规范化回写落临时副本即接受；real 另记真实 profile 副本）。 */
function assertCopyRewriteSha(t, config) {
  const real = config.composition === "real";
  const copyCordis = sha256File(join(config.tempHome, "profiles", "headless", "cordis.yml"));
  const realCopyCordis = real ? sha256File(join(config.tempHome, "profiles", REAL_PROFILE_NAME, "cordis.yml")) : undefined;
  const copyEvidence = real
    ? `headless cordis.yml sha256=${String(copyCordis).slice(0, 12)} ${REAL_PROFILE_NAME} cordis.yml sha256=${String(realCopyCordis).slice(0, 12)}`
    : `cordis.yml sha256=${String(copyCordis).slice(0, 12)}`;
  t.pass("isolation.copy-rewrite-sha", copyEvidence, {
    paths: [join(config.tempHome, "profiles", "headless", "cordis.yml"), ...(real ? [join(config.tempHome, "profiles", REAL_PROFILE_NAME, "cordis.yml")] : [])],
  });
}

/** ⑫ real：源 profile 只读（渲染前后 sha 一致）；报告记源 sha 与渲染后 sha 供追溯。 */
function assertSourceProfileUnchanged(t, config) {
  if (config.composition !== "real" || config.real === null) return;
  const afterSha = sha256File(config.real.sourcePath);
  const unchanged = afterSha === config.real.sourceSha;
  t[unchanged ? "pass" : "fail"](
    "composition.source-profile-unchanged",
    `source ${config.real.sourcePath} before=${String(config.real.sourceSha).slice(0, 12)} after=${String(afterSha).slice(0, 12)}`,
    { sourcePath: config.real.sourcePath, sourceSha: config.real.sourceSha, afterSha },
  );
}

/** 跑 T1 并返回断言列表；调用顺序即拆分前 ①–⑫ 的原文顺序。 */
export async function runT1(config, report) {
  const t = createAssertions();
  const dump = assertCompositionDump(t, config);
  assertLoaderIdsUnique(t, config, dump);
  assertNoStub(t, config, dump.dumpText);
  assertPresetSmoke(t, config, report);
  assertDegradeFailOpen(t, config);
  assertSeededPreview(t, config, report);
  assertDeployment(t, config, report);
  report.host = await appendHostPinAssertions(t, config);
  assertRealHomeIsolation(t, config, report);
  assertCopyRewriteSha(t, config);
  assertNoDeploymentSync(t);
  assertSourceProfileUnchanged(t, config);
  return t.assertions;
}
