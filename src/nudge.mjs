// The plugin's PostToolUse hook: counts the lookups an agent makes in a row and, after the third
// that `ask` could have answered, adds one line to its context. It never blocks a call and never
// fails: a bad input or an unwritable state folder means no line and exit 0. No network, no model.
import fs from "node:fs";
import path from "node:path";
import { STATE_ROOT } from "./config.mjs";
import { classify } from "./gaps.mjs";

export const NUDGE_AFTER = 3;
const dir = () => path.join(STATE_ROOT, "nudges");
const slug = (s) => String(s ?? "").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "none";

/** The `about` that fits a lookup: the investigator a chain of this family would go to. Null when ask cannot answer it. */
export function aboutFor(c, arg = "") {
  if (c.fam === "web" || c.fam === "mcp") return null;
  if (c.fam === "mike") return "mike";
  if (c.fam === "gh") return "github";
  if (c.fam === "db") return "postgres";
  if (c.fam === "machine") return /\b(docker|podman)\b/.test(arg) ? "docker" : /\b(systemctl|journalctl)\b/.test(arg) ? "systemd" : "ops";
  if (/\.claude\/projects|\.codex\/sessions|\.gemini\/tmp|opencode\/storage|\.jsonl\b/.test(arg)) return "sessions";
  return "code";
}

export const nudgeLine = (about) =>
  `ask-kit: that is ${NUDGE_AFTER} lookups in a row. \`ask\` (about: "${about}") answers a question like this outside your context in one call; give it the whole question, and use continue: true to follow up.`;

export const subagentRule = () =>
  "If you have the `ask` tool (ask-kit), call it before a run of searches whose purpose is to answer a question: about: \"code\" for this repository's code and history, about: \"sessions\" for what earlier agent sessions did or decided, or a kit's name (github, docker, ...). It returns a short answer with its evidence; continue: true sends a follow-up to the same investigator. Read files yourself when you are about to edit them.";

/** The text a call is classified on: the command for Bash, the pattern or path for the rest. */
const argOf = (i) => String(i?.command ?? i?.pattern ?? i?.file_path ?? i?.path ?? i?.url ?? i?.query ?? "");

/**
 * One PostToolUse input. Returns the line to add, or null. The counter is per session and per
 * agent, so a subagent's chain is its own.
 */
export function onToolUse(input, { now = new Date() } = {}) {
  const tool = input?.tool_name;
  if (!tool || !input.session_id) return null;
  const arg = argOf(input.tool_input);
  const c = classify(tool, arg);
  const file = path.join(dir(), `${slug(input.session_id)}${input.agent_id ? `.${slug(input.agent_id)}` : ""}.json`);
  let s = { n: 0, nudged: false };
  try {
    const j = JSON.parse(fs.readFileSync(file, "utf8"));
    if (Number.isInteger(j.n) && j.n >= 0) s = { n: j.n, nudged: !!j.nudged };
  } catch {}
  let about = null;
  if (c.k === "ask" || c.k === "write" || c.k === "act") s = { n: 0, nudged: false };
  else if (c.k === "look") {
    const a = aboutFor(c, arg);
    if (!a) return null; // a lookup ask cannot answer neither counts nor breaks the chain
    s.n += 1;
    if (s.n >= NUDGE_AFTER && !s.nudged) {
      s.nudged = true;
      about = a;
    }
  } else return null;
  fs.mkdirSync(dir(), { recursive: true, mode: 0o700 });
  fs.writeFileSync(`${file}.${process.pid}.tmp`, JSON.stringify({ ...s, at: now.toISOString() }), { mode: 0o600 });
  fs.renameSync(`${file}.${process.pid}.tmp`, file);
  if (!about) return null;
  fs.appendFileSync(path.join(dir(), "nudges.jsonl"), JSON.stringify({ at: now.toISOString(), type: "nudge", session: input.session_id, agent: input.agent_type ?? null, about, fam: c.fam, lookups: s.n }) + "\n", { mode: 0o600 });
  return nudgeLine(about);
}

/** Counters of sessions not touched for a week are removed. */
export function prune(now = Date.now()) {
  try {
    for (const f of fs.readdirSync(dir())) if (f.endsWith(".json") && now - fs.statSync(path.join(dir(), f)).mtimeMs > 7 * 86400_000) fs.rmSync(path.join(dir(), f), { force: true });
  } catch {}
}

/** Nudges logged since a time: {count, sessions, first, by}. */
export function nudgesSince(sinceMs) {
  let rows = [];
  try {
    rows = fs
      .readFileSync(path.join(dir(), "nudges.jsonl"), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter((r) => r?.type === "nudge" && Date.parse(r.at) >= sinceMs);
  } catch {}
  const by = {};
  for (const r of rows) by[r.about] = (by[r.about] ?? 0) + 1;
  return { count: rows.length, sessions: new Set(rows.map((r) => r.session)).size, first: rows[0]?.at ?? null, by };
}

const readStdin = () => {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
};

/** `ask-kit plugin tool`: the hook. Always exits 0. */
export function runToolHook(raw = readStdin()) {
  try {
    const line = onToolUse(JSON.parse(raw));
    if (line) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: line } }) + "\n");
    else if (Math.random() < 0.02) prune();
  } catch {}
  process.exit(0);
}

/** `ask-kit plugin subagent`: SubagentStart adds the short rule to the subagent's context. */
export function runSubagentHook() {
  try {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "SubagentStart", additionalContext: subagentRule() } }) + "\n");
  } catch {}
  process.exit(0);
}
