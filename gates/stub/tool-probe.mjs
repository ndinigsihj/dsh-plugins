/**
 * T4b 工具面探针（票据 08）：在真实 PTY 组合里记录每个 Agent 的实际注册工具面。
 *
 * 由 `gates/stub/tool-probe.patch.yml` 插入，只在 `scripts/tui-pty-smoke.mjs
 * --probe-tools` 时加载；输出路径由 `PTY_SMOKE_PROBE_OUT` 给出（缺省则整体不动作）。
 *
 * 测量纪律（与 `gates/stub/scenarios/team-preset-overlay.mjs` 同源）：
 *   - 工具面在 `agent/created` 监听里同步抓取：Team 工具注册在确切 Agent 作用域，
 *     Agent 一被处置（teammate 回合结束后）就会注销，异步/延迟读取会偶发测到
 *     「只有 preset、没有 Team 工具」的残缺面；
 *   - 先写临时文件再 rename，读者不会读到半截 JSON；
 *   - 探针任何失败都不得影响被测组合（吞异常，仅放弃写盘）。
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const name = "gate-stub-tool-probe";
export const inject = ["tools"];

/** 输出路径在插件加载时固定（子进程环境不变化）。 */
const OUT = process.env.PTY_SMOKE_PROBE_OUT;

function snapshot(ctx, agent, label) {
  const tools = (ctx.tools.schemas(agent) ?? []).map((tool) => tool.name).sort();
  const header = agent.session.header;
  // Team 服务可能不存在（非 Team 组合）；tryMembership 自身对陈旧 Agent 不抛错。
  let role;
  try {
    role = ctx.get("agentTeams")?.tryMembership?.(agent)?.role;
  } catch {
    role = undefined;
  }
  return {
    sessionId: String(agent.session.id),
    label,
    at: Date.now(),
    origin: header.origin ?? "root",
    delegationDepth: header.delegationDepth ?? 0,
    parentSession: header.parentSession === undefined ? null : String(header.parentSession),
    agentPreset: header.agentPreset ?? null,
    role: role ?? null,
    toolCount: tools.length,
    tools,
  };
}

export function apply(ctx) {
  if (OUT === undefined || OUT === "") return;
  const snapshots = new Map();
  // T4b 的 boot2 会 execve 重启（/rewind），新进程从既存文件续读，重启不丢前一段证据。
  try {
    const previous = JSON.parse(readFileSync(OUT, "utf8"));
    for (const entry of previous.snapshots ?? []) snapshots.set(`${entry.sessionId}:${entry.label}`, entry);
  } catch {
    /* 首次启动或半截文件：从空快照开始 */
  }
  const flush = () => {
    try {
      mkdirSync(dirname(OUT), { recursive: true });
      const temp = `${OUT}.tmp`;
      writeFileSync(temp, `${JSON.stringify({ capturedAt: new Date().toISOString(), snapshots: [...snapshots.values()] }, null, 2)}\n`);
      renameSync(temp, OUT);
    } catch {
      /* 探针写盘失败不得影响被测组合 */
    }
  };
  const capture = (agent, label) => {
    try {
      snapshots.set(`${String(agent.session.id)}:${label}`, snapshot(ctx, agent, label));
      flush();
    } catch {
      /* 同上：静默放弃这一次采样 */
    }
  };
  ctx.on("agent/created", ({ agent }) => {
    capture(agent, "created");
    setImmediate(() => capture(agent, "created+immediate"));
    setTimeout(() => capture(agent, "created+1000"), 1000);
  });
  ctx.on("agent/status", ({ agent }) => capture(agent, "status"));
}
