/**
 * 真实 home 零写入指纹与隔离断言（票据 01 从 `gates/run.mjs` 拆出）。
 *
 * 隔离：全部输入来自真实 `~/.dsh` 的只读扫描；本模块不写任何文件。
 * `strict: false` 的区是「活跃会话会合法写入」的位置，只记录变化、不判红。
 */
import { existsSync, lstatSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createAssertions, diffRealHome, sha256Json } from "./gate-helpers.mjs";
import { resolveDeploymentRoot } from "./manifest.mjs";

/** 路径指纹：目录递归记「相对路径 + 大小」，普通文件记「大小」。 */
function scanTree(path) {
  if (!existsSync(path)) return { exists: false, entries: 0 };
  if (!statSync(path).isDirectory()) return { exists: true, entries: 1, signature: sha256Json([String(statSync(path).size)]) };
  const lines = [];
  let files = 0;
  const walk = (current, prefix) => {
    const entries = readdirSync(current, { withFileTypes: true });
    for (const dirent of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const child = join(current, dirent.name);
      const rel = `${prefix}${dirent.name}`;
      if (dirent.isDirectory()) walk(child, `${rel}/`);
      else {
        files += 1;
        // lstat: 真实 home 的 .dsh-module-fallback 常用指向 node_modules 的符号链接，
        // 目标树可能缺失（悬空链接）；指纹只关心链接本身，不跟随目标。
        lines.push(`${rel}\t${String(lstatSync(child).size)}`);
      }
    }
  };
  walk(path, "");
  return { exists: true, entries: files, signature: sha256Json(lines) };
}

/** 真实 home 的只读指纹：严格区（profiles/settings/credentials/deployment）+ 只记录区（storages/sessions）。 */
export function scanRealHome(manifest) {
  const realHome = homedir();
  // 只读指纹：`strict: false` 的区是「活跃会话会合法写入」的位置（当前会话的投影缓存
  // 就在 storages 下），只记录变化、不判红——否则在另一个终端跑 TUI 时闸门会假红。
  const paths = {
    profiles: join(realHome, ".dsh", "profiles"),
    storages: { path: join(realHome, ".dsh", "storages"), strict: false, reason: "live sessions write projection cache here" },
    "root:settings.yaml": join(realHome, ".dsh", "settings.yaml"),
    "root:.credentials.yaml": join(realHome, ".dsh", ".credentials.yaml"),
  };
  for (const [preset, entry] of Object.entries(manifest.deployment)) {
    paths[`deployment:${preset}`] = resolveDeploymentRoot(entry, realHome);
  }
  const snapshot = {};
  for (const [label, spec] of Object.entries(paths)) {
    const entry = typeof spec === "string" ? { path: spec } : spec;
    snapshot[label] = { ...scanTree(entry.path), ...(entry.strict === false ? { strict: false, reason: entry.reason } : {}) };
  }
  const sessions = join(realHome, ".dsh", "sessions");
  // 会话区只数条目：会话追加不改条目数，新建会话才改；比深指纹安全，仍能抓住「闸门写进真实 store」。
  snapshot.sessions = { exists: existsSync(sessions), entries: countTree(sessions), signature: `count:${String(countTree(sessions))}` };
  return snapshot;
}

/**
 * 严格区的隔离差异：`strict: false` 的区（活跃会话合法写入）只记录不判红。
 * 判定依据取「before」快照——区集合以运行前扫描为准。
 */
export function strictIsolationDiffs(before, diffs) {
  return diffs.filter((diff) => before[diff.zone]?.strict !== false);
}

/**
 * 单次窗口的真实 home 零写入断言（与 T1 第 ⑨ 条同口径：严格区零变化；活跃写入区只记录）。
 * 每层各取一次「运行开始 → 本层结束」的累计窗口：最后一个跑到的层天然覆盖全程，
 * 因此 `--tier 0,1,2`（无 T3）也不会漏掉 T1/T2 自身的写入窗口。
 */
export function isolationAssertions(id, before, after) {
  const t = createAssertions();
  const diffs = diffRealHome(before, after);
  const strict = strictIsolationDiffs(before, diffs);
  t[strict.length === 0 ? "pass" : "fail"](
    id,
    strict.length === 0
      ? `signature identical before/after (strict zones; ${String(diffs.length)} observed-only changes)`
      : JSON.stringify(strict),
    { observedChanges: diffs },
  );
  return t.assertions;
}

function countTree(dir) {
  if (!existsSync(dir)) return 0;
  let count = 0;
  const walk = (current) => {
    for (const dirent of readdirSync(current, { withFileTypes: true })) {
      count += 1;
      if (dirent.isDirectory()) walk(join(current, dirent.name));
    }
  };
  walk(dir);
  return count;
}
