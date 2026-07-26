// How Claude Code actually assembles an API request.
//
// These rules were derived by capturing real requests through a local proxy
// (ANTHROPIC_BASE_URL) and diffing them against the transcript. Everything here is
// measured, not guessed. A capture of one request looked like:
//
//   system:   3 blocks (~9,733 chars) — identical on every turn, cache_control 1h
//   tools:    28 schemas (~85,896 chars) — identical on every turn
//   messages: [0] user: <system-reminder> block + the user's first prompt
//             [1] role:"system": "SessionStart hook additional context: "
//                                + hook additionalContext + agent listing + skill listing
//             [2..] the conversation, appended verbatim; only the LAST message
//                   carries cache_control, so everything before it is the cache prefix
//   context_management: { edits: [{ type: "clear_thinking_20251015", keep: "all" }] }
//
// Consequences the visualizer must honour:
//  - prior turns are re-sent verbatim (nothing is trimmed or re-summarized)
//  - thinking blocks are stripped server-side, so they don't count as input
//  - the base system prompt and tool schemas never appear in the transcript

export const HOOK_SYSTEM_PREFIX = "SessionStart hook additional context: ";

/** Sizes measured from a real capture; overridable by a per-machine calibration. */
export interface PayloadCalibration {
  systemPromptChars: number;
  toolSchemaChars: number;
  toolCount: number;
  capturedAt?: string;
  source: "builtin" | "calibrated";
}

/** Defaults from the reference capture (Claude Code 2.1.220, 28 tools). */
export const BUILTIN_CALIBRATION: PayloadCalibration = {
  systemPromptChars: 9733,
  toolSchemaChars: 85896,
  toolCount: 28,
  source: "builtin",
};

/**
 * Thinking is removed from the request by `context_management.clear_thinking`, so it
 * must not be counted as input context.
 */
export const THINKING_IS_STRIPPED = true;
