// Claude Code: one JSONL file per session in ~/.claude/projects/<encoded cwd>/<session id>.jsonl
// (CLAUDE_CONFIG_DIR moves ~/.claude). A line is one message part; assistant messages are split
// into one line per content block, sharing message.id and repeating its usage.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { head, indexed, parseLines, textOf, titleOf } from "./common.mjs";

const base = () => path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"), "projects");

// Text Claude Code itself puts in a user line: slash-command echoes, hook output, reminders.
const INJECTED = /^\s*<(command-name|command-message|local-command-stdout|local-command-caveat|system-reminder|user-prompt-submit-hook|bash-input|bash-stdout|task-notification)/;

function files() {
  const out = [];
  let dirs = [];
  try {
    dirs = fs.readdirSync(base(), { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    return out;
  }
  // Top level only: <session>/subagents/*.jsonl are subagent transcripts, read with their parent.
  for (const d of dirs) {
    const dir = path.join(base(), d.name);
    try {
      for (const f of fs.readdirSync(dir)) if (f.endsWith(".jsonl")) out.push(path.join(dir, f));
    } catch {}
  }
  return out;
}

function meta(file) {
  let cwd = null;
  let startedAt = null;
  let title = null;
  let summary = null;
  for (const line of head(file).split("\n")) {
    if (!line) continue;
    let r;
    try {
      r = JSON.parse(line);
    } catch {
      continue;
    }
    if (r.type === "summary" && r.summary) summary ??= r.summary;
    if (r.type === "custom-title" && r.customTitle) summary = r.customTitle;
    cwd ??= r.cwd ?? null;
    startedAt ??= r.timestamp ?? null;
    if (!title && r.type === "user" && !r.isMeta) {
      const t = typeof r.message?.content === "string" ? r.message.content : textOf((r.message?.content ?? []).filter((b) => b.type === "text"));
      if (t && !INJECTED.test(t)) title = titleOf(t);
    }
    if (cwd && startedAt && title) break;
  }
  if (!startedAt) return null;
  return { id: path.basename(file, ".jsonl"), cwd, project: cwd ? path.basename(cwd) : null, startedAt, title: summary ?? title };
}

// o.usage: also a "usage" event per model call (its message.id as `req`) and `req` on tool calls.
function events(s, o = {}) {
  const out = [];
  const push = (e) => out.push({ i: out.length, ...e });
  const seen = new Set();
  for (const r of parseLines(s.file)) {
    const ts = r.timestamp;
    if (r.type === "user") {
      const c = r.message?.content;
      if (typeof c === "string") {
        push({ ts, role: r.isMeta || INJECTED.test(c) ? "system" : "user", text: c });
        continue;
      }
      for (const b of c ?? []) {
        if (b.type === "text") push({ ts, role: r.isMeta || INJECTED.test(b.text) ? "system" : "user", text: b.text });
        else if (b.type === "tool_result") push({ ts, role: "tool_result", toolId: b.tool_use_id, ok: !b.is_error, text: textOf(b.content) });
      }
    } else if (r.type === "assistant") {
      const m = r.message ?? {};
      const req = o.usage ? (m.id ?? r.uuid) : undefined;
      if (o.usage && m.usage && !seen.has(req)) {
        seen.add(req);
        const u = m.usage;
        push({ ts, role: "usage", req, model: m.model, text: "", tokens: { input: u.input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, output: u.output_tokens ?? 0 } });
      }
      for (const b of m.content ?? []) {
        if (b.type === "text") push({ ts, role: "assistant", text: b.text, model: m.model });
        else if (b.type === "tool_use") push({ ts, role: "tool_call", tool: b.name, toolId: b.id, input: b.input, text: JSON.stringify(b.input ?? {}), model: m.model, ...(req ? { req } : {}) });
      }
    }
  }
  return out;
}

function usage(s) {
  const seen = new Set();
  const byModel = {};
  for (const r of parseLines(s.file)) {
    if (r.type !== "assistant" || !r.message?.usage) continue;
    const id = r.message.id ?? r.uuid;
    if (seen.has(id)) continue;
    seen.add(id);
    const u = r.message.usage;
    const m = (byModel[r.message.model ?? "unknown"] ??= { calls: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0 });
    m.calls++;
    m.input += u.input_tokens ?? 0;
    m.cacheRead += u.cache_read_input_tokens ?? 0;
    m.cacheWrite += u.cache_creation_input_tokens ?? 0;
    m.output += u.output_tokens ?? 0;
  }
  return byModel;
}

export const adapter = {
  name: "claude-code",
  label: "Claude Code",
  where: () => base(),
  available: () => fs.existsSync(base()),
  sessions: () => indexed("claude-code", files(), meta),
  events,
  usage,
};
