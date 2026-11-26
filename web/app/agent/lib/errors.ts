// What the person is told when a chat turn fails, and what they can do about it.

export type ErrorAction = "resend" | "new_chat" | "none";

export interface ChatErrorInfo {
  code: string;
  message: string;
  action: ErrorAction;
  /** Seconds to wait before a resend is allowed. */
  waitSeconds?: number;
  /** Chat is off until the problem is fixed or tomorrow; the shortlist and details stay usable. */
  disablesChat: boolean;
}

const DEFAULT_WAIT_SECONDS = 30;

/** The rate limiter's message ends "Retry in 45 seconds." or "Retry in 1 minute." */
function waitSecondsFrom(message: string | undefined): number {
  const match = /(\d+)\s*(second|minute)/i.exec(message ?? "");
  if (!match) return DEFAULT_WAIT_SECONDS;
  return Number(match[1]) * (match[2]!.toLowerCase() === "minute" ? 60 : 1);
}

const RESEND = "Something went wrong on my side. Your message wasn’t lost.";

export function describeChatError(code: string | undefined, serverMessage?: string): ChatErrorInfo {
  switch (code) {
    case "RATE_LIMITED": {
      const waitSeconds = waitSecondsFrom(serverMessage);
      return {
        code,
        message: `You’re sending messages quickly. Try again in ${waitSeconds} s.`,
        action: "resend",
        waitSeconds,
        disablesChat: false,
      };
    }
    case "DAILY_LIMIT":
      return {
        code,
        message: "You’ve reached today’s chat limit. Try again tomorrow. Your shortlist still works.",
        action: "none",
        disablesChat: true,
      };
    case "BUDGET_EXHAUSTED":
      return {
        code,
        message: "The guide has used up its budget for today. Try again tomorrow. Your shortlist still works.",
        action: "none",
        disablesChat: true,
      };
    case "MODEL_NOT_CONFIGURED":
      return {
        code,
        message: "Chat isn’t set up on this server. You can still enter details and answer the guide’s questions.",
        action: "none",
        disablesChat: true,
      };
    case "TURN_LIMIT":
      return {
        code,
        message: "This chat has reached its length limit.",
        action: "new_chat",
        disablesChat: false,
      };
    case "SESSION_BUSY":
      return {
        code,
        message: "The previous message is still being processed.",
        action: "resend",
        disablesChat: false,
      };
    case "SESSION_NOT_FOUND":
      return {
        code,
        message: "This chat expired on the server. Use Start over to begin a new one.",
        action: "none",
        disablesChat: false,
      };
    case "NETWORK_ERROR":
      return { code, message: "Could not reach the server.", action: "resend", disablesChat: false };
    case "STREAM_INTERRUPTED":
      return { code, message: "The reply was cut off.", action: "resend", disablesChat: false };
    default:
      return { code: code ?? "TURN_FAILED", message: RESEND, action: "resend", disablesChat: false };
  }
}
