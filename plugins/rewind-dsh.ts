/**
 * dsh-rewind — 独立 /rewind 命令插件（方案 2：工具日志逆向文件恢复）。
 *
 * 设计目标（详见 docs/rewind-file-restore-plugin.md）：
 *
 * 1. **不依赖第三方 dsh-tui（@deepseek-harness-tui/dsh-tui）的 tui/rewind-prompt
 *    决策事件**——那条缝走 host 中介的 DecisionEvents registry + Component 准入 +
 *    grant，对本地 patch-insert 的薄插件不可用（会被 internal/listener 守卫拒绝）。
 * 2. 本插件只消费 dsh 的**标准进程内服务**（agents / commands /
 *    tuiHandoff），与 rename-session 同级，
 *    可直接 patch-insert。
 * 3. `/rewind` 是**自研 TUI 的 /rewind 实现**：自研 TUI 没有本地同名命令，
 *    输入经命令注册表执行；本插件把「回退对话 + 回滚文件」合二为一，且不碰 TUI 本体。
 *
 * 工作流（与 dsh-tui 参考实现的 rewindTo 语义同构，但走跨进程 handoff）：
 *
 *   /rewind            → 列出历史 user 消息（seq + 摘要），提示 /rewind <seq>
 *   /rewind <seq>      → 1) 计算 boundary（回退到该消息所在 turn 之前）
 *                        2) tuiHandoff.forkPersistedChild(seed)：由 TUI 经宿主
 *                           agent 生命周期创建并落盘 fork 子会话（finding 06-1；
 *                           rc.1 裸 sessions.fork() 的子会话只在内存里，execve
 *                           后的新进程 resume 不到）
 *                        3) 逆向恢复文件：源日志里 seq>boundary 的 write/edit
 *                           反向应用回滚到边界点（方案 2 核心，纯函数可单测）
 *                        4) tuiHandoff.relaunchToResume(childId, summary)：
 *                           execve 重启（argv 剥旧 --resume）+ 摘要留到 shell
 *
 * 挂载（tui / tui-dev profile；endless-tui 已弃用）：
 *
 *   - insert:
 *       - id: dsh-rewind
 *         name: '/Users/vito/data/dev/dsh-plugins/plugins/rewind-dsh.ts'   # tui-dev
 *         # tui（稳定）：'/Users/vito/data/dev/dsh-plugins-stable/plugins/rewind-dsh.ts'
 *         inject: [agents, commands]
 */

import { randomUUID } from "node:crypto";
import { chmod, readFile, realpath, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import type { Context } from "@deepseek-ai/cordis";
import type { SessionSeq } from "@deepseek-ai/dsh-session";

export const name = "dsh-rewind";
export const inject = ["agents", "commands"];

// 无配置项：与 rename-session 等薄插件一致，不导出 Config（cordis 对缺省 Config 直接放行）。

/* ------------------------------------------------------------------ *
 * 类型（结构性子集，避免引入过多依赖类型）                              *
 * ------------------------------------------------------------------ */

interface SessionEvent {
  seq: number;
  type: string;
  data?: unknown;
}

interface SessionLike {
  id: string;
  /** rc.1 read interface: the `events` getter is gone; the log is read
   * through an immutable on-demand snapshot. */
  snapshotEvents(): readonly SessionEvent[];
}

interface AgentLike {
  id: string;
  session: SessionLike;
  status: string;
  meta?: { origin?: string };
}

interface AgentsService {
  roots(): AgentLike[];
  /** Live agent roster; prefer the non-subagent root here because relay
   *  (`attach-client`) adopts the current root agent, while roots()[0] can
   *  still point at the boot-time root before /resume switches sessions. */
  list?(): AgentLike[];
}

/** Subagents carry meta.origin === "subagent" (same rule attach-client uses). */
function isSubagent(agent: AgentLike): boolean {
  return agent.meta?.origin === "subagent";
}

/** The root agent the TUI is currently driving (live list wins over roots()). */
function liveRootAgent(agents: AgentsService): AgentLike | undefined {
  const live = agents.list?.().find((candidate) => !isSubagent(candidate));
  return live ?? agents.roots()[0];
}

interface CommandResult {
  kind: "success" | "error";
  text?: string;
}

interface CommandInvocation {
  rawInput: string;
}

interface CommandDefinition {
  name: string;
  description: string;
  input?: { hint?: string };
  recordInput?: boolean;
  handler(invocation: CommandInvocation): CommandResult | Promise<CommandResult>;
}

interface CommandsService {
  register(definition: CommandDefinition): () => void;
}

/** 从 ctx 运行时取服务（untyped get，rename-session 同款）。 */
function getService<T>(ctx: Context, key: string): T | undefined {
  return (ctx as unknown as { get(key: string): unknown }).get(key) as T | undefined;
}

/* ------------------------------------------------------------------ *
 * 纯函数：边界计算 / diff 反向 / 恢复计划（可单测，不依赖 ctx）         *
 * ------------------------------------------------------------------ */

/**
 * 复刻内置 rewindTo 的边界逻辑：从选中 seq 往前找 turn/start，
 * boundary = 该 turn/start 的 seq - 1（fork 落在所选 turn 之前）。
 * 若先遇到 turn/end（所选消息在两个 turn 之间），boundary = 所选 seq。
 * 返回 undefined 表示不可回退（所选是第一条消息 / 越界）。
 *
 * 返回值是强类型会话位置 `SessionSeq`（rc.1 fork 的 boundary 类型）：
 * 只有日志里真实存在的 seq 才能成为边界，避免把任意数字当位置传入。
 */
/** Locate an event by its seq — never by array position. Relay mirror
 *  sessions can carry a sparse window (events are appended as they arrive,
 *  seqs are global and contiguous on the worker, not necessarily at index 0). */
export function eventAtSeq(
  events: readonly SessionEvent[],
  seq: number,
): SessionEvent | undefined {
  return events.find((event) => event.seq === seq);
}

export function computeRewindBoundary(
  events: readonly SessionEvent[],
  pickedSeq: number,
): SessionSeq | undefined {
  if (!Number.isSafeInteger(pickedSeq) || pickedSeq < 0) return undefined;
  const pickedIndex = events.findIndex((event) => event.seq === pickedSeq);
  if (pickedIndex === -1) return undefined;
  let boundary = pickedSeq;
  for (let i = pickedIndex; i >= 0; i--) {
    const event = events[i];
    if (event === undefined) break;
    if (event.type === "turn/start") {
      boundary = event.seq - 1;
      break;
    }
    if (event.type === "turn/end") break;
  }
  return boundary >= 0 ? (boundary as SessionSeq) : undefined;
}

/** 一个 hunk（对应 dsh-tool-fs 的 FileDiff，tool/result.meta.diffs）。 */
export interface FileHunk {
  path: string;
  oldText: string | null;
  newText: string;
}

/** 恢复计划里一条针对某文件的反向操作。 */
export interface RestoreStep {
  /** 操作名（write/edit/str_replace），供诊断。 */
  op: string;
  /** 逆向替换：在文本中把 newText 换回 oldText。 */
  newText: string;
  oldText: string | null;
  /** 该文件在边界点应不存在（新建文件被撤销），最终应删除。 */
  deleteAfter?: boolean;
}

/**
 * 把 target 在 text 中找出来并唯一命中替换为 replacement。返回 null 表示：
 * 找不到 / 多处命中 / 其他失败（调用方据此放弃该文件，绝不写半截）。
 */
export function replaceOnce(
  text: string,
  target: string,
  replacement: string,
): string | null {
  // Empty target matches everywhere — the "unique occurrence" contract is
  // unsatisfiable, so refuse rather than corrupt the file.
  if (target === "") return null;
  let index = text.indexOf(target);
  if (index === -1) return null;
  const next = text.indexOf(target, index + target.length);
  if (next !== -1) return null; // 多处命中，歧义，放弃
  return text.slice(0, index) + replacement + text.slice(index + target.length);
}

/**
 * 对单个文件做「从新到旧」的反向应用。
 * @param current 文件当前内容（= 最后一次操作后的状态）
 * @param reverseSteps 该文件已按「从新到旧」排好的反向步骤
 * @returns 恢复后的内容；null = 任一步失败（放弃该文件）
 *          特殊值 "\u0000DELETE\u0000" = 边界点该文件不存在，应删除
 */
export function applyReverseSteps(
  current: string,
  reverseSteps: readonly RestoreStep[],
): string | null {
  let text = current;
  for (const step of reverseSteps) {
    if (step.deleteAfter === true) {
      // 反向到它被创建之前 → 应删除。只出现在序列最后（最早的操作）。
      text = "\u0000DELETE\u0000";
      continue;
    }
    if (step.oldText === null) {
      // 纯新增内容（dsh-tool-fs 的纯插入 / 覆写空文件产生 oldText:null）：
      // 反向就是删除 newText。replaceOnce 保证唯一命中，歧义/找不到即放弃。
      if (step.newText === "") return null;
      const removed = replaceOnce(text, step.newText, "");
      if (removed === null) return null;
      text = removed;
      continue;
    }
    const replaced = replaceOnce(text, step.newText, step.oldText);
    if (replaced === null) return null;
    text = replaced;
  }
  return text;
}

/** 解析工具调用参数 JSON，取 file_path / path。 */
export function filePathFromArgs(argsJson: string): string | undefined {
  try {
    const args = JSON.parse(argsJson) as Record<string, unknown>;
    if (typeof args.file_path === "string") return args.file_path;
    if (typeof args.path === "string") return args.path;
    return undefined;
  } catch {
    return undefined;
  }
}

/** 从 tool/result.message 的文本块里判断 write 是 Created 还是 Updated。
 * 真实事件里 message.content 是 `tool-result` 信封，正文在
 * `content[].content[].text`；同时兼容旧版平铺文本块。 */
function writeOperationFromMessage(content: unknown): "create" | "update" | undefined {
  const blocks: string[] = [];
  const collect = (c: unknown): void => {
    if (typeof c === "string") {
      blocks.push(c);
      return;
    }
    if (!Array.isArray(c)) return;
    for (const block of c) {
      if (block === null || typeof block !== "object") continue;
      const b = block as { type?: unknown; text?: unknown; content?: unknown };
      if (b.type === "tool-result") collect(b.content);
      else if (b.type === "text" && typeof b.text === "string") blocks.push(b.text);
    }
  };
  collect(content);
  const text = blocks.join("\n");
  if (/Created\s+file/.test(text)) return "create";
  if (/Updated\s+file/.test(text)) return "update";
  return undefined;
}

/** 真实 dsh tool/result 的 callId 形状：顶层 data.callId 只在旧/自定义事件里；
 * 现行事件是 data.message.source.callId 或 data.message.content[].toolCallId。 */
function toolResultCallId(data: Record<string, unknown>): string {
  const direct = data.callId;
  if (typeof direct === "string" && direct !== "") return direct;
  const message = data.message;
  if (typeof message !== "object" || message === null) return "";
  const m = message as { source?: { callId?: unknown }; content?: unknown };
  if (typeof m.source?.callId === "string" && m.source.callId !== "") return m.source.callId;
  if (Array.isArray(m.content)) {
    for (const block of m.content) {
      if (block !== null && typeof block === "object") {
        const id = (block as { toolCallId?: unknown }).toolCallId;
        if (typeof id === "string" && id !== "") return id;
      }
    }
  }
  return "";
}

/** 失败的 tool/result 不可作为逆向依据（工具本身没生效，回滚会误伤）。 */
function resultFailed(data: Record<string, unknown>): boolean {
  if (data.error !== undefined) return true;
  const message = data.message;
  if (typeof message !== "object" || message === null) return false;
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) return false;
  return content.some(
    (b) => b !== null && typeof b === "object" && (b as { isError?: unknown }).isError === true,
  );
}

/** str_replace_editor insert 的反向移除片段。insert_line:0 时反向要移除
 * `value\n`（insert 在行首插入 value 后还会补一个换行分隔符）；insert_line>0
 * 时反向要移除 `\nvalue`（value 前的分隔符）。value 自身首/尾带 \n 时同样
 * 成立——它与工具的 split("\n")/join("\n") 语义逐字节对齐。 */
function insertReverseFragment(args: Record<string, unknown>): string | undefined {
  const value = typeof args.new_str === "string" ? args.new_str : "";
  if (value === "") return undefined;
  if (args.insert_line === 0) return `${value}\n`;
  return `\n${value}`;
}

/** 从 tool/result.meta 提取 diffs（防御性窄化，malformed 返回 undefined）。 */
export function diffsFromMeta(meta: unknown): FileHunk[] | undefined {
  if (typeof meta !== "object" || meta === null || Array.isArray(meta)) return undefined;
  const diffs = (meta as { diffs?: unknown }).diffs;
  if (!Array.isArray(diffs) || diffs.length === 0) return undefined;
  const out: FileHunk[] = [];
  for (const raw of diffs) {
    if (raw === null || typeof raw !== "object") return undefined;
    const { path, oldText, newText } = raw as {
      path?: unknown;
      oldText?: unknown;
      newText?: unknown;
    };
    if (typeof path !== "string") return undefined;
    if (oldText !== null && typeof oldText !== "string") return undefined;
    if (typeof newText !== "string") return undefined;
    out.push({ path, oldText: oldText as string | null, newText });
  }
  return out.length > 0 ? out : undefined;
}

/**
 * 核心：从源会话日志里构建「边界点之后全部文件改动」的恢复计划。
 *
 * 扫描 seq > boundary 的 tool/call + tool/result 配对，按文件分组、
 * 时间序排列；返回 map<path, chronoSteps>（从旧到新），调用方逆序应用
 * 即可还原到边界点。
 *
 * 可恢复性：
 *  - write/edit：tool/result.meta.diffs（真实 before/after 上下文 hunks）→ 精确
 *  - write 新建（diffs=[] 且 result 说 Created）→ deleteAfter
 *  - write 覆盖但无 before（diffs=[] 且 Updated）→ 跳过并记 warning
 *  - str_replace_editor：从 call 参数反向（str_replace/insert/create）
 *  - bash 等无 meta → 跳过并记 warning
 */
export function buildRestorePlan(
  events: readonly SessionEvent[],
  boundary: number,
): { steps: Map<string, RestoreStep[]>; skipped: string[] } {
  const byCall = new Map<string, { name: string; arguments: string; seq: number }>();
  const steps = new Map<string, RestoreStep[]>();
  const skipped: string[] = [];

  const record = (path: string, step: RestoreStep) => {
    const list = steps.get(path) ?? [];
    list.push(step);
    steps.set(path, list);
  };

  for (const event of events) {
    if (event.seq <= boundary) continue;
    const data = (event.data ?? {}) as Record<string, unknown>;
    if (event.type === "tool/call") {
      const callName = typeof data.name === "string" ? data.name : "";
      const argumentsJson = typeof data.arguments === "string" ? data.arguments : "";
      const callId = typeof data.callId === "string" ? data.callId : "";
      if (callId === "") continue;
      byCall.set(callId, { name: callName, arguments: argumentsJson, seq: event.seq });
      continue;
    }
    if (event.type !== "tool/result") continue;
    const callId = toolResultCallId(data);
    const call = byCall.get(callId);
    if (call === undefined) continue;
    if (resultFailed(data)) {
      skipped.push(`#${call.seq} ${call.name}: failed result — skipped`);
      continue;
    }

    const toolName = call.name;
    const meta = diffsFromMeta(data.meta);
    const message = (data.message as { content?: unknown } | undefined)?.content;

    if (toolName === "write" || toolName === "edit") {
      const path = filePathFromArgs(call.arguments);
      if (path === undefined) {
        skipped.push(`#${call.seq} ${toolName}: no file_path in args`);
        continue;
      }
      if (meta !== undefined) {
        for (const hunk of meta) {
          record(path, {
            op: toolName,
            newText: hunk.newText,
            oldText: hunk.oldText,
          });
        }
      } else if (toolName === "write") {
        const op = writeOperationFromMessage(message);
        if (op === "create") {
          record(path, { op: toolName, newText: "", oldText: null, deleteAfter: true });
        } else {
          skipped.push(`#${call.seq} write ${path}: no before-content available (binary/exclusive?) — cannot restore`);
        }
      } else {
        skipped.push(`#${call.seq} edit ${path}: no diffs meta — cannot restore`);
      }
      continue;
    }

    if (toolName === "str_replace_editor") {
      const path = filePathFromArgs(call.arguments);
      if (path === undefined) {
        skipped.push(`#${call.seq} str_replace_editor: no path in args`);
        continue;
      }
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.arguments) as Record<string, unknown>;
      } catch {
        skipped.push(`#${call.seq} str_replace_editor: unparsable args`);
        continue;
      }
      const command = typeof args.command === "string" ? args.command : "";
      if (command === "create") {
        record(path, { op: "str_replace_editor", newText: "", oldText: null, deleteAfter: true });
      } else if (command === "str_replace") {
        if (typeof args.old_str === "string" && typeof args.new_str === "string") {
          record(path, { op: "str_replace_editor", newText: args.new_str, oldText: args.old_str });
        } else {
          skipped.push(`#${call.seq} str_replace_editor: missing old_str/new_str`);
        }
      } else if (command === "insert") {
        const inserted = insertReverseFragment(args);
        if (inserted !== undefined) {
          record(path, { op: "str_replace_editor", newText: inserted, oldText: "" });
        } else {
          skipped.push(`#${call.seq} str_replace_editor insert: missing new_str`);
        }
      } else {
        skipped.push(`#${call.seq} str_replace_editor ${command}: not restorable`);
      }
      continue;
    }

    // bash 及其他工具：无法从日志还原。
    skipped.push(`#${call.seq} ${toolName}: not restorable (no before-state in log)`);
  }

  return { steps, skipped };
}

/**
 * 把一个文件的「从旧到新」步骤列表转成「从新到旧」的反向应用序列。
 *
 * deleteAfter（文件在边界点不存在，之后才被创建）在 chrono 里必然是
 * **最旧**的一步（index 0：先 create 后 edit，或唯一一步）。反转后它落到
 * 序列最后，applyReverseSteps 在末尾触发删除语义（先回退所有编辑，再删文件）。
 *
 * 返回 null 表示计划不合法：deleteAfter 出现在 index 0 之外，意味着「先有
 * 编辑、后有新建」的悖论（同一路径不可能先改后建）。
 */
export function buildReverseSteps(chronoSteps: readonly RestoreStep[]): RestoreStep[] | null {
  if (chronoSteps.length === 0) return null;
  const deleteIdx = chronoSteps.findIndex((s) => s.deleteAfter === true);
  if (deleteIdx !== -1 && deleteIdx !== 0) {
    return null;
  }
  return [...chronoSteps].reverse();
}

/* ------------------------------------------------------------------ *
 * 插件主体                                                             *
 * ------------------------------------------------------------------ */

function apply(ctx: Context): void {
  const agents = getService<AgentsService>(ctx, "agents");
  const commands = getService<CommandsService>(ctx, "commands");

  if (agents === undefined || commands === undefined) {
    ctx.logger?.warn("dsh-rewind: missing agents/commands — /rewind not registered");
    return;
  }

  commands.register({
    name: "rewind",
    description: "Rewind the conversation (and restore files) to a past message — overrides the built-in rewind",
    input: { hint: "<seq>" },
    recordInput: true,
    handler: async (invocation: CommandInvocation): Promise<CommandResult> => {
      const arg = invocation.rawInput.trim();
      // 自研 TUI 暴露当前 agent 的会话源（与双击 Esc picker 同一份 events）。
      // relay /resume 后 agents.roots()[0] 可能仍是启动时旧 root，会漏掉
      // 回放出来的 seq；rewindSource 优先，缺省再退回 liveRootAgent。
      // rc.1：来源以 snapshotEvents() 暴露（无 `events` 数组 getter）。
      const source = getService<{ id: string; snapshotEvents(): readonly SessionEvent[] }>(ctx, "rewindSource");
      let root: AgentLike | undefined;
      let events: SessionEvent[];
      if (source !== undefined) {
        events = [...source.snapshotEvents()];
        const live = agents.list?.().find((a) => a.id === source.id);
        root = live ?? {
          id: source.id,
          session: { id: source.id, snapshotEvents: () => events },
          status: "idle",
        };
      } else {
        root = liveRootAgent(agents);
        events = root === undefined ? [] : [...root.session.snapshotEvents()];
      }
      if (root === undefined) {
        return { kind: "error", text: "no live root session" };
      }
      // 快照：fork/恢复期间日志继续增长也不能影响计划。

      // 无参数：列出历史 user 消息。
      if (arg === "") {
        const lines: string[] = [];
        for (const event of events) {
          if (event.type !== "user/message") continue;
          const data = (event.data ?? {}) as { content?: unknown; source?: { kind?: string } };
          if (data.source?.kind !== undefined && data.source.kind !== "user") continue;
          const text = textBlocks(data.content).replace(/\s+/g, " ").trim();
          lines.push(`[${event.seq}] ${truncate(text, 60) || "(empty)"}`);
        }
        if (lines.length === 0) {
          return { kind: "error", text: "no past user messages to rewind to" };
        }
        return {
          kind: "success",
          text: `Past messages (pick a user message's seq):\n${lines.join("\n")}\n\nRun /rewind <seq> to rewind (and restore files) to that point.`,
        };
      }

      // 有参数：解析 seq。
      const seq = Number(arg);
      if (!Number.isInteger(seq) || seq < 0) {
        return { kind: "error", text: "usage: /rewind <seq>" };
      }
      // Relay worker 会话：rewind 在 worker 端执行（fork + 本地文件恢复），
      // 成功后前端 detach 旧流并 resume worker 返回的 child session。
      const relayClient = getService<{
        currentDevice(): string;
        rewind(messageId: string): Promise<{ ok: boolean; childSessionId?: string; summary?: string; error?: string }>;
      }>(ctx, "relayClient");
      if (relayClient !== undefined && relayClient.currentDevice() !== "") {
        // 前端 mirror 的 seq 与 worker 原始 seq 不对齐（mirror 跳过
        // agent/inbox/spliced 且本地重编号），wire 用稳定的 user/message id。
        const target = events.find((e) => e.seq === seq && e.type === "user/message");
        const messageId = (target?.data as { id?: unknown } | undefined)?.id;
        if (typeof messageId !== "string" || messageId === "") {
          return { kind: "error", text: `rewind failed: no message id for seq ${seq}` };
        }
        const result = await relayClient.rewind(messageId);
        if (!result.ok) {
          return { kind: "error", text: `rewind failed: ${result.error ?? "unknown error"}` };
        }
        const childId = result.childSessionId;
        if (childId === undefined) {
          return { kind: "error", text: "rewind succeeded but worker returned no child session" };
        }
        const handoff = getService<{
          resumeRemoteChild(deviceId: string, childId: string): Promise<void>;
        }>(ctx, "tuiHandoff");
        if (handoff === undefined) {
          return {
            kind: "success",
            text: `rewind prepared (${result.summary ?? "no file changes"}) — resume manually with /resume ${childId}`,
          };
        }
        await handoff.resumeRemoteChild(relayClient.currentDevice(), childId);
        return {
          kind: "success",
          text: `rewind prepared (${result.summary ?? "no file changes"}) — switched to ${childId}`,
        };
      }
      // Relay sessions can have sparse seq (local mirror only carries the
      // remote window), so index by seq — never by array position.
      const picked = eventAtSeq(events, seq);
      if (picked === undefined) {
        return { kind: "error", text: `no event at seq ${seq}` };
      }
      if (picked.type !== "user/message") {
        return {
          kind: "error",
          text: `seq ${seq} is not a user message (it's ${picked.type}); pick a user message seq from /rewind`,
        };
      }
      // Relay mirrors can have sparse seqs (local window only), so "current"
      // must mean the largest seq present — never the array length.
      const lastSeq = events.reduce(
        (max, e) => (typeof e.seq === "number" && e.seq > max ? e.seq : max),
        -1,
      );
      if (seq >= lastSeq) {
        return { kind: "error", text: "cannot rewind to the current message" };
      }

      // 忙碌时拒绝（与内置 rewindTo 一致：不打断运行中的 turn）。
      if (root.status === "running") {
        return { kind: "error", text: "the agent is still running — wait for it to settle, then rewind" };
      }

      const boundary = computeRewindBoundary(events, seq);
      if (boundary === undefined) {
        return { kind: "error", text: "cannot rewind to this point (first message or bad boundary)" };
      }

      // 1) 让 TUI 经宿主 agent 生命周期创建**可持久化**的 fork 子会话。
      //    finding 06-1：rc.1 的裸 sessions.fork() 子会话只在内存里
      //    （持久化写句柄由 agent 生命周期持有），execve 后新进程 resume 不到；
      //    且旧 flush 守卫在 rc.1 是假阴性（有监听者、无 writer 也返回 true）。
      //    子会话真正落盘（可读复核通过）之前，不改任何文件。
      const handoff = getService<{
        forkPersistedChild?(seed: readonly SessionEvent[]): Promise<{
          ok: boolean;
          childId?: string;
          cwd?: string;
          error?: string;
        }>;
        relaunchToResume?(id: string, note?: string): Promise<void>;
      }>(ctx, "tuiHandoff");
      if (handoff === undefined || typeof handoff.forkPersistedChild !== "function") {
        return {
          kind: "error",
          text: "rewind unavailable: this TUI build lacks tuiHandoff.forkPersistedChild (finding 06-1 fix)",
        };
      }
      const forked = await handoff.forkPersistedChild(
        events.filter((event) => event.seq <= boundary),
      );
      if (forked.ok !== true || typeof forked.childId !== "string" || typeof forked.cwd !== "string") {
        return {
          kind: "error",
          text: `rewind aborted before file changes — ${forked.error ?? "fork failed"}`,
        };
      }
      const childId = forked.childId;
      const cwd = forked.cwd;

      // 2) 文件恢复（方案 2）：先全量 dry-run，全部可逆才写盘——
      //    任一文件失败就整体放弃，避免 A 成功、B 失败的部分回滚。
      const { steps, skipped } = buildRestorePlan(events, boundary);
      const plan: Array<{
        path: string;
        abs: string;
        current: string;
        next: string;
        delete: boolean;
      }> = [];
      const restored: string[] = [];
      const failed: string[] = [];
      for (const [path, chronoSteps] of steps) {
        const reverse = buildReverseSteps(chronoSteps);
        if (reverse === null) {
          failed.push(path);
          continue;
        }
        const resolved = await resolveUnderReal(cwd, path);
        if (resolved === undefined) {
          failed.push(`${path} (outside workspace)`);
          continue;
        }
        const abs = resolved.abs;
        try {
          const current = await readTextSafe(abs);
          if (current === null) {
            // 文件当前不存在：若计划全是删除（边界点也不存在）→ 无需处理。
            if (reverse.every((s) => s.deleteAfter)) continue;
            failed.push(`${path} (file missing on disk)`);
            continue;
          }
          const result = applyReverseSteps(current, reverse);
          if (result === null) {
            failed.push(path);
            continue;
          }
          plan.push({
            path,
            abs,
            current,
            next: result,
            delete: result === "\u0000DELETE\u0000",
          });
        } catch (error) {
          failed.push(`${path} (${error instanceof Error ? error.message : String(error)})`);
        }
      }
      if (failed.length > 0) {
        return {
          kind: "error",
          text: `rewind aborted before file changes — cannot restore: ${failed.join(", ")}`,
        };
      }
      for (const item of plan) {
        try {
          if (item.delete) await deleteFileSafe(item.abs);
          else if (item.next !== item.current) await writeTextSafe(item.abs, item.next);
          restored.push(item.path);
        } catch (error) {
          failed.push(`${item.path} (${error instanceof Error ? error.message : String(error)})`);
          break;
        }
      }
      if (failed.length > 0) {
        return {
          kind: "error",
          text: `rewind aborted after partial file changes: ${failed.join(", ")} — resume manually with /resume ${childId}`,
        };
      }

      // 3) 汇总恢复结果。
      const lines: string[] = [];
      if (restored.length > 0) lines.push(`restored files: ${restored.join(", ")}`);
      if (failed.length > 0) lines.push(`failed to restore: ${failed.join(", ")}`);
      if (skipped.length > 0) {
        lines.push(`not restorable from log: ${skipped.slice(0, 5).join("; ")}${skipped.length > 5 ? `; …(+${skipped.length - 5})` : ""}`);
      }
      const summary = lines.length === 0 ? "no file changes to restore" : lines.join(" | ");

      // 4) execve 重启（进程在此被替换；后续不会真正 resolve）。
      // 优先委托 tui-runner 发布的 tuiHandoff 服务：它先恢复终端（stopTerminal：
      // pop kitty 协议、退 raw mode、关 bracketed paste）再 execve，并把摘要
      // 写到 stderr（finding 06-2：执行细节在 execve 前可见，留在 shell 回滚区）。
      // 直接替换进程会把本 TUI 推入的 kitty flags=7 留在终端协议栈上，之后每次
      // 重启再叠一层，退出只 pop 一层——shell 从此收到 CSI-u 按键编码
      // （2026-08-26 退出泄漏报告：↑键出现 ":3A" 尾巴）。
      if (handoff !== undefined && typeof handoff.relaunchToResume === "function") {
        await handoff.relaunchToResume(childId, `dsh-rewind: ${summary}`);
        // 服务版成功时进程已被替换、不会走到这里；返回即视为启动失败。
        return {
          kind: "error",
          text: `rewind prepared (${summary}) but relaunch failed — resume manually with /resume ${childId}`,
        };
      }
      // 兜底：旧 runner 未发布服务时自行 execve，先做最小终端恢复。
      relaunchToResume(childId, cwd);
      // 兜底：execve 不可用/失败时，留在当前进程并提示。
      return {
        kind: "error",
        text: `rewind prepared (${summary}) but relaunch failed — resume manually with /resume ${childId}`,
      };
    },
  });
}

/** 摘要与路径工具。 */
function textBlocks(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (b): b is { type: string; text?: unknown } =>
        typeof b === "object" && b !== null && (b as { type?: string }).type === "text",
    )
    .map((b) => String(b.text ?? ""))
    .join("");
}

function truncate(text: string, n: number): string {
  return text.length > n ? `${text.slice(0, n)}…` : text;
}

/** diff 里的 path 是模型侧相对路径，相对 cwd 解析；解析结果必须落在
 * 会话工作区内（拒绝绝对路径逃逸和 `..` 越界）。 */
function resolveUnder(cwd: string, path: string): { abs: string } | undefined {
  if (path === "") return undefined;
  const base = resolve(cwd);
  const abs = path.startsWith("/") ? resolve(path) : resolve(cwd, path);
  const prefix = base.endsWith(sep) ? base : `${base}${sep}`;
  return abs === base || abs.startsWith(prefix) ? { abs } : undefined;
}

/** resolveUnder 的词法检查之外，再按 realpath 校验：workspace 内指向外部的
 * symlink（文件或目录）会被词法检查放过，rewind 不能跟着它读写/删除 workspace
 * 之外的文件。取目标最近存在的祖先做 realpath，落在 base 真实路径内才放行。 */
export async function resolveUnderReal(
  cwd: string,
  path: string,
): Promise<{ abs: string } | undefined> {
  const lex = resolveUnder(cwd, path);
  if (lex === undefined) return undefined;
  const baseReal = await realpath(cwd).catch(() => resolve(cwd));
  const prefix = baseReal.endsWith(sep) ? baseReal : `${baseReal}${sep}`;
  let candidate = lex.abs;
  let real: string | undefined;
  for (;;) {
    real = await realpath(candidate).catch(() => undefined);
    if (real !== undefined) break;
    const parent = dirname(candidate);
    if (parent === candidate) break;
    candidate = parent;
  }
  if (real === undefined) return undefined;
  return real === baseReal || real.startsWith(prefix) ? lex : undefined;
}

async function readTextSafe(abs: string): Promise<string | null> {
  try {
    return await readFile(abs, "utf8");
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

/** Atomic restore write: temp file in the target directory, then rename.
 * A crash mid-write leaves the original intact instead of a truncated file. */
async function writeTextSafe(abs: string, content: string): Promise<void> {
  const tmp = `${abs}.rewind-${randomUUID().slice(0, 8)}.tmp`;
  try {
    await writeFile(tmp, content, "utf8");
    // Preserve the original file's permission bits through the atomic rename
    // (a naive temp write would reset a mode-600 file to the umask default).
    const st = await stat(abs).catch(() => undefined);
    if (st !== undefined) await chmod(tmp, st.mode);
    await rename(tmp, abs);
  } catch (error) {
    await unlink(tmp).catch(() => {});
    throw error;
  }
}

async function deleteFileSafe(abs: string): Promise<void> {
  try {
    await unlink(abs);
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
}

function isNotFound(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    (error as { code?: string }).code === "ENOENT"
  );
}

/** 兜底路径的最小终端恢复：tuiHandoff 服务不可用（旧 runner 共存）时，
 * 本插件自己 execve 前至少要退 raw mode、pop kitty 协议栈并关掉
 * bracketed paste——否则这些模式会越过 execve 留在终端上。三条序列对
 * 未启用的模式均为 no-op；pop-on-empty 按 spec 也是 no-op，不会误伤外层。 */
function restoreTerminalForHandoff(): void {
  if (!process.stdout.isTTY) return;
  try {
    process.stdin.setRawMode?.(false);
  } catch {
    /* stdin 非 TTY 时忽略 */
  }
  process.stdout.write("\x1b[<u\x1b[>4;0m\x1b[?2004l");
}

/** execve 重启到子会话（发布版 resumeCommand 的等价实现）。 */
function relaunchToResume(sessionId: string, cwd: string): void {
  try {
    process.chdir(cwd);
  } catch {
    /* 忽略：chdir 失败也继续重启 */
  }
  restoreTerminalForHandoff();
  process.env.DSH_TUI_RESUME_SESSION = sessionId;
  process.env.DSH_CC_RESUME_SESSION = sessionId;
  // 剥掉本次启动自带的 --resume 再显式追加新目标：startup 层解析为
  // `opts.resume ?? DSH_CC_RESUME_SESSION`，argv 里残留的源会话 id 会压过
  // 刚放进 env 的 childId（2026-08-26 活体复现：回退后 resume 回源会话）。
  const args = process.argv.slice(1);
  const kept: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] ?? "";
    if (arg === "--resume") {
      i += 1; // 连值一起跳过
      continue;
    }
    if (arg.startsWith("--resume=")) continue;
    kept.push(arg);
  }
  const relaunch = [process.execPath, ...(process.execArgv ?? []), ...kept, "--resume", sessionId];
  if (process.execve === undefined) {
    console.error("[dsh-rewind] process.execve unavailable — resume manually with:");
    console.error(`  /resume ${sessionId}`);
    return;
  }
  try {
    process.execve(process.execPath, relaunch, process.env);
  } catch (error) {
    console.error(`[dsh-rewind] relaunch failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export default { name, apply, inject };
