// The REPL's globals for the sessions domain. `help` returns this file.

type Source = "claude-code" | "codex" | "copilot-cli" | "gemini-cli" | "opencode";

interface Session {
  source: Source;
  id: string;            // the agent's own session id
  cwd: string | null;    // where it ran
  project: string | null; // basename of cwd
  title: string | null;  // its summary or first prompt, clipped
  startedAt: string;     // ISO
  updatedAt: string;     // ISO, last write
  kb?: number;
}

interface Event {
  i: number;             // position in the session: the citation
  ts?: string;
  role: "user" | "assistant" | "tool_call" | "tool_result" | "system"; // system: injected context, not typed by the person
  text: string;
  tool?: string;         // tool_call: the tool's name (Bash, exec_command, apply_patch, Edit, ...)
  toolId?: string;       // pairs a tool_call with its tool_result
  input?: unknown;       // tool_call: parsed arguments where the agent stores them parsed
  ok?: boolean;          // tool_result: false when the tool reported failure
  model?: string;
}

interface Hit { source: Source; session: string; project: string | null; title: string | null; i: number; ts?: string; role: string; tool?: string; snippet: string }

// `since` / `until`: hours ago (number) or an ISO date. `project` matches project or cwd (substring).
interface Window { since?: number | string; until?: number | string; source?: Source | Source[]; project?: string; cwd?: string }

declare const history: {
  sources(): { name: Source; label: string; where: string; available: boolean }[];
  // Newest first. Default limit 50; `.total` is the count before the limit.
  sessions(o?: Window & { limit?: number }): Promise<Session[] & { total: number }>;
  // A session by id or id prefix (or "codex:<id>").
  session(ref: string): Promise<Session>;
  // A session's events; `maxText` clips each text. `.total` is the event count before filters.
  events(ref: string | Session, o?: { roles?: string | string[]; from?: number; to?: number; maxText?: number }): Promise<Event[] & { total: number; session: Session }>;
  // Tokens by model, as the agent recorded them.
  usage(ref: string | Session): Promise<Record<string, { calls?: number; input: number; cacheRead: number; cacheWrite: number; output: number; premiumRequests?: number; costUsd?: number }>>;
  // Words (all must appear in one event, any case) or a RegExp. Default roles: user, assistant, tool_call, tool_result.
  // Narrow with a window: an unbounded search reads every transcript. Stops at a 40 s budget.
  grep(query: string | RegExp, o?: Window & { session?: string; roles?: string | string[]; max?: number; snippet?: number; budgetMs?: number }):
    Promise<Hit[] & { total: number; complete: boolean; scanned: number; stoppedEarly?: string }>;
};

// "codex 5ca1ab1e #42" from a Hit, or from {source, session|id, i}.
declare function cite(x: { source?: string; session?: string; id?: string; i?: number }): string;

declare const scripts: {
  list(): { name: string; purpose: string; params: Record<string, string>; returns: string; draft: boolean }[];
  show(name: string): string;
  run(name: string, params?: Record<string, unknown>): Promise<any>;
  draft(name: string, source: string): { name: string; file: string };
};

// Toolkit (also tk.*)
declare function shape(x: unknown, depth?: number): unknown;
declare function pick<T>(rows: T | T[], ...keys: string[]): any;
declare function table(rows: object[], cols?: string[], o?: { width?: number }): string;
declare function top<T>(rows: T[], key: string | ((r: T) => number), n?: number): T[];
declare function groupBy<T>(rows: T[], key: string | ((r: T) => string)): Record<string, T[]>;
declare function countBy<T>(rows: T[], key: string | ((r: T) => string)): Record<string, number>;
declare function sumBy<T>(rows: T[], key: string | ((r: T) => number)): number;
declare function clip(s: string | null, max?: number): string | null;
declare function since(hours: number): string; // ISO time `hours` ago
