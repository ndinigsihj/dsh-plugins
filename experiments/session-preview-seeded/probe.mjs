/**
 * Stage 7 反馈回路（finding 06-4）：seeded（rewind/fork）子会话的 hover 预览读取。
 *
 * 运行：experiments/session-preview-seeded/run.sh [sessionId]
 *
 * 红线（修复前，必红）：`sessionQuery.readSession(seeded)` 抛错（seeded prefix 校验），
 *   现行 TUI `sessionPreview` 走 catch 返回 null —— 预览不可用。
 * 绿线（修复后）：`lib/session-preview-log.ts` 的 `readPreviewLog()` 经
 *   `listEvents` + 分块 `readEvent` 重建全量原始日志，事件数与首尾 seq 与
 *   `listEvents` 完全一致，供同一 `coldSnapshot` + 预览构建使用。
 *
 * 零 LLM：只读真实会话文件。默认 fixture 为票据 06 的 rewind 子会话
 * （`~/.dsh/sessions/--private-tmp-dsh-ticket06-ws3--/session-6846f8fa-…`），
 * 可用参数或 `SEEDED_SESSION_ID` 覆盖；报告写 `$PROBE_OUT`（默认
 * /tmp/dsh-ticket13-seeded-preview/probe.json），全 PASS 退出码 0。
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const name = "session-preview-seeded-probe";
/** sessionQuery 是 dsh-base 提供的基础服务；声明 inject 让 apply 等服务就绪后再跑。 */
export const inject = ["sessionQuery"];

const DEFAULT_SESSION_ID = "session-6846f8fa-18eb-4ce8-8f85-4b6a36b37aff";
/** TUI 侧预览读取器：由本模块位置推导（experiments/session-preview-seeded/ → repo 根）。 */
const READER_MODULE = fileURLToPath(new URL("../../lib/session-preview-log.ts", import.meta.url));

function failureText(error) {
  if (error !== null && typeof error === "object") {
    if (typeof error.message === "string") return error.message;
    if (typeof error.name === "string") return error.name;
  }
  return String(error);
}

function record(report, id, pass, detail) {
  report.checks.push({ id, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} ${id}${detail === undefined ? "" : ` ${JSON.stringify(detail)}`}`);
}

function writeReport(report) {
  const passed = report.checks.filter((check) => check.pass).length;
  report.finishedAt = new Date().toISOString();
  report.summary = `${passed}/${report.checks.length} pass`;
  const out = process.env.PROBE_OUT ?? "/tmp/dsh-ticket13-seeded-preview/probe.json";
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`session-preview-seeded probe: ${report.summary} report=${out}`);
  return passed === report.checks.length;
}

async function run(ctx) {
  const sessionId = process.env.SEEDED_SESSION_ID ?? DEFAULT_SESSION_ID;
  const report = { startedAt: new Date().toISOString(), sessionId, checks: [] };

  const query = ctx.get("sessionQuery");
  if (query === undefined) throw new Error("session-preview-seeded probe: sessionQuery service is not mounted");
  // 注意：必须以 query 为接收者调用，解构后直接调用会丢 this（session-query 内部用 this._corpus）。
  if (typeof query.listEvents !== "function" || typeof query.readEvent !== "function") {
    throw new Error("session-preview-seeded probe: sessionQuery lacks listEvents/readEvent");
  }

  // 1. 红线前提：seeded fixture 上 readSession 必抛（现行预览因此返回 null）。
  let readSessionError = null;
  try {
    await query.readSession(sessionId);
  } catch (error) {
    readSessionError = error;
  }
  record(report, "red-readSession-rejects-seeded", readSessionError !== null, {
    error: readSessionError === null ? "(readSession unexpectedly succeeded)" : failureText(readSessionError),
  });

  // 2. 全量轻量记录（修复路径的基准）。
  const listStarted = performance.now();
  const records = await query.listEvents(sessionId);
  const listMs = Math.round(performance.now() - listStarted);
  record(report, "listEvents-has-corpus", records.length > 0, { events: records.length, listMs });

  // 3. 读取器模块（修复前不存在 → 红线）。
  let reader;
  try {
    reader = await import(READER_MODULE);
  } catch (error) {
    record(report, "green-reader-module-present", false, { error: failureText(error) });
    return writeReport(report);
  }
  if (typeof reader.readPreviewLog !== "function") {
    record(report, "green-reader-module-present", false, { error: "readPreviewLog export missing" });
    return writeReport(report);
  }
  record(report, "green-reader-module-present", true, {});

  // 4. 重建全量原始日志并校验覆盖。
  const started = performance.now();
  const loaded = await reader.readPreviewLog(query, sessionId, 50);
  const elapsedMs = Math.round(performance.now() - started);
  record(report, "green-log-reconstructed", loaded !== undefined, { elapsedMs });
  if (loaded === undefined) return writeReport(report);

  const events = loaded.events ?? [];
  const firstSeq = records[0]?.seq;
  const lastSeq = records[records.length - 1]?.seq;
  const seqsAligned =
    events.length === records.length &&
    events.every((event, index) => event.seq === records[index]?.seq);
  record(report, "green-count-and-seq-match", seqsAligned, {
    events: events.length,
    records: records.length,
    firstSeq: events[0]?.seq,
    lastSeq: events[events.length - 1]?.seq,
    expectedFirstSeq: firstSeq,
    expectedLastSeq: lastSeq,
  });
  record(report, "green-inherited-count-recorded", Number.isSafeInteger(loaded.inheritedEventCount), {
    inheritedEventCount: loaded.inheritedEventCount,
  });
  console.log(`reader chunks=${Math.ceil(records.length / 51)} elapsedMs=${elapsedMs}`);
  // 5. 二次调用（corpus 已热）成本：hover 连续选择时的真实代价。
  const warmStarted = performance.now();
  const warm = await reader.readPreviewLog(query, sessionId, 50);
  const warmMs = Math.round(performance.now() - warmStarted);
  record(report, "green-warm-call", warm !== undefined && warm.events.length === events.length, {
    warmMs,
  });
  // 6. 对照：同目录的非 seeded 父会话走 readSession 快路径的成本（非断言口径）。
  const baselineId = process.env.BASELINE_SESSION_ID ?? "session-4c66af75-ff66-4311-9451-445c8ee3b7f5";
  try {
    const baseStarted = performance.now();
    const base = await query.readSession(baselineId);
    record(report, "baseline-readSession-fastpath", true, {
      events: base.events.length,
      readSessionMs: Math.round(performance.now() - baseStarted),
    });
  } catch (error) {
    record(report, "baseline-readSession-fastpath", true, { skipped: failureText(error) });
  }
  return writeReport(report);
}

export function apply(ctx) {
  run(ctx)
    .then((ok) => process.exit(ok ? 0 : 1))
    .catch((error) => {
      console.error("SESSION-PREVIEW-SEEDED PROBE FAILED:", error);
      process.exit(1);
    });
}
