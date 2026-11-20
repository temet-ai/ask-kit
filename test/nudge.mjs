// The plugin's PostToolUse and SubagentStart hooks: fed sample hook JSON, the tool hook prints one
// line after the third lookup in a row and never exits non-zero; the nudge is logged and
// `ask-kit gaps` counts it. No model, no network.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ask-kit-nudge-"));
const env = { ...process.env, ASK_KIT_CONFIG: path.join(tmp, "cfg"), ASK_KIT_STATE: path.join(tmp, "state"), HOME: tmp };
process.env.ASK_KIT_CONFIG = env.ASK_KIT_CONFIG;
process.env.ASK_KIT_STATE = env.ASK_KIT_STATE;

const run = (sub, stdin) => {
  const r = spawnSync(process.execPath, [path.join(ROOT, "bin", "ask-kit.mjs"), "plugin", sub], { input: stdin, env, encoding: "utf8" });
  assert.equal(r.status, 0, `plugin ${sub} exits 0 (stderr: ${r.stderr})`);
  return r.stdout;
};
const post = (session, tool, input, extra = {}) =>
  run("tool", JSON.stringify({ session_id: session, hook_event_name: "PostToolUse", tool_name: tool, tool_input: input, tool_response: {}, ...extra }));

// Bash rg, Read, Grep: nothing for two, one line on the third.
assert.equal(post("s1", "Bash", { command: "rg -n handler src/" }), "");
assert.equal(post("s1", "Read", { file_path: "/srv/watch/a.mjs" }), "");
const out = post("s1", "Grep", { pattern: "Vimes" });
const j = JSON.parse(out);
assert.equal(j.hookSpecificOutput.hookEventName, "PostToolUse");
assert.equal(j.hookSpecificOutput.additionalContext, "ask-kit: that is 3 lookups in a row. `ask` (about: \"code\") answers a question like this outside your context in one call; give it the whole question, and use continue: true to follow up.");
assert.equal(out.trim().split("\n").length, 1);

// Not again within the same chain.
assert.equal(post("s1", "Read", { file_path: "/srv/watch/b.mjs" }), "");
assert.equal(post("s1", "Read", { file_path: "/srv/watch/c.mjs" }), "");

// An Edit resets, so a new chain nudges again after three.
assert.equal(post("s1", "Edit", { file_path: "/srv/watch/a.mjs" }), "");
assert.equal(post("s1", "Read", { file_path: "/srv/watch/a.mjs" }), "");
assert.equal(post("s1", "Read", { file_path: "/srv/watch/b.mjs" }), "");
assert.match(post("s1", "Read", { file_path: "/srv/watch/c.mjs" }), /3 lookups in a row/);

// A call to ask resets; a lookup in another session or subagent counts on its own.
post("s2", "Read", { file_path: "/srv/watch/a.mjs" });
post("s2", "Read", { file_path: "/srv/watch/b.mjs" });
assert.equal(post("s2", "mcp__plugin_ask-kit_ask__ask", { question: "where is the watch rota?" }), "");
assert.equal(post("s2", "Read", { file_path: "/srv/watch/c.mjs" }), "");
post("s3", "Read", { file_path: "/srv/watch/a.mjs" }, { agent_id: "agent-1", agent_type: "Explore" });
post("s3", "Read", { file_path: "/srv/watch/b.mjs" }, { agent_id: "agent-1", agent_type: "Explore" });
assert.equal(post("s3", "Read", { file_path: "/srv/watch/c.mjs" }), ""); // the main agent's own counter is at 1
assert.match(post("s3", "Read", { file_path: "/srv/watch/c.mjs" }, { agent_id: "agent-1", agent_type: "Explore" }), /3 lookups in a row/);

// Names the investigator that fits: gh is github, a transcript path is sessions.
for (const c of ["gh pr list", "gh pr view 4", "gh run list"]) var gh = post("s4", "Bash", { command: c });
assert.match(gh, /about: \\"github\\"/);
for (const c of ["ls ~/.claude/projects/x/a.jsonl", "head ~/.claude/projects/x/b.jsonl", "wc -l ~/.claude/projects/x/c.jsonl"]) var se = post("s5", "Bash", { command: c });
assert.match(se, /about: \\"sessions\\"/);

// SubagentStart adds the short rule.
const sub = JSON.parse(run("subagent", JSON.stringify({ session_id: "s1", hook_event_name: "SubagentStart", agent_id: "agent-1", agent_type: "Explore" })));
assert.equal(sub.hookSpecificOutput.hookEventName, "SubagentStart");
assert.match(sub.hookSpecificOutput.additionalContext, /call it before a run of searches/);
assert.match(run("subagent", ""), /SubagentStart/);

// The plugin names both hooks, and its commands exist.
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, ".claude-plugin", "plugin.json"), "utf8"));
for (const [ev, sub] of [["PostToolUse", "tool"], ["SubagentStart", "subagent"]]) {
  const h = manifest.hooks[ev][0].hooks[0];
  assert.equal(h.type, "command");
  assert.deepEqual(h.args.slice(-2), ["plugin", sub]);
  assert.ok(h.timeout <= 10);
}

// The nudges are logged, and gaps counts them.
const { nudgesSince } = await import("../src/nudge.mjs");
const n = nudgesSince(0);
assert.equal(n.count, 5);
assert.equal(n.sessions, 4);
assert.deepEqual(n.by, { code: 3, github: 1, sessions: 1 });
const { formatReport } = await import("../src/gaps.mjs");
const base = { since: "2026-11-01T00:00:00Z", scanned: { sessions: 0, bySource: {}, fromCache: 0, seconds: 0 }, cost: { basis: "x" }, coverage: { asks: 0, byHand: 0, share: null, tokenShare: null, handSessions: 0, handTokens: 0, handUsd: 0 }, excluded: { mailOrFleet: 0, other: 0 }, skipped: [], noKit: [] };
assert.match(formatReport({ ...base, nudges: n }), /Nudges: the plugin's hook pointed 5 lookup chains at ask in 4 sessions/);
assert.match(formatReport({ ...base, nudges: { count: 0, sessions: 0, by: {} } }), /Nudges: none/);

// Broken input and a broken state file never error and never print.
for (const bad of ["", "not json", "null", "[]", "{}", JSON.stringify({ tool_name: "Read" }), JSON.stringify({ session_id: "s6", tool_name: 5 })]) assert.equal(run("tool", bad), "");
const stateDir = path.join(env.ASK_KIT_STATE, "nudges");
fs.writeFileSync(path.join(stateDir, "s7.json"), "{{{ not json");
assert.equal(post("s7", "Read", { file_path: "/srv/watch/a.mjs" }), "");
fs.writeFileSync(path.join(stateDir, "s8.json"), JSON.stringify({ n: "many" }));
assert.equal(post("s8", "Read", { file_path: "/srv/watch/a.mjs" }), "");
fs.rmSync(stateDir, { recursive: true });
fs.writeFileSync(stateDir, "a file where the folder should be"); // the state folder cannot be made
assert.equal(post("s9", "Read", { file_path: "/srv/watch/a.mjs" }), "");
fs.rmSync(stateDir);

fs.rmSync(tmp, { recursive: true, force: true });
console.log("ok");
process.exit(0);
