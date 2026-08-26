/**
 * dsh-rewind — 独立 /rewind 命令插件（方案 2：工具日志逆向文件恢复）。
 *
 * 设计目标（详见 docs/rewind-file-restore-plugin.md）：
 *
 * 1. **不依赖 @deepseek-harness-tui/dsh-tui 的 tui/rewind-prompt 决策事件**——
 *    那条缝走 host 中介的 DecisionEvents registry + Component 准入 + grant，
 *    对本地 patch-insert 的薄插件不可用（会被 internal/listener 守卫拒绝）。
 * 2. 本插件只消费 dsh 的**标准进程内服务**（agents / sessions /
 *    commands），与 approval-tui、rename-session 同级，
 *    可直接 patch-insert。
 * 3. `/rewind` 在命令注册表中注册，**覆盖**内置 rewind（注册表 handler 优先于
 *    TUI 本地命令名），从而把「回退对话 + 回滚文件」合二为一，且不碰 TUI 本体。
 *
 * 工作流（与内置 rewindTo 同构，但走跨进程 handoff）：
 *
 *   /rewind            → 列出历史 user 消息（seq + 摘要），提示 /rewind <seq>
 *   /rewind <seq>      → 1) 计算 boundary（回退到该消息所在 turn 之前）
 *                        2) sessions.fork(source, boundary, childId) 生成子会话
 *                           （现行语义：store.create 即时注册并经持久层写路径
 *                           落盘，无需也不允许再手动 create+append——2026-08-26）
 *                        3) 逆向恢复文件：源日志里 seq>boundary 的 write/edit
 *                           反向应用回滚到边界点（方案 2 核心，纯函数可单测）
 *                        4) 设置 DSH_TUI_RESUME_SESSION / DSH_CC_RESUME_SESSION
 *                           并 execve 重启同一 dsh（boot 时 TUI 读到 sessionId 自动 resume）
 *
 * 挂载（endless-tui profile，~/.dsh/profiles/endless-tui/cordis.patch.yml）：
 *
 *   - insert:
 *       - id: dsh-rewind
 *         name: '/Users/vito/data/dev/dsh-plugins/plugins/rewind-dsh.ts'
 *         inject: [agents, sessions, commands]
 */

import { randomUUID } from "node:crypto";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Context } from "@deepseek-ai/cordis";

export const name = "dsh-rewind";
export const inject = ["agents", "sessions", "commands"];

// 无配置项：与 approval-tui.ts 一致，不导出 Config（cordis 对缺省 Config 直接放行）。

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
  header?: { cwd?: string };
  events: readonly SessionEvent[];
}

interface AgentLike {
  id: string;
  session: SessionLike;
  status: string;
}

interface AgentsService {
  roots(): AgentLike[];
}

interface SessionsService {
  fork(
    source: SessionLike,
    boundary?: number,
    childSessionId?: string,
  ): SessionLike;
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
 */
export function computeRewindBoundary(
  events: readonly SessionEvent[],
  pickedSeq: number,
): number | undefined {
  if (!Number.isSafeInteger(pickedSeq) || pickedSeq < 0 || pickedSeq >= events.length) {
    return undefined;
  }
  const picked = events[pickedSeq];
  if (picked === undefined || picked.seq !== pickedSeq) return undefined;
  let boundary = pickedSeq;
  for (let i = pickedSeq; i >= 0; i--) {
    const event = events[i];
    if (event === undefined) break;
    if (event.type === "turn/start") {
      boundary = event.seq - 1;
      break;
    }
    if (event.type === "turn/end") break;
  }
  return boundary >= 0 ? boundary : undefined;
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
      // 纯新增内容（无改动前文本）：无法逆向，放弃。
      return null;
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

/** 从 tool/result.message 的文本块里判断 write 是 Created 还是 Updated。 */
function writeOperationFromMessage(content: unknown): "create" | "update" | undefined {
  const blocks: string[] = [];
  if (typeof content === "string") {
    blocks.push(content);
  } else if (Array.isArray(content)) {
    for (const block of content) {
      if (
        block !== null &&
        typeof block === "object" &&
        (block as { type?: string }).type === "text" &&
        typeof (block as { text?: unknown }).text === "string"
      ) {
        blocks.push((block as { text: string }).text);
      }
    }
  }
  const text = blocks.join("\n");
  if (text.includes("Created")) return "create";
  if (text.includes("Updated")) return "update";
  return undefined;
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
    const callId = typeof data.callId === "string" ? data.callId : "";
    const call = byCall.get(callId);
    if (call === undefined) continue;

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
        // str_replace_editor 在 insert_line 之后插入 "\n"+new_str（见其实现），反向移除该片段。
        if (typeof args.new_str === "string") {
          const inserted = args.new_str.startsWith("\n") ? args.new_str : `\n${args.new_str}`;
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
  const sessions = getService<SessionsService>(ctx, "sessions");
  const commands = getService<CommandsService>(ctx, "commands");

  if (agents === undefined || sessions === undefined || commands === undefined) {
    ctx.logger?.warn("dsh-rewind: missing agents/sessions/commands — /rewind not registered");
    return;
  }

  commands.register({
    name: "rewind",
    description: "Rewind the conversation (and restore files) to a past message — overrides the built-in rewind",
    input: { hint: "<seq>" },
    recordInput: true,
    handler: async (invocation: CommandInvocation): Promise<CommandResult> => {
      const arg = invocation.rawInput.trim();
      const root = agents.roots()[0];
      if (root === undefined) {
        return { kind: "error", text: "no live root session" };
      }
      // 快照：fork/恢复期间日志继续增长也不能影响计划。
      const events = [...root.session.events];

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
      const picked = events[seq];
      if (picked === undefined || picked.seq !== seq) {
        return { kind: "error", text: `no event at seq ${seq}` };
      }
      if (picked.type !== "user/message") {
        return {
          kind: "error",
          text: `seq ${seq} is not a user message (it's ${picked.type}); pick a user message seq from /rewind`,
        };
      }
      if (seq >= events.length - 1) {
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

      // 1) fork 子会话（不 live，仅生成 seed + header，用于持久化）。
      const childId = `session-${randomUUID()}`;
      let child: SessionLike;
      try {
        child = sessions.fork(root.session, boundary, childId);
      } catch (error) {
        return {
          kind: "error",
          text: `fork failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }

      const cwd = child.header?.cwd ?? process.cwd();

      // 2) 文件恢复（方案 2）：把 seq>boundary 的写操作反向回滚到边界点。
      const { steps, skipped } = buildRestorePlan(events, boundary);
      const restored: string[] = [];
      const failed: string[] = [];
      for (const [path, chronoSteps] of steps) {
        const reverse = buildReverseSteps(chronoSteps);
        if (reverse === null) {
          failed.push(path);
          continue;
        }
        const abs = resolveUnder(cwd, path);
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
          if (result === "\u0000DELETE\u0000") {
            await deleteFileSafe(abs);
            restored.push(path);
          } else if (result !== current) {
            await writeTextSafe(abs, result);
            restored.push(path);
          }
        } catch (error) {
          failed.push(`${path} (${error instanceof Error ? error.message : String(error)})`);
        }
      }

      // 3) fork 已通过 store 写路径落盘（见头部注释 2），直接汇报并重启。
      const lines: string[] = [];
      if (restored.length > 0) lines.push(`restored files: ${restored.join(", ")}`);
      if (failed.length > 0) lines.push(`failed to restore: ${failed.join(", ")}`);
      if (skipped.length > 0) {
        lines.push(`not restorable from log: ${skipped.slice(0, 5).join("; ")}${skipped.length > 5 ? `; …(+${skipped.length - 5})` : ""}`);
      }
      const summary = lines.length === 0 ? "no file changes to restore" : lines.join(" | ");

      // 4) execve 重启（进程在此被替换；后续不会真正 resolve）。
      relaunchToResume(child.id, cwd);
      // 兜底：execve 不可用/失败时，留在当前进程并提示。
      return {
        kind: "error",
        text: `rewind prepared (${summary}) but relaunch failed — resume manually with /resume ${child.id}`,
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

/** diff 里的 path 是模型侧相对路径，相对 cwd 解析。 */
function resolveUnder(cwd: string, path: string): string {
  return path.startsWith("/") ? path : join(cwd, path);
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

/** execve 重启到子会话（发布版 resumeCommand 的等价实现）。 */
function relaunchToResume(sessionId: string, cwd: string): void {
  try {
    process.chdir(cwd);
  } catch {
    /* 忽略：chdir 失败也继续重启 */
  }
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
  const relaunch = [process.execPath, ...kept, "--resume", sessionId];
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
