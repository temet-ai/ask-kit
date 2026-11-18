// The baseline: the calling agent digs itself. Each question goes to `claude -p` (Sonnet) with its
// normal read tools (Read, Grep, Glob, Bash), no MCP servers and so no `ask`, in the working
// directory an agent would have: the repo for code questions, a neutral folder for session
// questions (told where each agent keeps its transcripts). Follow-ups resume the same session.
//
//   node bench/run-baseline.mjs --set sessions|code|all --out <file.jsonl> --cwd-sessions <dir> \
//     --repos ask-kit=<clone>,mike-ask=<clone> [--only id,id] [--model sonnet] [--budget 0.75]
//
// From the stream it records cost, time, turns, tool calls, and the context: the first request's
// input (system prompt, tools, question) and the largest request's, whose difference is what the
// digging added to the agent's own context.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { loadQuestions } from "./paths.mjs";

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const set = arg("set", "all");
const out = arg("out");
const only = arg("only")?.split(",");
const model = arg("model", "sonnet");
const budget = arg("budget", "0.75");
const cwdSessions = arg("cwd-sessions");
// --subagent <model>: the caller may not dig itself; it hands the question to a subagent (Agent
// tool, general-purpose, on <model>). Context is then counted from the caller's own turns only.
const sub = arg("subagent");
const extraNote = arg("note", "");
const repos = Object.fromEntries((arg("repos", "") || "").split(",").filter(Boolean).map((kv) => kv.split("=")));
const spec = loadQuestions();
const qs = spec.questions.filter((q) => (set === "all" || q.domain === set) && (!only || only.includes(q.id) || only.includes(q.followupOf)));

const WHERE =
  "\n\nPast coding-agent sessions on this machine are stored as transcripts: Claude Code in ~/.claude/projects/<project>/<session>.jsonl, " +
  "Codex in ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl, GitHub Copilot CLI in ~/.copilot/session-state/<id>/events.jsonl. " +
  "Answer from them, briefly, with the session id as evidence. Only read; change nothing.";
const CODE = "\n\nAnswer from the code in this repository, briefly, with path:line citations. Only read; change nothing.";
const DELEGATE = sub
  ? `\n\nDo not read files or run commands yourself: hand the digging to a subagent with the Agent tool (subagent_type "general-purpose", model "${sub}"), then answer from what it reports.`
  : "";

function claude(prompt, cwd, resume) {
  const args = [
    "-p", prompt,
    "--model", model,
    "--output-format", "stream-json", "--verbose",
    "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
    // User settings (hooks, plugins) left out, so nothing is injected; CLAUDE.md files still load.
    "--setting-sources", "project,local",
    "--allowedTools", "Read", "Grep", "Glob", "Bash", ...(sub ? ["Agent"] : []),
    "--disallowedTools", "Edit", "Write", "NotebookEdit", ...(sub ? [] : ["Agent", "Task"]), "WebFetch", "WebSearch", "Skill",
    "--permission-mode", "bypassPermissions",
    "--max-budget-usd", budget,
    ...(resume ? ["--resume", resume] : []),
  ];
  return new Promise((resolve) => {
    const p = spawn("claude", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let buf = "";
    let err = "";
    p.stdout.on("data", (d) => (buf += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => resolve({ code, events: buf.split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean), err }));
  });
}

let lastSession = null;
for (const q of qs) {
  const cont = !!q.followupOf;
  const cwd = q.domain === "code" ? repos[q.repo] : cwdSessions;
  if (!cwd) throw new Error(`no working directory for ${q.id}`);
  const prompt = cont ? q.question : (q.domain === "sessions" ? q.question + (spec.sessionsNote ?? "") + extraNote + WHERE : q.question + CODE) + DELEGATE;
  const started = Date.now();
  const r = await claude(prompt, cwd, cont ? lastSession : null);
  const wallMs = Date.now() - started;
  // A subagent runs in the background: the caller ends a first turn ("still searching"), then wakes
  // when the subagent reports and answers in a second turn with its own result event. Use the last.
  const result = r.events.findLast((e) => e.type === "result") ?? {};
  // The caller's own turns; a subagent's turns carry the Agent call's id in parent_tool_use_id.
  const own = r.events.filter((e) => e.type === "assistant" && !e.parent_tool_use_id);
  const subTurns = new Set(r.events.filter((e) => e.type === "assistant" && e.parent_tool_use_id).map((e) => e.message?.id)).size;
  // Token usage per side. Stream events repeat a message's usage once per content block, so count
  // each message id once.
  const usageOf = (evs) => {
    const seen = new Map();
    for (const e of evs) if (e.message?.usage) seen.set(e.message.id, e.message.usage);
    const t = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, requests: seen.size };
    for (const u of seen.values()) {
      t.input += u.input_tokens ?? 0;
      t.cacheRead += u.cache_read_input_tokens ?? 0;
      t.cacheWrite += u.cache_creation_input_tokens ?? 0;
      t.output += u.output_tokens ?? 0;
    }
    return t;
  };
  const callerUsage = usageOf(own);
  const subUsage = usageOf(r.events.filter((e) => e.type === "assistant" && e.parent_tool_use_id));
  const ctx = own
    .filter((e) => e.message?.usage)
    .map((e) => {
      const u = e.message.usage;
      return (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
    });
  const toolCalls = own.flatMap((e) => (e.message?.content ?? []).filter((c) => c.type === "tool_use").map((c) => c.name));
  const u = result.usage ?? {};
  const row = {
    id: q.id,
    domain: q.domain,
    repo: q.repo ?? null,
    backend: sub ? `subagent-${sub}` : `baseline-${model}`,
    caller: model,
    subTurns,
    callerUsage,
    subUsage,
    sessionId: result.session_id ?? null,
    modelUsage: result.modelUsage ?? null,
    run: 1,
    continued: cont,
    ok: result.subtype === "success" && !result.is_error,
    stop: result.subtype ?? `exit ${r.code}`,
    wallMs,
    ms: sub ? wallMs : (result.duration_ms ?? wallMs),
    callerTurns: r.events.filter((e) => e.type === "result").length,
    costUsd: result.total_cost_usd ?? null,
    turns: result.num_turns ?? null,
    toolCalls: toolCalls.length,
    tools: Object.fromEntries([...new Set(toolCalls)].map((t) => [t, toolCalls.filter((x) => x === t).length])),
    contextFirst: ctx[0] ?? null,
    contextPeak: ctx.length ? Math.max(...ctx) : null,
    usage: { input: u.input_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0, output: u.output_tokens ?? 0 },
    answer: String(result.result ?? r.err.slice(0, 500)),
  };
  lastSession = result.session_id ?? lastSession;
  fs.appendFileSync(out, JSON.stringify(row) + "\n");
  console.log(`${row.backend} ${q.id.padEnd(24)} ${row.ok ? "ok " : row.stop} ${Math.round(wallMs / 1000)}s $${(row.costUsd ?? 0).toFixed(3)} ${row.turns}t ctx ${row.contextFirst}->${row.contextPeak}`);
}
