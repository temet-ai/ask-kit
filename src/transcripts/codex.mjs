// Codex CLI: one "rollout" JSONL per session in $CODEX_HOME/sessions/YYYY/MM/DD/ (and
// archived_sessions/). Lines are {timestamp, type, payload}: session_meta, turn_context,
// response_item (messages, tool calls and their output) and event_msg (token counts, task events).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { head, indexed, parseLines, textOf, titleOf, walk } from "./common.mjs";

const home = () => process.env.CODEX_HOME || path.join(os.homedir(), ".codex");

// What Codex puts in a "user" message itself: AGENTS.md, environment and instruction blocks.
const INJECTED = /^\s*(# AGENTS\.md instructions|<environment_context>|<user_instructions>|<turn_aborted>|<skills_instructions>|<user_shell_command>|<subagent_notification>)/;

const files = () => [
  ...walk(path.join(home(), "sessions"), /^rollout-.*\.jsonl$/, 4),
  ...walk(path.join(home(), "archived_sessions"), /^rollout-.*\.jsonl$/, 1),
];

const contentText = (content) => textOf((content ?? []).filter((c) => /text$/.test(c.type ?? "")).map((c) => c.text));

function meta(file) {
  let id = null;
  let cwd = null;
  let startedAt = null;
  let title = null;
  let originator = null;
  for (const line of head(file).split("\n")) {
    if (!line) continue;
    let r;
    try {
      r = JSON.parse(line);
    } catch {
      continue;
    }
    if (r.type === "session_meta") {
      id = r.payload?.id ?? r.payload?.session_id ?? id;
      cwd = r.payload?.cwd ?? cwd;
      startedAt = r.payload?.timestamp ?? r.timestamp;
      originator = r.payload?.originator ?? null;
    }
    if (!title && r.type === "response_item" && r.payload?.type === "message" && r.payload.role === "user") {
      const t = contentText(r.payload.content);
      if (t && !INJECTED.test(t)) title = titleOf(t);
    }
    if (id && title) break;
  }
  if (!id) return null;
  return { id, cwd, project: cwd ? path.basename(cwd) : null, startedAt, title, originator };
}

// o.usage: also a "usage" event per model call, from the token_count that follows it. Tool calls
// carry `req`, the number of the token_count that will cover them.
function events(s, o = {}) {
  const out = [];
  const raw = (e) => out.push({ i: out.length, ...e });
  let model = null;
  let req = 0;
  let lastTotal = null;
  const push = (e) => raw(o.usage && e.role === "tool_call" ? { ...e, req: String(req) } : e);
  for (const r of parseLines(s.file)) {
    const ts = r.timestamp;
    const p = r.payload ?? {};
    if (r.type === "turn_context") model = p.model ?? model;
    if (o.usage && r.type === "event_msg" && p.type === "token_count" && p.info?.last_token_usage) {
      // Codex repeats a token_count without a new call; the running total tells them apart.
      const total = p.info.total_token_usage?.total_tokens;
      if (total != null && total === lastTotal) continue;
      lastTotal = total;
      const u = p.info.last_token_usage;
      raw({ ts, role: "usage", req: String(req++), model, text: "", tokens: { input: (u.input_tokens ?? 0) - (u.cached_input_tokens ?? 0), cacheWrite: u.cache_write_input_tokens ?? 0, cacheRead: u.cached_input_tokens ?? 0, output: u.output_tokens ?? 0 } });
      continue;
    }
    if (r.type !== "response_item") continue;
    switch (p.type) {
      case "message": {
        const text = contentText(p.content);
        if (!text) break;
        const role = p.role === "assistant" ? "assistant" : p.role === "user" && !INJECTED.test(text) ? "user" : "system";
        push({ ts, role, text, ...(role === "assistant" ? { model } : {}) });
        break;
      }
      case "function_call":
        push({ ts, role: "tool_call", tool: p.name, toolId: p.call_id, text: p.arguments ?? "", model });
        break;
      case "custom_tool_call":
        push({ ts, role: "tool_call", tool: p.name, toolId: p.call_id, text: p.input ?? "", model });
        break;
      case "local_shell_call":
        push({ ts, role: "tool_call", tool: "local_shell", toolId: p.call_id, text: JSON.stringify(p.action ?? {}), model });
        break;
      case "web_search_call":
        push({ ts, role: "tool_call", tool: "web_search", text: JSON.stringify(p.action ?? {}), model });
        break;
      case "function_call_output":
      case "custom_tool_call_output": {
        const o = p.output;
        const text = typeof o === "string" ? o : textOf(o?.content ?? o);
        // Codex reports a failed command in the output text ("Exit code: 1", "error:").
        const ok = typeof o === "object" && o?.success != null ? !!o.success : !/^(Exit code: [1-9]|error|Error)/m.test(text.slice(0, 200));
        push({ ts, role: "tool_result", toolId: p.call_id, ok, text });
        break;
      }
    }
  }
  return out;
}

function usage(s) {
  // token_count events carry the running total; the last one is the session's.
  let total = null;
  let model = "unknown";
  for (const r of parseLines(s.file)) {
    if (r.type === "turn_context") model = r.payload?.model ?? model;
    const t = r.type === "event_msg" && r.payload?.type === "token_count" ? r.payload.info?.total_token_usage : null;
    if (t) total = t;
  }
  if (!total) return {};
  return {
    [model]: {
      input: (total.input_tokens ?? 0) - (total.cached_input_tokens ?? 0),
      cacheRead: total.cached_input_tokens ?? 0,
      cacheWrite: 0,
      output: total.output_tokens ?? 0,
      reasoning: total.reasoning_output_tokens ?? 0,
    },
  };
}

export const adapter = {
  name: "codex",
  label: "Codex",
  where: () => path.join(home(), "sessions"),
  available: () => fs.existsSync(path.join(home(), "sessions")),
  sessions: () => indexed("codex", files(), meta),
  events,
  usage,
};
