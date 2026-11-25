// The router with no model and no network: past-work words before kit keywords in the fallback
// rules, a pattern that claims a question only without past-work words, kit hints rewritten to the
// domains enabled here, a router timeout that falls back to session history, and a misroute (the
// caller re-asking with another `about` within two minutes) journaled as a router-bench row and
// listed by the report.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fakeBackend } from "./fixtures/shot-kit/fake-backend.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ask-kit-router-"));
const config = path.join(tmp, "config");
const state = path.join(tmp, "state");
process.env.ASK_KIT_CONFIG = config;
process.env.ASK_KIT_STATE = state;

// Fixture kits: one module source each, answering about the Watch and the Guilds.
const kit = (name, extra) => {
  const dir = path.join(config, "kits", name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "ask-kit.toml"), `name = "${name}"\nsays = "the ${name} of Ankh-Morpork"\n${extra}\n[[sources]]\nkind = "module"\nname = "${name.replace(/-/g, "_")}"\nmodule = "m.mjs"\n`);
  fs.writeFileSync(path.join(dir, "m.mjs"), "export const make = () => ({ roster: () => ['Sam Vimes'] });\n");
};
kit("watch", `keywords = ["watch house", "duty"]\npatterns = ['\\bcase-[0-9a-f]{8}\\b']\nroute_hint = "a case file is watch; a service managed by systemd is ops; what a past session said about a case is sessions; mike's captured sessions in general are mike"`);
kit("guild", `keywords = ["guild", "ledger"]`);
const fake = await fakeBackend([() => ({ answer: "Answered from the fixture." })]);
// No router model (keyword rules) unless a test sets one.
const cfg = { version: 1, sources: [], backends: { default: "fake", list: { fake: fake.backend } }, domains: { sessions: {}, watch: {}, guild: {} }, router: false };
fs.writeFileSync(path.join(config, "config.json"), JSON.stringify(cfg));

const { makeRouter, rewriteHint } = await import("../src/router.mjs");

// Kit hints: names not enabled here are rewritten (mike means past work) or dropped.
assert.equal(rewriteHint("logs are docker; a service managed by systemd is ops; the compose file is code", ["docker", "code"], "sessions"), "logs are docker; the compose file is code");
assert.equal(rewriteHint("general sessions are mike", ["sessions"], "sessions"), "general sessions are sessions");
assert.equal(rewriteHint("config is dotfiles or code", ["code"], null), "config is code");
assert.equal(rewriteHint("a service is ops", ["code"], null), null);

const r = await makeRouter(cfg);
assert.deepEqual(r.enabled, ["sessions", "watch", "guild"]);
assert.ok(!r.hints.join("\n").match(/\b(is|are) (ops|mike)\b/), `no hint names a domain that is not here: ${r.hints}`);
assert.match(r.hints.join("\n"), /mike's captured sessions in general are sessions/);

// Past-work words come before kit keywords; kit keywords still decide a question without them.
assert.equal(r.byRules("which session looked at the guild ledger yesterday?"), "sessions");
assert.equal(r.byRules("who keeps the guild ledger?"), "guild");
assert.equal(r.byRules("who is on duty at the watch house?"), "watch");
// A question with words of two kits goes to the kit more of whose keywords it holds, whichever
// comes first in the config.
assert.equal(r.byRules("who is on duty when the guild meets at the watch house?"), "watch");
assert.equal(r.byRules("is the guild ledger kept at the watch house?"), "guild");

// A pattern claims a question outright only without past-work words; otherwise it is a hint to the model.
assert.equal(r.byPattern("open case-ab12cd34"), "watch");
assert.equal(r.byPattern("what did session 41e1 say about case-ab12cd34?"), null);
assert.match(r.systemPrompt("what did session 41e1 say about case-ab12cd34?"), /matches watch's pattern\): choose watch unless it asks what a past session did/);
assert.doesNotMatch(r.systemPrompt("who keeps the guild ledger?"), /matches .*'s pattern/);

// A router model that does not answer in time: session history, not the keyword rules.
const slow = await fakeBackend([{ delayMs: 1500, answer: "guild" }]);
const timed = await makeRouter({ ...cfg, backends: { default: "fake", list: { fake: fake.backend, slow: slow.backend } }, router: { backend: "slow", timeoutMs: 200 } });
const err = await timed.byModel("who keeps the guild ledger?").catch((e) => e);
assert.equal(err.timeout, true, String(err));
assert.equal(timed.fallback("who keeps the guild ledger?", err), "sessions");
assert.equal(timed.fallback("who keeps the guild ledger?", new Error("router model said \"x\"")), "guild", "other failures use the rules");
await slow.close();

// `router.body` adds fields to the routing call (OpenRouter gets reasoning off by default).
const word = await fakeBackend([{ answer: "guild" }]);
const withBody = await makeRouter({ ...cfg, backends: { default: "fake", list: { fake: fake.backend, word: word.backend } }, router: { backend: "word", body: { reasoning: { enabled: false } } } });
assert.equal(await withBody.byModel("who keeps the guild ledger?"), "guild");
assert.deepEqual(word.requests[0].reasoning, { enabled: false });
assert.equal(word.requests[0].max_tokens, 200, "body does not override the call's own fields");
await word.close();

// An agent CLI routes for a machine with no API key: claude, codex and copilot, each a fake bin
// that keeps its arguments and prints what the real one prints. No router set: the default routes.
for (const [kind, print] of [
  ["claude-cli", `JSON.stringify({ type: "result", is_error: false, result: "guild" })`],
  ["codex-cli", `[{ type: "thread.started", thread_id: "t" }, { type: "item.completed", item: { type: "agent_message", text: "guild" } }].map((e) => JSON.stringify(e)).join("\\n")`],
  ["copilot-cli", `JSON.stringify({ type: "assistant.message", data: { content: "Guild." } })`],
]) {
  const bin = path.join(tmp, `fake-${kind}`);
  const argsFile = `${bin}.args`;
  fs.writeFileSync(bin, `#!${process.execPath}\nrequire("fs").writeFileSync(${JSON.stringify(argsFile)}, JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), session: process.env.ASK_KIT_SESSION ?? null }));\nconsole.log(${print});\n`, { mode: 0o755 });
  const cli = await makeRouter({ ...cfg, router: undefined, backends: { default: "sub", list: { sub: { kind, model: "small", bin } } } });
  assert.equal(await cli.byModel("who keeps the guild ledger?"), "guild", kind);
  const seen = JSON.parse(fs.readFileSync(argsFile, "utf8"));
  assert.equal(fs.realpathSync(seen.cwd), fs.realpathSync(os.tmpdir()), `${kind} runs from the temp folder`);
  assert.equal(seen.session, null, `${kind} does not get the caller's session`);
  assert.ok(seen.args.includes("small"), `${kind} gets the model`);
  assert.ok(seen.args.some((a) => a.includes("Reply with one word")), `${kind} gets the routing prompt`);
  if (kind === "claude-cli") for (const f of ["--tools", "--strict-mcp-config", "--setting-sources", "--no-session-persistence"]) assert.ok(seen.args.includes(f), `claude ${f}`);
  if (kind === "codex-cli") for (const f of ["--ignore-user-config", "--ephemeral", "read-only"]) assert.ok(seen.args.includes(f), `codex ${f}`);
}

// Through `ask-kit serve`: the router decides (rules: no router model), the caller corrects it with
// `about` within two minutes, and the misroute is journaled and becomes a router-bench row.
const env = { ...process.env, ASK_KIT_CONFIG: config, ASK_KIT_STATE: state, ASK_KIT_SESSION: "router-test" };
delete env.ASK_KIT_DOMAIN;
const client = new Client({ name: "test", version: "0" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, "bin", "ask-kit.mjs"), "serve"], env, stderr: "inherit" }));
const ask = async (args) => {
  const out = await client.callTool({ name: "ask", arguments: { early: false, ...args } });
  assert.ok(!out.isError, out.content.map((c) => c.text).join("\n"));
  return out;
};
await ask({ question: "who keeps the guild ledger?" });
await ask({ question: "who keeps the guild ledger? (the Watch's copy)", about: "watch" });
await ask({ question: "and the night shift?", about: "watch" });
await client.close();

const routerRows = fs.readFileSync(path.join(state, "router", "router-test.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
assert.deepEqual(routerRows.filter((x) => !x.type).map((x) => [x.domain, x.how]), [["guild", "rules"], ["watch", "caller"], ["watch", "caller"]]);
const mis = routerRows.filter((x) => x.type === "misroute");
assert.equal(mis.length, 1, "a correction of the caller's own `about` is not a misroute");
assert.equal(mis[0].question, "who keeps the guild ledger?");
assert.equal(mis[0].routed, "guild");
assert.equal(mis[0].correct, "watch");
assert.equal(mis[0].why, "re-asked");
const bench = fs.readFileSync(path.join(state, "router", "bench.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
assert.deepEqual(bench.map(({ question, routed, correct }) => ({ question, routed, correct })), [{ question: "who keeps the guild ledger?", routed: "guild", correct: "watch" }]);

// A correction after two minutes is a new question, not a misroute.
const lastFile = path.join(state, "router", "last-router-test.json");
fs.writeFileSync(lastFile, JSON.stringify({ domain: "guild", how: "rules", question: "an old one", at: new Date(Date.now() - 180_000).toISOString() }));
const client2 = new Client({ name: "test", version: "0" });
await client2.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, "bin", "ask-kit.mjs"), "serve"], env, stderr: "inherit" }));
await client2.callTool({ name: "ask", arguments: { question: "the night shift", about: "watch", early: false } });
await client2.close();
assert.equal(fs.readFileSync(path.join(state, "router", "bench.jsonl"), "utf8").trim().split("\n").length, 1);

// The report counts the routes the router decided and lists the misroute.
const { report } = await import("../src/report.mjs");
const rep = report({ since: "1h" });
assert.equal(rep.routed, 1);
assert.equal(rep.misroutes.length, 1);
assert.equal(rep.misroutes[0].correct, "watch");
assert.equal(rep.asksStuck, 0);
assert.equal(rep.asksUnreached, 0);
// Asks whose journal row has stuck or unreached are counted once each.
const jl = path.join(state, "watch", "stuck-test.jsonl");
fs.mkdirSync(path.dirname(jl), { recursive: true });
const mk = (extra) => JSON.stringify({ ts: new Date().toISOString(), session: "stuck-test", type: "ask", question: "q", ok: true, ms: 1, answerChars: 5, ...extra }) + "\n";
fs.appendFileSync(jl, mk({ stuck: 2 }) + mk({ unreached: 3 }) + mk({ stuck: 1, unreached: 2 }) + mk({}));
const rep2 = report({ since: "1h" });
assert.equal(rep2.asksStuck, 2);
assert.equal(rep2.asksUnreached, 2);
const cliOut = (await import("node:child_process")).execFileSync(process.execPath, [path.join(ROOT, "bin", "ask-kit.mjs"), "report", "--since", "1h"], { encoding: "utf8", env });
assert.match(cliOut, /Stuck or unreachable: 2 of \d+ asks were told to stop because their cells kept repeating, 2 had a cell that could not reach a source/);

// The report counts the asks that became background tasks, and how those tasks ended.
{
  const at = new Date().toISOString();
  const old = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const rows = [
    { at, task: "ask-000000000001", afterMs: 10_000 },
    { at, task: "ask-000000000002", afterMs: 14_000 },
    { at, task: "ask-000000000003", afterMs: 12_000, continues: "ask-000000000001" },
    { at, task: "ask-000000000001", done: "answered", ms: 40_000 },
    { at, task: "ask-000000000002", done: "failed", ms: 20_000 },
    { at, task: "ask-000000000003", done: "stopped", ms: 15_000 },
    { at: old, task: "ask-000000000009", afterMs: 99_000 },
  ];
  fs.writeFileSync(path.join(state, "router", "planted.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  const t = report({ since: "1h" });
  assert.equal(t.tasks, 3, "three asks became tasks in the window; the old one is left out");
  assert.equal(t.taskMedianHandoffSeconds, 12);
  assert.deepEqual([t.tasksAnswered, t.tasksFailed, t.tasksCancelled, t.tasksStopped], [1, 1, 0, 1]);
  assert.equal(t.routed, 1, "task rows do not count as routes");
  fs.rmSync(path.join(state, "router", "planted.jsonl"));
}

// ---- capabilities: [[provides]] ranked before routing ----
// recall is mike-like: Claude Code history on every machine, priority 100; the built-in sessions
// reader provides the same for five agents at priority 10.
const provides = (prio, covers = '["claude-code"]') => `[[provides]]\ncapability = "session-history"\ncovers = ${covers}\nreach = "all-machines"\npriority = ${prio}`;
kit("recall", `${provides(100)}`);
kit("shadow", `${provides(50)}`);
kit("twin", `${provides(100)}`);
kit("bad-provides", `[[provides]]\ncapability = "Session History"\ncovers = "claude-code"\npriority = "high"`);
const { loadDomain } = await import("../src/domains.mjs");
await assert.rejects(loadDomain("bad-provides"), /provides\[0\]\.capability[\s\S]*provides\[0\]\.covers[\s\S]*provides\[0\]\.priority/);
const capCfg = (domains) => ({ ...cfg, domains });

const c1 = await makeRouter(capCfg({ sessions: {}, recall: {}, guild: {} }));
assert.equal(c1.pastWork, "recall", "past work goes to the session-history winner");
assert.deepEqual(c1.enabled, ["sessions", "recall", "guild"], "sessions still wins Codex, Copilot CLI, opencode and Gemini CLI");
assert.equal(c1.resolve("sessions", "what did we decide about the ledger yesterday?"), "recall", "no agent named: the higher priority");
assert.equal(c1.resolve("sessions", "what did the claude code session decide yesterday?"), "recall");
assert.equal(c1.resolve("recall", "which codex session changed the ledger?"), "sessions", "recall does not cover codex");
assert.equal(c1.resolve("guild", "which codex session changed the ledger?"), "guild", "a domain that provides nothing is left alone");
assert.equal(c1.byRules("which codex session changed the ledger?"), "recall", "the rules pick the past-work winner; resolve then scopes it");
assert.deepEqual(c1.capLines, ["session-history: recall; for codex, copilot-cli, opencode, gemini-cli: sessions"]);
assert.match(c1.systemPrompt("who keeps the guild ledger?"), /session-history: recall; for codex, copilot-cli, opencode, gemini-cli: sessions/);
assert.equal(c1.systemPrompt("x").match(/session-history/g).length, 1, "the capability is listed once");
assert.deepEqual(c1.ties, []);

// A provider that wins no scope is hidden: not offered, kept as a fallback.
const c2 = await makeRouter(capCfg({ sessions: {}, recall: {}, shadow: {} }));
assert.ok(!c2.enabled.includes("shadow") && c2.hidden.includes("shadow"));
assert.match(c2.skipped.shadow, /every capability it provides goes to another: recall/);
assert.doesNotMatch(c2.systemPrompt("x"), /shadow/);
assert.deepEqual(c2.nextAfter("recall", "what did the claude code session decide?"), ["shadow", "sessions"]);
assert.deepEqual(c2.nextAfter("recall", "what did we decide?"), ["shadow", "sessions"]);

// A pin in the config wins over the manifest: sessions at 200 takes Claude Code too, so recall wins nothing.
const c3 = await makeRouter(capCfg({ sessions: { priority: 200 }, recall: {} }));
assert.equal(c3.resolve("recall", "what did we decide yesterday?"), "sessions");
assert.deepEqual(c3.hidden, ["recall"]);

// A tie: same capability, overlapping covers, same priority. The router keeps config order; doctor
// and kit install report it naming both.
const c4 = await makeRouter(capCfg({ sessions: {}, recall: {}, twin: {} }));
assert.equal(c4.ties.length, 1);
assert.deepEqual(c4.ties[0].domains, ["recall", "twin"]);
fs.writeFileSync(path.join(config, "config.json"), JSON.stringify(capCfg({ sessions: {}, recall: {}, twin: {} })));
const { spawnSync } = await import("node:child_process");
const doc = spawnSync(process.execPath, [path.join(ROOT, "bin", "ask-kit.mjs"), "doctor"], { env, encoding: "utf8" });
assert.equal(doc.status, 1, doc.stdout + doc.stderr);
assert.match(doc.stdout, /✗ tie: recall and twin both provide session-history for claude-code at priority 100/);
const twinSrc = path.join(tmp, "twin-src");
fs.cpSync(path.join(config, "kits", "twin"), twinSrc, { recursive: true });
fs.writeFileSync(path.join(config, "config.json"), JSON.stringify(capCfg({ sessions: {}, recall: {} })));
const { addDomain } = await import("../src/gallery.mjs");
assert.deepEqual((await addDomain(twinSrc)).ties, ["recall and twin both provide session-history for claude-code at priority 100: set domains.<one of them>.priority in ask-kit's config to choose"]);
await assert.rejects(addDomain(twinSrc, { yes: true }), /not installed: recall and twin both provide session-history/);
fs.writeFileSync(path.join(config, "config.json"), JSON.stringify(capCfg({ sessions: {}, recall: { priority: 90 } })));
assert.equal((await addDomain(twinSrc)).ties, undefined, "a pin settles it");

// Fallback, once: recall holds nothing for the question (its answer ends with [no data]), so
// sessions gets the same question; the caller sees sessions' answer, and the journal the fallback.
const fb = await fakeBackend([(body) => ({ answer: body.messages[0].content.includes("every machine") || body.messages[0].content.includes("the recall of") ? "No Claude Code session here mentions the ledger.\n[no data]" : "From the transcripts: Sam Vimes kept the ledger." })]);
fs.writeFileSync(path.join(config, "config.json"), JSON.stringify({ ...capCfg({ sessions: {}, recall: {} }), backends: { default: "fake", list: { fake: fb.backend } } }));
const fenv = { ...env, ASK_KIT_SESSION: "router-fallback" };
const client3 = new Client({ name: "test", version: "0" });
await client3.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, "bin", "ask-kit.mjs"), "serve"], env: fenv, stderr: "inherit" }));
const fout = await client3.callTool({ name: "ask", arguments: { question: "what did we decide about the ledger yesterday?", early: false } });
await client3.close();
const ftext = fout.content.map((c) => c.text).join("\n");
assert.match(ftext, /Sam Vimes kept the ledger/);
assert.doesNotMatch(ftext, /no data/i);
assert.equal(fb.requests.length, 2);
assert.match(fb.requests[0].messages.at(-1).content, /end the answer with the line \[no data\]/, "a provider is told how to say it has no data");
const frows = fs.readFileSync(path.join(state, "router", "router-fallback.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
assert.deepEqual(frows.map((x) => [x.type ?? "route", x.domain ?? null, x.how, x.from ?? x.routed ?? null]), [["route", "recall", "rules", null], ["misroute", null, "rules", "recall"], ["route", "sessions", "fallback", "recall"]]);
assert.equal(frows[1].correct, "sessions");
assert.equal(frows[1].why, "no data");
const recallAsk = fs.readFileSync(path.join(state, "recall", "router-fallback.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).find((x) => x.type === "ask");
assert.equal(recallAsk.noData, true);
await fb.close();

// A follow-up by task id, sent while its ask is still with the provider that will fall back: it
// waits for the fallback too, then goes to the investigator that answered, with the conversation.
{
  const isRecall = (body) => body.messages[0].content.includes("every machine") || body.messages[0].content.includes("the recall of");
  const fb2 = await fakeBackend([
    (body) =>
      isRecall(body)
        ? { delayMs: 1200, answer: "No Claude Code session here mentions the ledger.\n[no data]" }
        : { answer: body.messages.at(-1).content.includes("Who checked it") ? "Carrot Ironfoundersson checked it." : "From the transcripts: Sam Vimes kept the ledger." },
  ]);
  fs.writeFileSync(path.join(config, "config.json"), JSON.stringify({ ...capCfg({ sessions: {}, recall: {} }), backends: { default: "fake", list: { fake: fb2.backend } }, taskAfterSeconds: 0.2 }));
  const { spawn } = await import("node:child_process");
  const proc = spawn(process.execPath, [path.join(ROOT, "bin", "ask-kit.mjs"), "serve"], { env: { ...env, ASK_KIT_SESSION: "router-fallback-queue" }, stdio: ["pipe", "pipe", "inherit"] });
  const waiting = new Map();
  let buf = "";
  let rid = 0;
  proc.stdout.on("data", (d) => {
    buf += d;
    for (let i; (i = buf.indexOf("\n")) >= 0; ) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      const m = JSON.parse(line);
      waiting.get(m.id)?.(m);
      waiting.delete(m.id);
    }
  });
  const meta = {
    "io.modelcontextprotocol/protocolVersion": "2026-07-28",
    "io.modelcontextprotocol/clientInfo": { name: "test", version: "0" },
    "io.modelcontextprotocol/clientCapabilities": { extensions: { "io.modelcontextprotocol/tasks": {} } },
  };
  const request = (method, params = {}) =>
    new Promise((resolve) => {
      waiting.set(++rid, resolve);
      proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: rid, method, params: { ...params, _meta: meta } }) + "\n");
    });
  const done = async (taskId) => {
    for (const end = Date.now() + 20_000; Date.now() < end; await new Promise((r) => setTimeout(r, 50))) {
      const r = (await request("tasks/get", { taskId })).result;
      if (r.status !== "working") return r.result.content.map((c) => c.text).join("\n");
    }
    assert.fail("the task did not end");
  };
  const first = (await request("tools/call", { name: "ask", arguments: { question: "what did we decide about the ledger yesterday?", early: false } })).result;
  assert.equal(first.resultType, "task");
  const second = (await request("tools/call", { name: "ask", arguments: { question: "Who checked it?", continue: first.taskId, early: false } })).result;
  assert.equal(second.resultType, "task", "the follow-up waits behind its ask");
  assert.match(await done(first.taskId), /Sam Vimes kept the ledger/);
  assert.match(await done(second.taskId), /Carrot Ironfoundersson checked it/);
  assert.equal(fb2.requests.length, 3, "recall, then sessions, then the follow-up");
  assert.ok(isRecall(fb2.requests[0]) && !isRecall(fb2.requests[1]), "the ask fell back from recall to sessions");
  assert.ok(!isRecall(fb2.requests[2]), "the follow-up went to sessions, which answered");
  assert.ok(fb2.requests[2].messages.some((m) => String(m.content).includes("Sam Vimes kept the ledger")), "with the conversation it follows");
  proc.kill();
  await fb2.close();
}

// A kit that names its service (`up`): while the service does not answer, the question goes straight
// to the next provider and no investigator is started for the kit; with no other provider the caller
// is told at once. While it answers, the kit gets the question.
{
  const http = await import("node:http");
  const svc = http.createServer((req, res) => res.end("{}"));
  await new Promise((r) => svc.listen(0, "127.0.0.1", r));
  const svcUrl = `http://127.0.0.1:${svc.address().port}/api/stats`;
  kit("recall", `up = "\${RECALL_URL}/api/stats"\n[[settings]]\nkey = "RECALL_URL"\ndefault = "${svcUrl.replace("/api/stats", "")}"\n${provides(100)}`);
  kit("ledger", `up = "${svcUrl}"`);
  const isRecall = (body) => body.messages[0].content.includes("the recall of");
  const fb3 = await fakeBackend([(body) => ({ answer: isRecall(body) ? "From recall: Sam Vimes kept the ledger." : "From the transcripts: Sam Vimes kept the ledger." })]);
  fs.writeFileSync(path.join(config, "config.json"), JSON.stringify({ ...capCfg({ sessions: {}, recall: {}, ledger: {} }), backends: { default: "fake", list: { fake: fb3.backend } } }));
  const ask = async (session, args) => {
    const c = new Client({ name: "test", version: "0" });
    await c.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, "bin", "ask-kit.mjs"), "serve"], env: { ...env, ASK_KIT_SESSION: session }, stderr: "inherit" }));
    const out = await c.callTool({ name: "ask", arguments: { early: false, ...args } });
    await c.close();
    return out;
  };
  const text = (o) => o.content.map((c) => c.text).join("\n");
  assert.equal(text(await ask("router-up", { question: "what did we decide about the ledger yesterday?" })), "From recall: Sam Vimes kept the ledger.", "the service answers: the kit gets the question");
  await new Promise((r) => svc.close(r));
  const t0 = Date.now();
  const down = await ask("router-down", { question: "what did we decide about the ledger yesterday?" });
  assert.equal(text(down), "From the transcripts: Sam Vimes kept the ledger.\n\n[recall's service is not answering, so this was answered by sessions]");
  assert.ok(Date.now() - t0 < 10_000);
  assert.equal(fb3.requests.filter(isRecall).length, 1, "no investigator was started for the kit while its service was down");
  const drows = fs.readFileSync(path.join(state, "router", "router-down.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(drows.filter((x) => x.how === "down").map((x) => [x.domain, x.from]), [["sessions", "recall"]]);
  const none = await ask("router-down-only", { question: "who signed the ledger?", about: "ledger" });
  assert.ok(none.isError);
  assert.match(text(none), /^ask failed: ledger's service is not answering \(http:\/\/127\.0\.0\.1:\d+\), and nothing else here covers this question\. Start it and ask again\.$/);
  await fb3.close();
}

// The tool's words with many kits: loaded upfront, its description and the server's instructions stay
// under the 4,096 characters Claude Code keeps, and the whole says of every kit is in the schema.
{
  const { describeAsk } = await import("../src/router.mjs");
  const says = {};
  for (let i = 1; i <= 60; i++) {
    const n = `precinct${String(i).padStart(2, "0")}`;
    says[n] = `what precinct ${i} of the Ankh-Morpork City Watch holds: ${`rosters, case files and the ledger Sergeant Colon keeps, page ${i}; `.repeat(10)}end of ${n}`;
    const dir = path.join(config, "kits", n);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "ask-kit.toml"), `name = "${n}"\nsays = "${says[n]}"\n[[provides]]\ncapability = "beat-${i % 20}"\ncovers = ["shift-${i}"]\npriority = ${i}\n[[sources]]\nkind = "module"\nname = "${n}"\nmodule = "m.mjs"\n`);
    fs.writeFileSync(path.join(dir, "m.mjs"), "export const make = () => ({ roster: () => ['Sam Vimes'] });\n");
  }
  const listed = async (extra) => {
    fs.writeFileSync(path.join(config, "config.json"), JSON.stringify({ ...cfg, domains: { sessions: {}, ...Object.fromEntries(Object.keys(says).map((n) => [n, {}])) }, ...extra }));
    const c = new Client({ name: "test", version: "0" });
    await c.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, "bin", "ask-kit.mjs"), "serve"], env, stderr: "inherit" }));
    const tool = (await c.listTools()).tools.find((t) => t.name === "ask");
    const instructions = c.getInstructions();
    await c.close();
    return { tool, instructions };
  };
  const { capLines: caps60, enabled: on, DOMAINS: D } = await makeRouter({ ...cfg, domains: { sessions: {}, ...Object.fromEntries(Object.keys(says).map((n) => [n, {}])) } });
  assert.equal(on.length, 61, "every kit is enabled");
  assert.equal(caps60.length, 20);
  const aliases = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`the-old-name-of-precinct-${i}`, "precinct01"]));
  for (const extra of [{}, { aliases }, { taskAfterSeconds: 0 }]) {
    const { tool, instructions } = await listed(extra);
    const about = tool.inputSchema.properties.about;
    assert.ok(tool.description.length < 4096, `description: ${tool.description.length}`);
    assert.ok(instructions.length < 4096, `instructions: ${instructions.length}`);
    for (const n of on) {
      assert.ok(about.description.split("\n").includes(`${n}: ${D[n].says}`), `${n}'s says is whole`);
      assert.ok(about.enum.includes(n) && tool.description.includes(n), `${n} is named`);
    }
    for (const [n, text] of Object.entries(says)) if (on.includes(n)) assert.equal(D[n].says, text, "the manifest's says, unshortened");
    for (const line of caps60) assert.ok(about.description.includes(line), "every capability line is whole");
    if (extra.aliases) for (const a of Object.keys(aliases)) assert.ok(`${tool.description}${about.description}`.includes(`"${a}" for precinct01`), `${a} is listed`);
    assert.equal(tool._meta["anthropic/alwaysLoad"], true);
    assert.equal(tool._meta["anthropic/maxResultSizeChars"], 500_000);
    for (const words of [/A cheap investigator does the digging/, /pass continue: true/, /only reads unless the ask may change things/, /shots\.<script> for a continue: true question\.$/]) assert.match(tool.description, words);
  }
  // More names than fit: they are in `about`, all of them, and the description says so.
  const names = Array.from({ length: 500 }, (_, i) => `precinct-house-${i}`);
  const told = describeAsk({ enabled: names, DOMAINS: Object.fromEntries(names.map((n) => [n, { says: `the beat of ${n}` }])), aliasLine: "", capLines: [], tasks: true });
  assert.ok(told.description.length < 4096);
  assert.match(told.description, /the `about` parameter names and describes/);
  for (const n of names) assert.ok(told.about.split("\n").includes(`${n}: the beat of ${n}`));
}

await fake.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log("ok");
process.exit(0);
