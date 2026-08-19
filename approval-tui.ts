/**
 * approval-tui — dsh-tui 的权限审批 answerer 插件。
 *
 * dsh 的权限审批（dsh-user-approval, policy: ask）通过 waterfall 事件
 * `approval/request` 询问 "answerer"；没有任何监听者时 fail closed
 * （outcome = 'unavailable'，操作直接拒绝，日志报 "no approval channel
 * is available"）。官方 answerer 只存在于 dsh-host-apiproxy（web 部署
 * 层，弹浏览器确认框）；TUI 部署没有它，所以需要审批的操作全部失败。
 *
 * 本插件把审批请求转成 dsh-tui 已有的用户问答面板
 * （AskUserQuestionPanel — 即 ask_user_question 工具的 UI 通道，由
 * dsh-tui 的 plugin.js 注册为 ctx.userQuestions 的 provider）：
 *
 *   ↑/↓ 选择   Enter 确认   Esc 取消
 *
 * 加入 endless-tui profile（~/.dsh/profiles/endless-tui/cordis.patch.yml）：
 *
 *   - insert:
 *       - id: approval-tui
 *         name: '/Users/vito/data/dev/dsh-tui/approval-tui.ts'
 *
 * 依赖：运行时只需 dsh-tui 已加载的 @deepseek-ai/dsh-user-questions
 * （dsh-tui bundle 自带）；无其他副作用。
 */

import type { Context } from "@deepseek-ai/cordis";
import { UserQuestionError } from "@deepseek-ai/dsh-user-questions";

declare module "@deepseek-ai/cordis" {
  interface Events {
    /** dsh-user-approval 的审批 waterfall：监听者返回审批结果，或调 next() 放行。 */
    "approval/request"(req: ApprovalRequest, next: () => Promise<ApprovalOutcome>): Promise<ApprovalOutcome>;
  }
}

export const name = "approval-tui";

/** dsh-user-approval 的审批结果词汇（decide 的合法返回值）。 */
type ApprovalOutcome = "allowed-once" | "rejected" | "cancelled" | "unavailable";

/** approval/request waterfall 事件的请求载荷（ApprovalRequest 的简化形状）。 */
interface ApprovalRequest {
  /** 发起审批的 live agent。 */
  agent: { id: string };
  /** 请求授权的工具名。 */
  toolName: string;
  /** 工具调用 id（同一工具并发多次时区分）。 */
  callId?: string;
  /** 审批原因（沙箱/权限描述）。 */
  reason?: string;
  /** 工具调用中止信号：中止时审批应返回 cancelled。 */
  signal?: AbortSignal;
}

/** ctx.userQuestions.ask 的最小请求形状（只用得到的面板字段）。 */
interface UserQuestionRequest {
  questions: Array<{
    id: string;
    question: string;
    options?: Array<{ label: string; value?: string; description?: string }>;
  }>;
  agent?: unknown;
  signal?: AbortSignal;
}

/** ctx.userQuestions 服务的最小形状。 */
interface UserQuestionsService {
  ask(request: UserQuestionRequest): Promise<{ answers: Array<{ id: string; selected: string[] }> }>;
}

/** 面板选项：首字符是判断键，避免 label 本地化后失配。 */
const ALLOW_LABEL = "允许一次 (Allow once)";
const REJECT_LABEL = "拒绝 (Reject)";

function apply(ctx: Context): void {
  ctx.on("approval/request", async (req: ApprovalRequest, next: () => Promise<ApprovalOutcome>) => {
    // 工具已被取消：审批同步取消，不打扰用户。
    if (req.signal?.aborted === true) return "cancelled";

    const userQuestions = ctx.get("userQuestions") as UserQuestionsService | undefined;
    // 没有 UI 通道（例如 dsh-tui 未加载）→ 交给下一个 answerer / 默认 unavailable。
    if (userQuestions === undefined) return next();

    try {
      const answer = await userQuestions.ask({
        agent: req.agent,
        signal: req.signal,
        questions: [
          {
            id: `approval-${req.toolName}-${req.callId ?? "call"}`,
            question: buildPrompt(req),
            options: [
              { label: ALLOW_LABEL, description: buildPrompt(req) },
              { label: REJECT_LABEL, description: buildPrompt(req) },
            ],
          },
        ],
      });
      const selected = answer.answers[0]?.selected?.[0] ?? "";
      return selected === ALLOW_LABEL ? "allowed-once" : "rejected";
    } catch (error) {
      // 用户 Esc / 工具信号中止 → QuestionStore 以 ASK_ABORTED reject →
      // cancelled；其他失败（如子代理无权问人）→ 交给下一个 answerer
      //（默认 unavailable，fail closed）。
      if (error instanceof UserQuestionError && error.code === "ASK_ABORTED") return "cancelled";
      return next();
    }
  });
}

function buildPrompt(req: ApprovalRequest): string {
  const lines = [`⚠️ 权限审批：工具 ${req.toolName} 请求授权`];
  if (req.reason !== undefined && req.reason !== "") lines.push(`原因：${req.reason}`);
  lines.push("批准仅对本次操作生效。");
  return lines.join("\n");
}

export default { name, apply };
