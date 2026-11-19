// smith with no real transcripts or models: a Claude Code session that dug through an MCP server
// ("owl", configured in the repository's .mcp.json) three times for two questions. Scaffold starts
// the real server to list its tools; the model calls are stubs. Asserts the drafted manifest (reads
// only, no copied values, the server's directory), the mined bench, prove's rounds and install.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ask-kit-smith-")));
process.env.ASK_KIT_CONFIG = path.join(tmp, "config");
process.env.ASK_KIT_STATE = path.join(tmp, "state");
process.env.CLAUDE_CONFIG_DIR = path.join(tmp, "claude");
process.env.CODEX_HOME = path.join(tmp, "codex");
process.env.COPILOT_HOME = path.join(tmp, "copilot");
process.env.GEMINI_CLI_HOME = path.join(tmp, "gemini");
process.env.OPENCODE_DB = path.join(tmp, "none.db");
process.env.OWL_TOKEN = "not-a-real-token";
delete process.env.ASK_KIT_DRAFTS;

const repo = path.join(tmp, "work", "post-office");
fs.mkdirSync(path.join(repo, ".git"), { recursive: true });
const server = path.join(path.dirname(new URL(import.meta.url).pathname), "fixtures", "owl-mcp.mjs");
fs.writeFileSync(path.join(repo, ".mcp.json"), JSON.stringify({ mcpServers: { owl: { command: process.execPath, args: [server], env: { OWL_TOKEN: "${OWL_TOKEN}", OWL_URL: "http://owl.example" } } } }));
fs.mkdirSync(path.join(tmp, "config"), { recursive: true });
fs.writeFileSync(path.join(tmp, "config", "config.json"), JSON.stringify({ version: 1, domains: { sessions: { enabled: true }, code: { enabled: true } }, backends: { default: "x", list: { x: { kind: "api", model: "m" } } } }));

let clock = Date.now() - 86400_000;
const ts = () => new Date((clock += 1000)).toISOString();
let n = 0;
const rows = [];
const turn = (prompt, ids, answer) => {
  rows.push({ type: "user", timestamp: ts(), cwd: repo, sessionId: "s1", message: { role: "user", content: prompt } });
  const content = ids.map((id) => ({ type: "tool_use", id: `toolu_${n++}`, name: "mcp__owl__get_post", input: { id } }));
  rows.push({ type: "assistant", timestamp: ts(), cwd: repo, message: { id: `msg_${n++}`, model: "claude-sonnet-4", usage: { input_tokens: 1000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 10 }, content } });
  rows.push({ type: "user", timestamp: ts(), cwd: repo, message: { role: "user", content: content.map((c) => ({ type: "tool_result", tool_use_id: c.id, content: "letter" })) } });
  rows.push({ type: "assistant", timestamp: ts(), cwd: repo, message: { id: `msg_${n++}`, model: "claude-sonnet-4", content: [{ type: "text", text: answer }] } });
};
turn("Which letter from Moist von Lipwig is still waiting at the post office?", ["a", "b", "c"], "Letter `L-7` from Moist is waiting, addressed to Adora Belle.");
turn("Who sent the letter that went to the Patrician yesterday?", ["d", "e", "f"], "Drumknott sent `L-9` on behalf of Vetinari's office.");
turn("okay, send a reply to Adora Belle saying the golems are on their way", ["g", "h", "i"], "Sent.");
const dir = path.join(tmp, "claude", "projects", repo.replace(/[/.]/g, "-"));
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "s1.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");

const smith = await import("../src/smith.mjs");
const { readManifest, findKit } = await import("../src/kits.mjs");

assert.equal(smith.readsOnly("get_post"), true);
assert.equal(smith.readsOnly("gitlab_get_mr"), true);
assert.equal(smith.readsOnly("send_post"), false);
assert.equal(smith.readsOnly("gitlab_create_note"), false);
assert.equal(smith.readsOnly("gitlab_mr_diff_get"), true);
assert.equal(smith.readsOnly("k8s_tail_logs"), true);
assert.equal(smith.readsOnly("gitlab_mr_comments_add"), false);
assert.equal(smith.readsOnly("k8s_port_forward"), false);
assert.throws(() => smith.discover("web"), /many sites/);
assert.throws(() => smith.discover("mcp: nowhere", { cwds: [repo] }), /no agent config/);

const asked = [];
const chat = async ({ system, user }) => {
  asked.push({ system, user });
  return /improve a kit/.test(system)
    ? { instructions: "Call owl.get_post with the letter id first; cite the id.", changed: "get_post first" }
    : { says: "the owl post office: letters waiting, who sent what", keywords: ["letters?", "owl post"], route_hint: "letters and owls are owl", instructions: "Use owl.list_posts, then owl.get_post." };
};
const r = await smith.scaffold("mcp: owl", { since: "7d", chat });
assert.equal(r.name, "owl");
assert.deepEqual(r.allow, ["get_post", "list_posts"], "tools that read are allowed");
assert.deepEqual(r.leftOut, ["send_post"], "a tool that sends is left out");
assert.deepEqual(r.settings, ["OWL_URL"], "the literal value becomes a setting; the env reference stays a reference");
assert.equal(r.questions, 2);
assert.match(asked[0].user, /get_post: One letter by id/, "the model saw the tools");
assert.match(asked[0].user, /Moist von Lipwig/, "and the mined questions");
assert.doesNotMatch(asked[0].user, /send_post/, "not the tools left out");

const manifest = fs.readFileSync(path.join(r.dir, "ask-kit.toml"), "utf8");
assert.doesNotMatch(manifest, /owl\.example/, "no value from the agent's config is copied");
assert.doesNotMatch(manifest, /not-a-real-token/);
assert.match(manifest, /OWL_TOKEN = "\$\{OWL_TOKEN\}"/);
assert.match(manifest, /# Left out because they change something.*send_post/);
const m = readManifest(r.dir);
assert.equal(m.says, "the owl post office: letters waiting, who sent what");
const src = m.sources[0];
assert.equal(src.kind, "mcp");
assert.equal(path.resolve(src.cwd.replace(/^~/, os.homedir())), repo, "the server starts where its .mcp.json is");
const detect = m.settings.find((s) => s.key === "OWL_URL").detect;
assert.equal(execFileSync(detect[0], detect.slice(1), { encoding: "utf8" }), "http://owl.example", "the setting reads the value from the config file");
const bench = JSON.parse(fs.readFileSync(path.join(r.dir, "bench", "questions.json"), "utf8")).questions;
assert.ok(bench.every((q) => q.reference && q.askedAt && !q.expect), "judged rows: a reference, no patterns");
assert.equal(findKit("owl"), null, "a draft is not a kit anyone routes to");
await assert.rejects(smith.scaffold("mcp: owl", { since: "7d", chat }), /already has a draft/);

// prove: one run; the question it got wrong rewrites the instructions once, and nothing is re-run.
let runs = 0;
const test = async (name, o) => {
  runs++;
  assert.ok(findKit(name), "prove sees the draft");
  assert.equal(o.only, undefined);
  const results = bench.map((q, i) => ({ backend: "x", id: q.id, pass: i !== 0, verdict: i === 0 ? "wrong" : "correct", reason: "named the wrong letter", answer: "L-3" }));
  return { summary: [{ backend: "x", passed: 1, of: 2 }], results };
};
const tunes = asked.length;
const p = await smith.prove("owl", { test, chat });
assert.equal(runs, 1, "one measurement");
assert.equal(asked.length, tunes + 1, "one rewrite");
assert.equal(p.passed, 1);
assert.deepEqual(p.failed, [bench[0].id]);
assert.equal(p.tuned, "get_post first");
assert.match(fs.readFileSync(path.join(r.dir, "instructions.md"), "utf8"), /get_post with the letter id first/);
assert.equal(JSON.parse(fs.readFileSync(path.join(r.dir, "smith.json"), "utf8")).proved.changed, "get_post first");

// A question judged "changed" is reported, not tuned for.
const stale = await smith.prove("owl", { test: async () => ({ summary: [], results: [{ backend: "x", id: bench[1].id, pass: false, verdict: "changed", answer: "" }] }), chat });
assert.deepEqual(stale.changed, [bench[1].id]);
assert.deepEqual(stale.failed, []);
assert.equal(stale.tuned, null);
assert.equal(asked.length, tunes + 1, "no rewrite when nothing failed");

delete process.env.ASK_KIT_DRAFTS;
const ins = smith.install("owl");
assert.equal(ins.dir, path.join(tmp, "config", "kits", "owl"));
assert.ok(findKit("owl"), "installed kits are found");
assert.equal(JSON.parse(fs.readFileSync(path.join(tmp, "config", "config.json"), "utf8")).domains.owl.enabled, true);

// promote: a cluster from report's "Worth an action" becomes an [[actions]] entry.
const { parse: parseToml } = await import("smol-toml");
const { compileActions } = await import("../src/actions.mjs");
const cluster = { kit: "owl", template: "which letters are waiting for <text> at the N office", script: "waiting", n: 4, sessions: 3, costUsd: 0.02, questions: ["Which letters are waiting for Adora Belle at the Ankh office?", "which letters are waiting for Moist at the Ankh office"], params: ['{"to":"Adora Belle","office":"Ankh"}', '{"to":"Moist","office":"Ankh"}'] };
const a = smith.actionFrom(cluster);
assert.equal(a.action.script, "waiting");
assert.deepEqual(a.action.params, { office: "Ankh" }, "a value every question shares is a default");
const [compiled] = compileActions({ actions: [a.action] });
const hit = "Which letters are waiting for Sam Vimes at the Ankh office?".match(compiled.match[0]);
assert.equal(hit?.groups.to, "Sam Vimes", "a value that varied is a named capture");
assert.equal(compiled.match[0].test("Which letters are waiting for Sam at the Ankh office and why?"), false, "a question with more in it goes to the model");
assert.match(smith.actionFrom({ ...cluster, params: ['{"to":"Rincewind"}'] }).skip, /could not be found/);
const parsed = parseToml(smith.actionsToml([a]));
assert.deepEqual(JSON.parse(JSON.stringify(parsed.actions[0])), a.action, "the manifest text parses back to the entry");
const promoted = await smith.promote("owl", { clusters: [cluster, { ...cluster, script: "get-post", template: "x", questions: ["what is in letter L-9"], params: ['{"id":"L-9"}'] }] });
assert.equal(promoted.entries.length, 2);
assert.match(promoted.toml, /# Promoted by ask-kit smith from 4 questions in 3 sessions/);

fs.rmSync(tmp, { recursive: true, force: true });
console.log("smith: ok");
