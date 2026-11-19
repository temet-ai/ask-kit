// [[actions]]: a question one of a kit's action patterns matches is answered by its script with no
// model call; params come from the pattern's named captures and the action's defaults; a mismatch,
// an error, empty output or output failing `expect` falls through to the model; an acting action
// stays off until the config says yes; too many bad runs turn an action off until `kit actions
// --enable`; a shadow run journals the model's answer beside the action's; `report` shows it all,
// with "Worth an action" built from journals.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fakeBackend } from "./fixtures/shot-kit/fake-backend.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ask-kit-actions-"));
const config = path.join(tmp, "config");
const state = path.join(tmp, "state");
process.env.ASK_KIT_CONFIG = config;
process.env.ASK_KIT_STATE = state;
fs.cpSync(path.join(ROOT, "test", "fixtures", "action-kit"), path.join(config, "kits", "watch"), { recursive: true });
// A second kit, so the router has a choice to make.
fs.mkdirSync(path.join(config, "kits", "clacks"), { recursive: true });
fs.writeFileSync(path.join(config, "kits", "clacks", "ask-kit.toml"), 'name = "clacks"\nsays = "the clacks towers and their messages"\n\n[[sources]]\nkind = "module"\nname = "clacks"\nmodule = "clacks.mjs"\n');
fs.writeFileSync(path.join(config, "kits", "clacks", "clacks.mjs"), "export const make = () => ({ towers: () => ['Tump'] });\n");

const fake = await fakeBackend([() => ({ answer: "From the model: Angua is on duty at Cable Street." })]);
const cfg = { version: 1, sources: [], backends: { default: "fake", list: { fake: fake.backend } }, domains: { watch: {}, clacks: {} }, actions: { shadowEvery: 0 } };
const writeConfig = () => fs.writeFileSync(path.join(config, "config.json"), JSON.stringify(cfg));
writeConfig();
const SESSION = "actions-test";
const env = { ...process.env, ASK_KIT_SESSION: SESSION };
delete env.ASK_KIT_DOMAIN;
const textOf = (r) => r.content.map((c) => c.text).join("\n");
const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const log = () => readJsonl(path.join(state, "actions", "watch.jsonl"));
const askRows = () => readJsonl(path.join(state, "watch", `${SESSION}.jsonl`)).filter((r) => r.type === "ask");
const cli = (...args) => execFileSync(process.execPath, [path.join(ROOT, "bin", "ask-kit.mjs"), ...args], { env, encoding: "utf8" });

const client = new Client({ name: "test", version: "0" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, "bin", "ask-kit.mjs"), "serve"], env, stderr: "inherit" }));
const ask = async (question, extra = {}) => client.callTool({ name: "ask", arguments: { question, ...extra } });

// 1. A match: the script answers, params from the capture, a provenance line, no model call at all
// (neither the router's nor the investigator's: the router has no model here, and the action claimed the route).
const duty = await ask("Who is on duty at Cable Street?");
assert.ok(!duty.isError, textOf(duty));
assert.match(textOf(duty), /"Angua"/);
assert.match(textOf(duty), /\[answered by watch's action duty: script duty \{"post":"Cable Street"\}, no model/);
assert.equal(fake.requests.length, 0, "an action calls no backend");
let runs = log().filter((r) => r.type === "run");
assert.equal(runs.length, 1);
assert.deepEqual(runs[0].params, { post: "Cable Street" });
assert.equal(runs[0].fellThrough, undefined);
assert.equal(typeof runs[0].ms, "number");
assert.equal(askRows().at(-1).action, "duty");
const routes = readJsonl(path.join(state, "router", `${SESSION}.jsonl`));
assert.equal(routes.at(-1).how, "action", "the action's pattern claimed the route");
assert.equal(routes.at(-1).domain, "watch");

// 2. No capture: the action's default params.
const here = await ask("who is on duty now");
assert.match(textOf(here), /"Sam Vimes"/);
assert.deepEqual(log().filter((r) => r.type === "run").at(-1).params, { post: "Pseudopolis Yard" });
assert.equal(fake.requests.length, 0);

// 3. A question the pattern does not cover as a whole goes to the model; no run is journaled. It
// came within two minutes of an action's answer and is no new question of that action: a re-ask.
const longer = await ask("who is on duty at Cable Street and why was Nobby moved", { about: "watch" });
assert.match(textOf(longer), /From the model/);
assert.equal(fake.requests.length, 1);
assert.equal(log().filter((r) => r.type === "run").length, 2, "a mismatch is not a run");
const reask = log().find((r) => r.type === "reask");
assert.equal(reask?.action, "duty-here", "asking again after an action's answer counts against that action");

// 4. Fall-through on an error, on empty output and on output failing `expect`; each journaled with why.
for (const [q, why] of [
  ["roster of Cable Street", "error"],
  ["who is asleep?", "empty"],
  ["is Nobby on duty at Cable Street", "expect"],
]) {
  const before = fake.requests.length;
  const r = await ask(q, { about: "watch" });
  assert.match(textOf(r), /From the model/, `${q}: the model answers`);
  assert.equal(fake.requests.length, before + 1, `${q}: one model call`);
  const run = log().filter((x) => x.type === "run").at(-1);
  assert.equal(run.fellThrough, why, q);
  assert.equal(askRows().at(-1).actionFellThrough.why, why, `${q}: the model's ask row says the action fell through`);
}
assert.match(log().filter((r) => r.type === "run" && r.fellThrough === "error")[0].error, /roster book for Cable Street is missing/);

// 5. An action that acts stays off until the config says yes; the CLI's --enable is that yes.
let before = fake.requests.length;
assert.match(textOf(await ask("dismiss Nobby", { about: "watch" })), /From the model/);
assert.equal(fake.requests.length, before + 1);
assert.ok(!log().some((r) => r.action === "dismiss"), "an acting action that is off does not run");
const listed = JSON.parse(cli("kit", "actions", "watch", "--json"));
assert.match(listed.find((a) => a.name === "dismiss").why, /changes things: on once you set domains\.watch\.actions\.dismiss = true/);
cli("kit", "actions", "watch", "--enable", "dismiss");
assert.equal(JSON.parse(fs.readFileSync(path.join(config, "config.json"), "utf8")).domains.watch.actions.dismiss, true);
before = fake.requests.length;
assert.match(textOf(await ask("dismiss Nobby", { about: "watch" })), /dismissed Nobby/);
assert.equal(fake.requests.length, before, "enabled, it runs with no model");

// 6. Demotion: the roster action's errors pass 3 of its last 20 runs, and it is turned off (in state,
// not the config); then the model answers its question without trying it. --enable starts it again.
for (const post of ["Treacle Mine", "Dolly Sisters", "Pseudopolis Yard"]) await ask(`roster of ${post}`, { about: "watch" });
const st = JSON.parse(fs.readFileSync(path.join(state, "actions", "watch.json"), "utf8"));
assert.equal(st.roster.off, true);
assert.match(st.roster.why, /4 of its last 4 runs went wrong \(4 fell through/);
assert.equal(JSON.parse(fs.readFileSync(path.join(config, "config.json"), "utf8")).domains.watch.actions.roster, undefined, "the config is not touched");
const rosterRuns = log().filter((r) => r.action === "roster").length;
before = fake.requests.length;
await ask("roster of Cable Street", { about: "watch" });
assert.equal(log().filter((r) => r.action === "roster").length, rosterRuns, "a demoted action is not tried");
assert.equal(fake.requests.length, before + 1);
const roster = JSON.parse(cli("kit", "actions", "watch", "--json")).find((a) => a.name === "roster");
assert.equal(roster.on, false);
assert.match(roster.why, /^turned off: 4 of its last 4 runs/);
assert.match(cli("kit", "actions", "watch"), /○ roster[\s\S]*turned off: 4 of/);
cli("kit", "actions", "watch", "--enable", "roster");
const again = JSON.parse(cli("kit", "actions", "watch", "--json")).find((a) => a.name === "roster");
assert.equal(again.on, true);
assert.equal(again.last20.runs, 0, "the window starts again");

// 7. A shadow run: with shadowEvery 1, the model answers the same question in the background, and
// both answers are journaled; the caller's follow-up pointer is left where it was.
const lastFile = path.join(state, "watch", "warm", `last-${SESSION}.json`);
const lastBefore = JSON.parse(fs.readFileSync(lastFile, "utf8")).fake;
cfg.actions.shadowEvery = 1;
cfg.domains = JSON.parse(fs.readFileSync(path.join(config, "config.json"), "utf8")).domains;
writeConfig();
before = fake.requests.length;
const shadowed = await ask("who is on duty at Cable Street");
assert.match(textOf(shadowed), /answered by watch's action duty/);
let shadow;
for (let i = 0; i < 100 && !shadow; i++) {
  await new Promise((r) => setTimeout(r, 50));
  shadow = log().find((r) => r.type === "shadow");
}
assert.ok(shadow, "the shadow run was journaled");
assert.equal(fake.requests.length, before + 1, "the shadow run asked the model once");
assert.match(shadow.actionAnswer, /"Angua"/);
assert.match(shadow.modelAnswer, /From the model: Angua/);
assert.equal(shadow.action, "duty");
assert.deepEqual(JSON.parse(fs.readFileSync(lastFile, "utf8")).fake.askId, lastBefore.askId, "the shadow run does not take the follow-up");
await client.close();

// 8. Re-asks alone turn an action off too (unit level: four answered runs, each asked again).
const acts = await import("../src/actions.mjs");
for (let i = 0; i < 4; i++) {
  const { id } = acts.logRun("clacks", { action: "towers", script: "towers", session: "s", params: {}, ms: 1 });
  acts.markReaskOf("clacks", id, "re-asked of watch");
}
assert.match(acts.readState("clacks").towers.why, /4 of its last 4 runs went wrong \(0 fell through.*4 asked again/);

// 9. The manifest is checked.
const kits = await import("../src/kits.mjs");
const bad = path.join(tmp, "bad-kit");
fs.mkdirSync(bad);
fs.writeFileSync(path.join(bad, "ask-kit.toml"), 'name = "bad"\nsays = "x"\n[[sources]]\nkind = "folder"\nname = "f"\npath = "."\n[[actions]]\nname = "A"\nscript = "s"\nmatch = ["(unclosed"]\n');
assert.throws(() => kits.readManifest(bad), (e) => /actions\[0\]\.name/.test(e.message) && /actions\[0\]\.match: \(unclosed is not a regular expression/.test(e.message));

// 10. report: actions, what was turned off, shadow runs, and "Worth an action" from journals. Three
// real asks in two sessions ran the duty script for the same question template; a kit-test session's
// asks are left out.
const wdir = path.join(state, "watch");
const at = (s) => new Date(Date.now() - s * 1000).toISOString();
const plant = (session, askId, q, ward, ago) => {
  fs.appendFileSync(path.join(wdir, `${session}.jsonl`), JSON.stringify({ ts: at(ago), session, type: "ask", question: q, backend: "fake", kind: "api", ok: true, ms: 4000, costUsd: 0.002, cells: 2, askId }) + "\n");
  fs.appendFileSync(path.join(wdir, `ask-${askId}.jsonl`), JSON.stringify({ ts: at(ago + 2), session: `ask-${askId}`, ok: true, ms: 5, code: `await scripts.run("duty", { ward: ${ward} })`, scripts: [{ name: "duty", ok: true, ms: 1, params: { ward } }] }) + "\n");
};
plant("carrot", "a1", "Who is on duty in ward 3?", 3, 600);
plant("carrot", "a2", "who is on duty in ward 5", 5, 500);
plant("angua", "a3", "Who is on duty in ward 9?", 9, 400);
for (let i = 0; i < 5; i++) plant("kittest-watch-1", `k${i}`, "who is on duty in ward 1?", 1, 300 - i);
const { report } = await import("../src/report.mjs");
const r = report({ since: "1d" });
const w = r.worthAnAction.find((x) => x.script === "duty");
assert.ok(w, JSON.stringify(r.worthAnAction));
assert.equal(w.kit, "watch");
assert.equal(w.template, "who is on duty in ward N");
assert.equal(w.n, 3, "the kit-test asks are left out");
assert.equal(w.sessions, 2);
assert.deepEqual(w.params.sort(), ['{"ward":3}', '{"ward":5}', '{"ward":9}']);
assert.ok(r.actionAnswers >= 4);
assert.ok(r.turnedOff.some((t) => t.kit === "clacks" && t.action === "towers"));
assert.ok(r.shadows.some((s) => s.action === "duty" && /From the model/.test(s.modelAnswer)));
const duties = r.actions.find((a) => a.kit === "watch" && a.action === "roster");
assert.equal(duties.fellThrough.error, 4);
assert.ok(r.flaggedAsks.some((a) => a.signals.some((s) => /action nobby fell through \(expect\)/.test(s))));
const printed = cli("report", "--since", "1d");
assert.match(printed, /Worth an action[\s\S]*3× in 2 session\(s\)  watch · duty[\s\S]*params seen: \{"ward":3\}/);
assert.match(printed, /Shadow runs[\s\S]*model \(fake/);
assert.match(printed, /clacks\.towers[\s\S]*turned off: 4 of/);

if (process.env.ACTIONS_SHOW) console.log(`--- ${textOf(duty)}\n--- report\n${printed}`);
await fake.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log("ok");
process.exit(0);
