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
 * 零 LLM，且不读用户环境（票 02）：探针在 apply 时把入库 fixture
 * `experiments/fixtures/session-preview-seeded/store`（原样字节快照，含父会话基线）
 * 复制到临时 session store（`SEEDED_PREVIEW_SESSIONS_ROOT`），复制前后做逐文件
 * sha256 双向校验。fixture 缺失或复制漂移一律 FAIL 并写出报告——「fixture 被清理
 * 导致探针静默失效」不再可能；指向真实 `~/.dsh/sessions` 的配置会被拒绝。
 * fixture 会话的原 cwd（`/private/tmp/dsh-ticket06-ws3`）已删，实测读取不依赖它。
 *
 * 报告写 `$PROBE_OUT`（默认 `<临时根>/probe.json`）；全 PASS 退出码 0。
 */
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export const name = "session-preview-seeded-probe";
/** sessionQuery 是 dsh-base 提供的基础服务；声明 inject 让 apply 等服务就绪后再跑。 */
export const inject = ["sessionQuery"];

const DEFAULT_SESSION_ID = "session-6846f8fa-18eb-4ce8-8f85-4b6a36b37aff";
const DEFAULT_BASELINE_ID = "session-4c66af75-ff66-4311-9451-445c8ee3b7f5";
/** TUI 侧预览读取器：由本模块位置推导（experiments/session-preview-seeded/ → repo 根）。 */
const READER_MODULE = fileURLToPath(new URL("../../lib/session-preview-log.ts", import.meta.url));
/** 入库 fixture 的 store 切片（票 02/Q5：原样字节快照，含父会话基线）。 */
const FIXTURE_STORE = fileURLToPath(new URL("../fixtures/session-preview-seeded/store", import.meta.url));
/** 仓库根：用于确认 fixture 来自入库快照而非用户目录。 */
const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
/** 临时 session store；run.sh 通过 env 传入，默认与 probe.patch.yml 的兜底一致。 */
const SESSIONS_ROOT = process.env.SEEDED_PREVIEW_SESSIONS_ROOT ?? "/tmp/dsh-seeded-preview/sessions";

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
  const out = process.env.PROBE_OUT ?? join(dirname(SESSIONS_ROOT), "probe.json");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`session-preview-seeded probe: ${report.summary} report=${out}`);
  const fixtureSource = report.inputs?.fixture?.source ?? "(unprepared)";
  console.log(`session-preview-seeded probe inputs: repo fixture ${fixtureSource} -> ${SESSIONS_ROOT} (user sessions not read)`);
  return passed === report.checks.length && report.checks.length > 0;
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** fixture 内的全部常规文件（相对路径，稳定排序）。 */
function listFixtureFiles(root) {
  const files = [];
  const walk = (dir, prefix) => {
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) walk(join(dir, entry.name), rel);
      else if (entry.isFile()) files.push(rel);
    }
  };
  walk(root, "");
  return files;
}

/**
 * 自建临时工作目录：入库 fixture → 临时 session store，并逐文件 sha256 双向校验。
 * 任何前置不成立（缺 fixture、指向真实用户 store）都抛错，由调用方记 FAIL 落报告。
 */
function prepareFixtureStore() {
  const realUserStore = join(homedir(), ".dsh", "sessions");
  if (SESSIONS_ROOT === realUserStore || SESSIONS_ROOT.startsWith(`${realUserStore}/`)) {
    throw new Error(`refusing to run against the real user session store: ${SESSIONS_ROOT}`);
  }
  if (!FIXTURE_STORE.startsWith(REPO_ROOT)) {
    throw new Error(`fixture store is not inside the repository: ${FIXTURE_STORE}`);
  }
  if (!existsSync(FIXTURE_STORE)) throw new Error(`repo fixture store is missing: ${FIXTURE_STORE}`);
  const relativePaths = listFixtureFiles(FIXTURE_STORE);
  if (relativePaths.length === 0) throw new Error(`repo fixture store has no files: ${FIXTURE_STORE}`);

  mkdirSync(SESSIONS_ROOT, { recursive: true });
  cpSync(FIXTURE_STORE, SESSIONS_ROOT, { recursive: true, force: true });
  const files = relativePaths.map((path) => {
    const source = sha256File(join(FIXTURE_STORE, path));
    return {
      path,
      bytes: statSync(join(FIXTURE_STORE, path)).size,
      sha256: source,
      copiedByteIdentical: sha256File(join(SESSIONS_ROOT, path)) === source,
    };
  });
  return {
    origin: "repository raw-byte snapshot (ticket 02 / Q5)",
    source: relative(REPO_ROOT, FIXTURE_STORE),
    sessionsRoot: SESSIONS_ROOT,
    userSessionsRead: false,
    files,
  };
}

async function run(ctx) {
  const sessionId = process.env.SEEDED_SESSION_ID ?? DEFAULT_SESSION_ID;
  const baselineId = process.env.BASELINE_SESSION_ID ?? DEFAULT_BASELINE_ID;
  const report = { startedAt: new Date().toISOString(), sessionId, baselineSessionId: baselineId, checks: [] };

  // 0. 输入准备：仓库 fixture → 临时 store（票 02；不再依赖用户 settings / sessions）。
  let fixture;
  try {
    fixture = prepareFixtureStore();
    report.inputs = { fixture };
    record(report, "fixture-store-prepared", true, {
      source: fixture.source,
      sessionsRoot: fixture.sessionsRoot,
      files: fixture.files.length,
    });
    const identical = fixture.files.every((file) => file.copiedByteIdentical);
    record(report, "fixture-copied-byte-identical", identical, {
      files: fixture.files.map((file) => `${file.path} ${file.sha256.slice(0, 12)}… ${file.bytes}B`),
    });
    if (!identical) return writeReport(report);
  } catch (error) {
    record(report, "fixture-store-prepared", false, { error: failureText(error) });
    return writeReport(report);
  }

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
