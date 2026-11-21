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
const cfg = { version: 1, sources: [], backends: { default: "fake", list: { fake: fake.backend } }, domains: { sessions: {}, watch: {}, guild: {} } };
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

await fake.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log("ok");
process.exit(0);
