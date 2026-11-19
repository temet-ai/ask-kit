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

await fake.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log("ok");
process.exit(0);
