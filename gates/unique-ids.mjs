/**
 * 递归 loader id 计数（票据 03，计划 §5.4「逐 loader id 递归计数 = 1」）。
 *
 * 出处：`@deepseek-ai/dsh-app-boot` 的 `applyEntryPatches` 按 id 合并条目
 * （后一个 patch 覆盖前一个），因此**导出本身不检测重复**；真正报重复的是
 * `cordis-plugin-loader` 的 `EntryGroup.update`：
 *
 *     for (const options of config) {
 *       const id = this.tree.ensureId(options);
 *       if (seen.has(id)) throw new TypeError(`duplicate loader entry id: ${id}`);
 *       seen.add(id);
 *     }
 *
 * 即「重复」的判定域是**同一 group 的兄弟条目**（group 条目自己的子列表在
 * `config` 数组里，由 `entry.group === true` 标记）。所以本模块递归进每个
 * group，逐组统计 id，返回重复项——这正是启动作业里会让整套 profile 挂不
 * 起来的那类冲突（2026-09-10 实测：重复 `insert` 服务行 → duplicate loader
 * entry id）。
 */

/** 判断一个组合条目是否是 group（其 `config` 是子条目数组）。 */
function children(entry) {
  if (entry === null || typeof entry !== "object") return undefined;
  if (entry.group !== true && entry.group === undefined) return undefined;
  return Array.isArray(entry.config) ? entry.config : [];
}

/**
 * 递归收集重复 id。
 * @param entries 组合后的条目列表（`composeEntries` / `--dump-config` 的形状）。
 * @returns `[{ path, id, count }]`；`path` 是 group id 链（顶层为 `""`）。
 */
export function findDuplicateIds(entries) {
  const duplicates = [];
  walk(entries, "", duplicates);
  return duplicates;
}

function walk(entries, path, duplicates) {
  if (!Array.isArray(entries)) return;
  const seen = new Set();
  const repeated = new Set();
  for (const entry of entries) {
    if (entry === null || typeof entry !== "object") continue;
    if (typeof entry.id === "string") {
      if (seen.has(entry.id)) repeated.add(entry.id);
      else seen.add(entry.id);
    }
    const nested = children(entry);
    if (nested !== undefined) walk(nested, path === "" ? String(entry.id ?? "?") : `${path}:${entry.id}`, duplicates);
  }
  for (const id of repeated) {
    duplicates.push({ path, id, count: entries.filter((entry) => entry?.id === id).length });
  }
}

/** 递归计数：每个 group 层的条目数与 id 总数。 */
export function countEntries(entries) {
  const total = { groups: 0, ids: 0, maxDepth: 0 };
  count(entries, 0, total);
  return total;
}

function count(entries, depth, total) {
  if (!Array.isArray(entries)) return;
  total.maxDepth = Math.max(total.maxDepth, depth);
  for (const entry of entries) {
    if (entry === null || typeof entry !== "object") continue;
    if (typeof entry.id === "string") total.ids += 1;
    const nested = children(entry);
    if (nested === undefined) continue;
    total.groups += 1;
    count(nested, depth + 1, total);
  }
}
