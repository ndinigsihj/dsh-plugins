/**
 * Seeded（fork/rewind）会话的预览日志读取回退（finding 06-4）。
 *
 * rc.1 `sessionQuery.readSession` 的 snapshot 构造要求 `inheritedEventCount ===
 * events.length`；fork/rewind 子会话在 append 启动事件后必然违反，抛
 * `seeded session constructor seed must equal its inherited prefix`。这里改用两个
 * 不构造 Session 的公开读者重建同一份原始日志：`listEvents` 给出完整 seq/type 清单，
 * `readEvent` 按窗口返回完整事件行（窗口上限由部署的 `readWindowMax` 决定，默认 50）。
 * 调用方拿到后复用原有的 `sessionProjectionCache.coldSnapshot` + 预览构建路径，
 * 语义与快路径一致。
 */

/** 预览构建关心的最小事件形状（完整事件行）。 */
export interface PreviewLogEvent {
  type: string;
  seq?: number;
  time?: number;
  data?: unknown;
}

/** `readEvent` 窗口的公开形状（只声明本模块用到的字段）。 */
export interface PreviewLogWindow {
  session?: { id: string; version: number; createdAt: number; isSeeded: boolean };
  inheritedEventCount?: number;
  events?: ReadonlyArray<PreviewLogEvent>;
  endSeq?: number;
}

/** 所需的最小 query 表面；两项都是可选能力，缺失时必须退回调用方的 null 行为。 */
export interface PreviewLogQuery {
  listEvents?(sessionId: string): Promise<ReadonlyArray<{ type: string; seq?: number }>>;
  readEvent?(request: {
    sessionId: string;
    seq: number;
    before?: number;
    after?: number;
  }): Promise<PreviewLogWindow>;
}

/** 重建结果：与 `readSession` 快照同形的三件套。 */
export interface PreviewLog {
  session: { id: string; version: number; createdAt: number; isSeeded: boolean };
  inheritedEventCount: number;
  events: ReadonlyArray<PreviewLogEvent>;
}

/**
 * 经 `listEvents` + 分窗 `readEvent` 重建一整份原始日志。
 *
 * 任一步缺失、抛错（由调用方捕获）或覆盖不完整（事件数/seq 与 `listEvents`
 * 不一致）都返回 `undefined`，让调用方保持「预览不可用」的原行为。
 */
export async function readPreviewLog(
  query: PreviewLogQuery,
  sessionId: string,
  windowSize = 50,
): Promise<PreviewLog | undefined> {
  const { listEvents, readEvent } = query;
  if (listEvents === undefined || readEvent === undefined) return undefined;

  const records = await listEvents.call(query, sessionId);
  if (records.length === 0) return undefined;
  const firstSeq = records[0]?.seq;
  const lastSeq = records[records.length - 1]?.seq;
  if (typeof firstSeq !== "number" || typeof lastSeq !== "number") return undefined;

  const events: PreviewLogEvent[] = [];
  let session: PreviewLog["session"] | undefined;
  let inheritedEventCount: number | undefined;
  let cursor = firstSeq;
  while (cursor <= lastSeq) {
    // 必须以 query 为接收者调用：session-query 内部方法依赖 this。
    const window = await readEvent.call(query, {
      sessionId,
      seq: cursor,
      before: 0,
      after: windowSize,
    });
    const rows = window.events ?? [];
    if (rows.length === 0) return undefined;
    if (session === undefined) {
      if (window.session === undefined || typeof window.inheritedEventCount !== "number") {
        return undefined;
      }
      session = window.session;
      inheritedEventCount = window.inheritedEventCount;
    }
    events.push(...rows);
    const reached = window.endSeq ?? cursor + rows.length - 1;
    if (reached < cursor) return undefined;
    cursor = reached + 1;
  }

  if (session === undefined || inheritedEventCount === undefined) return undefined;
  if (events.length !== records.length) return undefined;
  for (let index = 0; index < records.length; index += 1) {
    if (events[index]?.seq !== records[index]?.seq) return undefined;
  }
  return { session, inheritedEventCount, events };
}
