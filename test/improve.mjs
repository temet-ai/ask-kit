// Real-use, per-kit reports and resumable review records. Synthetic journals, no model.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ask-improve-"));
process.env.ASK_KIT_CONFIG = path.join(tmp, "config");
process.env.ASK_KIT_STATE = path.join(tmp, "state");
for (const v of ["CLAUDE_CONFIG_DIR", "CODEX_HOME", "COPILOT_HOME", "GEMINI_CLI_HOME"]) process.env[v] = path.join(tmp, "none");
process.env.OPENCODE_DB = path.join(tmp, "none.db");
const { STATE_ROOT, CONFIG_DIR, ROOT } = await import("../src/config.mjs");
const { report } = await import("../src/report.mjs");
const { improvementBrief, improvementQueue, recordImprovement, improvementHistory } = await import("../src/improve.mjs");
const now = Date.now() - 60_000;
const at = (n) => new Date(now + n * 1000).toISOString();
const write = (kit, name, rows) => {
  const file = path.join(STATE_ROOT, kit, `${name}.jsonl`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  return file;
};
for (const name of ["watch", "guild"]) {
  const dir = path.join(CONFIG_DIR, "kits", name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "ask-kit.toml"), `name = "${name}"\nsays = "the roster"\n[[sources]]\nkind = "folder"\nname = "files"\npath = "."\n`);
}
const ask = { type: "ask", session: "vimes", backend: "fake", question: "who is on duty?", ms: 2000, ok: true, answerChars: 50 };
const file = write("watch", "vimes", [{ ...ask, ts: at(5), askId: "actual" }, { ...ask, ts: at(10), session: "bench-watch", askId: "synthetic", ok: false, error: "bench failure" }]);
write("guild", "vimes", [{ ...ask, ts: at(6), ok: false, error: "guild failure" }]);
write("watch", "ask-actual", [{ ts: at(4), session: "ask-actual", code: 'scripts.run("badge")', scripts: [{ name: "badge", ok: true, review: { status: "needs_review", warnings: ["badge is the wrong size"] } }] }]);
write("watch", "ask-synthetic", [{ ts: at(9), session: "ask-synthetic", code: 'scripts.run("benchmark")', scripts: [{ name: "benchmark", ok: false }] }]);
write("watch", "malformed", [null, 1, [], { ts: at(4), code: 17 }, { ts: "invalid", type: "ask", session: "vimes", ok: false }]);
write("watch", "bench-cell", [{ ts: at(4), session: "ask-unknown", caller: "kittest-watch", code: 'scripts.run("bench-cell")', scripts: [{ name: "bench-cell", ok: false }] }]);
const outcomeFile = write("watch", "outcomes", [
  { type: "outcome", ts: at(7), session: "vimes", jobId: "badge-1", ok: true, review: { status: "unverified" } },
  { type: "outcome", ts: at(8), session: "vimes", jobId: "badge-2", ok: true, review: { status: "pass" } },
  { type: "outcome", ts: at(9), session: "bench-watch", jobId: "badge-3", ok: true, review: { status: "needs_review" } },
]);
const routerFile = write("router", "vimes", [{ at: at(5), domain: "watch", how: "pattern" }, { at: at(6), domain: "guild", how: "pattern" }, { at: at(7), type: "misroute", routed: "guild", correct: "watch", how: "pattern" }]);
write("actions", "watch", [{ type: "run", id: "run-1", at: at(3), session: "vimes", action: "duty" }, { type: "run", id: "run-2", at: at(4), session: "bench-watch", action: "duty" }]);
write("actions", "guild", [{ type: "run", at: at(3), session: "vimes", action: "roster" }]);
const r = report({ kit: "watch", real: true, since: "1h" });
assert.equal(r.asks, 1);
assert.deepEqual(r.flaggedAsks[0].signals, ["review needs_review"], "another kit's next ask is not a re-ask");
assert.deepEqual(r.scripts.map((s) => s.name), ["watch/badge"], "old benchmark cells are linked by askId and excluded");
assert.equal(r.outcomes, 2);
assert.equal(r.flaggedOutcomes.length, 1);
assert.equal(r.flaggedOutcomes[0].jobId, "badge-1");
assert.equal(r.reviewFindings.length, 1);
assert.equal(r.routed, 1);
assert.equal(r.misroutes.length, 1);
assert.deepEqual(r.actions.map((a) => [a.kit, a.runs]), [["watch", 1]]);
assert.equal(report({ since: "1h" }).asks, 3, "legacy report includes synthetic asks unless --real is given");
assert.equal(report({ kit: "watch", real: true, since: "1h", until: at(6) }).outcomes, 0);
assert.throws(() => report({ kit: "../watch" }), /name/);
const cli = JSON.parse(execFileSync(process.execPath, [path.join(ROOT, "bin", "ask-kit.mjs"), "report", "--kit", "watch", "--real", "--since", "1h", "--json"], { encoding: "utf8", env: process.env }));
assert.equal(cli.asks, 1);
assert.equal(cli.outcomes, 2);
const brief = await improvementBrief("watch", { since: "1h", through: at(11) });
assert.equal(brief.state, "pending");
assert.equal(brief.source, fs.realpathSync(path.join(CONFIG_DIR, "kits", "watch")));
const record = { since: brief.since, through: brief.through, outcome: "blocked", summary: "Need the source of the badge dimensions.", evidence: [{ journal: outcomeFile, ts: at(7) }], changes: [], checks: [] };
await recordImprovement("watch", { ...record, evidence: [{ journal: routerFile, ts: at(7) }] });
assert.equal((await improvementBrief("watch")).asks, 1, "blocked reviews do not advance the cutoff");
assert.equal((await improvementBrief("watch")).since, brief.since, "blocked evidence does not age out of a rolling default window");
await assert.rejects(recordImprovement("watch", { ...record, evidence: [{ journal: file, ts: at(1) }] }), /no journal/);
await assert.rejects(recordImprovement("watch", { ...record, evidence: [{ journal: routerFile, ts: at(6) }] }), /no journal/, "another kit's route cannot close this review");
await assert.rejects(recordImprovement("watch", { ...record, evidence: [{ journal: path.join(STATE_ROOT, "guild", "vimes.jsonl"), ts: at(6) }] }), /this kit/);
await assert.rejects(recordImprovement("watch", { ...record, evidence: [] }), /evidence/);
await assert.rejects(recordImprovement("watch", { ...record, outcome: "changed" }), /changed paths/);
await assert.rejects(recordImprovement("watch", { ...record, through: new Date(Date.now() + 100000).toISOString() }), /past cutoff/);
const changed = { ...record, outcome: "changed", summary: "Check the badge dimensions before delivery.", changes: ["badge.mjs"], checks: [{ command: "node test/badge.mjs", ok: true, result: "dimension mismatch fixture passed" }], commit: "a1b2c3d" };
const saved = await recordImprovement("watch", changed);
assert.equal(saved.outcome, "changed");
assert.equal(improvementHistory("watch").length, 2);
assert.equal((await improvementBrief("watch")).state, "no-new-evidence");
assert.equal((await improvementBrief("guild")).asks, 1, "a review advances only its kit");
await assert.rejects(recordImprovement("watch", changed), /already covered/);
write("watch", "new", [{ ...ask, ts: at(12), session: "carrot", question: "what is the badge size?" }]);
const next = await improvementBrief("watch");
assert.equal(next.state, "pending");
assert.equal(next.asks, 1);
assert.equal(next.report.outcomes, 0);
assert.equal(next.since, new Date(Date.parse(at(11)) + 1).toISOString());
await assert.rejects(recordImprovement("watch", { ...changed, since: at(13), through: at(14), outcome: "no-change", evidence: [] }), /skips unreviewed evidence/, "an override cannot silently skip new evidence");
assert.ok((await improvementQueue()).kits.some((k) => k.kit === "watch" && k.asks === 1));
assert.equal(report({ since: "1h" }).asks, 4, "completion records are not journal asks");
assert.equal(fs.statSync(path.join(STATE_ROOT, "improvements", "watch.jsonl")).mode & 0o777, 0o600);
// Old CLI rows have neither caller nor askId. Infer only a unique ask window, never count
// unmatched warm-up cells or an overlap as real use.
write("clock", "asks", [
  { ...ask, ts: at(20), session: "kittest-clock" },
  { ...ask, ts: at(25), session: "vimes" },
  { ...ask, ts: at(40), session: "vimes" },
  { ...ask, ts: at(41), session: "kittest-clock" },
]);
const cellAt = (n, name) => ({ ts: at(n), session: `old-${name}`, code: 'scripts.run("read")', scripts: [{ name, ok: true }] });
write("clock", "old-cells", [cellAt(19, "benchmark"), cellAt(24, "real"), cellAt(30, "orphan"), cellAt(39, "ambiguous")]);
// Chains agents dug by hand reach the review of the kit they belong to, and count as its evidence.
const chain = { source: "codex", session: "colon", purpose: "to-answer", end: "turn-end", kit: "watch", area: "watch", fam: "file", n: 4, tokens: 9000, prompt: "which officer was on the Ankh bridge last night?" };
const scanned = { chains: [
  { ...chain, id: "c1", ts: at(21), says: ["Read the duty roster"] },
  { ...chain, id: "c2", ts: at(22), afterAsk: "ask1", prompt: "go" },
  { ...chain, id: "c3", ts: at(22), kit: "guild" },
  { ...chain, id: "c4", ts: at(22), purpose: "to-do" },
  { ...chain, id: "c5", ts: at(22), end: "ask" },
  { ...chain, id: "c6", ts: new Date(Date.now() - 40 * 86400_000).toISOString() },
] };
const dug = await improvementBrief("watch", { scanned, through: at(30), answers: false });
assert.deepEqual(dug.chains.shown.map((c) => c.chain), ["c2", "c1"], "this kit's to-answer chains with no question yet, those after an ask first");
assert.deepEqual([dug.chains.byHand, dug.chains.afterAsk, dug.chains.tokens], [2, 1, 18000]);
assert.deepEqual(dug.chains.shown[1].says, ["Read the duty roster"]);
write("quiet", "none", []);
const quiet = { chains: [{ ...chain, id: "q1", ts: at(21), kit: "quiet" }] };
assert.equal((await improvementBrief("quiet", { scanned: quiet, answers: false })).state, "pending", "a kit nobody asked is reviewed for what was dug by hand");
assert.equal((await improvementQueue({ scanned })).kits.find((k) => k.kit === "watch").chains, 2);
const dugRecord = { since: dug.since, through: dug.through, outcome: "no-change", summary: "Both chains opened files to edit them.", changes: [], checks: [], questions: [{ chain: "c1", question: "who was on the Ankh bridge last night?", cause: "gap", answer: "Nobby Nobbs" }, { chain: "c2", question: "which shift follows?", cause: "before-edit" }] };
await assert.rejects(recordImprovement("watch", { ...dugRecord, evidence: [{ chain: "c3" }] }, { scanned }), /no chain c3/, "another kit's chain");
const dugSaved = await recordImprovement("watch", { ...dugRecord, evidence: [{ chain: "c1" }, { journal: path.join(STATE_ROOT, "watch", "new.jsonl"), ts: at(12) }] }, { scanned });
assert.deepEqual(dugSaved.evidence[0], { chain: "c1" });
// Every shown chain's question is stored with the review, and the next brief shows the kit's own.
assert.deepEqual(dugSaved.questions.map((q) => [q.chain, q.cause]), [["c1", "gap"], ["c2", "before-edit"]]);
const left = { chains: [...scanned.chains, ...Array.from({ length: 34 }, (_, i) => ({ ...chain, id: `m${i}`, ts: at(23), tokens: 100 + i }))] };
const many = await improvementBrief("watch", { scanned: left, answers: false });
assert.deepEqual([many.chains.byHand, many.chains.shown.length], [34, 30], "c1 and c2 have their question; a brief shows 30 and leaves the rest waiting");
const asksAgain = await improvementBrief("watch", { scanned: { chains: [], local: true }, answers: false });
assert.deepEqual(asksAgain.questions.map((q) => [q.question, q.dug]), [["who was on the Ankh bridge last night?", 1]]);
const { storedQuestions } = await import("../src/improve.mjs");
assert.equal(storedQuestions().get("c1").answer, "Nobby Nobbs");

// What else is known of a chain: the ask before it, the nudge during it, its outcome, and findings kept elsewhere.
const joined = { chains: [{ ...chain, session: "detritus", id: "j1", kit: "thieves", ts: at(6), until: at(8), afterAsk: "t1", askAt: at(4), askQuestion: "who robbed the Mint?" }, { ...chain, session: "detritus", id: "j2", kit: "thieves", ts: at(40) }] };
write("thieves", "detritus", [{ ...ask, ts: at(7), startedAt: at(4), session: "detritus", question: "who robbed the Mint?", ms: 3000 }]);
write("nudges", "nudges", [{ at: at(7), type: "nudge", session: "detritus", about: "thieves" }]);
const join = { provider: "city", run: async (kit, script, params) => (script === "chain-outcomes" ? { chains: [{ chain: "j1", turnOutcome: { reaction: "corrected", unmet: "the thief" }, next: "no, who was it?", session_verdict: { outcome: "partial" } }] } : { findings: [{ id: "lesson:7", text: "ask the Guild first" }, { id: "note:9", text: "the Mint has two doors" }] }) };
const thieves = await improvementBrief("thieves", { scanned: joined, join });
const [j1, j2] = thieves.chains.shown;
assert.deepEqual([j1.ask.kit, j1.ask.answeredBefore, j1.nudged.about, j1.turnOutcome.reaction, j1.sessionVerdict.outcome], ["thieves", false, "thieves", "corrected", "partial"]);
assert.ok(!j2.ask && !j2.nudged && !j2.turnOutcome);
assert.deepEqual([thieves.chains.askNotAnswered, thieves.chains.nudged, thieves.elsewhere.findings.length], [1, 1, 2]);
await recordImprovement("thieves", { since: thieves.since, through: thieves.through, outcome: "no-change", summary: "x", evidence: [{ finding: "lesson:7" }, { chain: "j1" }], changes: [], checks: [], questions: [{ chain: "j1", question: "who robbed the Mint?", cause: "fell-short" }, { chain: "j2", question: "x", cause: "before-edit" }] }, { scanned: joined });
const again = await improvementBrief("thieves", { scanned: joined, join });
assert.deepEqual([again.elsewhere.findings.map((f) => f.id), again.chains.byHand, again.questions[0].question], [["note:9"], 0, "who robbed the Mint?"]);
const broken = await improvementBrief("thieves", { scanned: { chains: [{ ...chain, id: "j3", kit: "thieves", ts: at(41) }] }, join: { provider: "city", run: async () => { throw new Error("mike is down"); } } });
assert.equal(broken.chains.outcomesMissing, "mike is down", "a review says when outcomes are missing");

// Labels: a model gives chains their questions; they count per question, and a review says which it answered.
const { labelKit, readLabels, promptFor } = await import("../src/label.mjs");
const labeller = path.join(tmp, "labeller.mjs");
fs.writeFileSync(labeller, `let t=""; process.stdin.on("data",(d)=>t+=d).on("end",()=>{ const n=(t.match(/^\\{"n":/gm)||[]).length; console.log("Here: " + JSON.stringify(Array.from({length:n},(_, i)=> i===2 ? {n:3,question:"x",cause:"nonsense"} : {n:i+1,question:i<2?"Where is the toll booth?":"own work",cause:i<2?"gap":"own-output",answer:null}))); });`);
const tolls = { chains: Array.from({ length: 5 }, (_, i) => ({ ...chain, session: `cohen${i}`, id: `l${i}`, kit: "tolls", ts: at(10 + i) })), local: true };
const lab = await labelKit("tolls", { scanned: tolls, command: [process.execPath, labeller], join: { provider: null } });
assert.deepEqual([lab.waiting, lab.labelled, lab.byCause, lab.errors], [5, 4, { gap: 2, "own-output": 2 }, []], "a row with no known cause stays unlabelled");
write("tolls", "none", []);
const tollBrief = await improvementBrief("tolls", { scanned: tolls, answers: false });
assert.deepEqual([tollBrief.chains.byHand, tollBrief.questions.map((q) => [q.question, q.dug, q.sessions]), tollBrief.previous], [1, [["Where is the toll booth?", 2, 2]], null]);
const tollRecord = { since: tollBrief.since, through: tollBrief.through, outcome: "changed", summary: "Add the booths script.", addresses: ["Where is the toll booth?"], evidence: [{ chain: "l2" }], questions: [{ chain: "l2", question: "own work", cause: "own-output" }], changes: ["booths.mjs"], checks: [{ command: "node test", ok: true, result: "ok" }], commit: "abcdef1" };
await recordImprovement("tolls", tollRecord, { scanned: tolls });
assert.equal((await improvementBrief("tolls", { scanned: { chains: [], local: true }, answers: false })).state, "no-new-evidence", "answered, and not dug for since");
const { appendLabels, openQuestions } = await import("../src/improve.mjs");
appendLabels("tolls", [{ chain: "l9", ts: new Date(Date.now() + 1000).toISOString(), session: "rincewind", question: "where is the toll booth", cause: "not-reached" }], "test");
assert.deepEqual(openQuestions("tolls").map((q) => [q.dugSince, q.addressed.commit]), [[1, "abcdef1"]], "dug for again after its fix");
assert.deepEqual(readLabels('[{"n":1,"question":"which clacks is down?","cause":"not-this-kit","kit":"clacks"},{"n":2,"question":"unclear","cause":"not-this-kit","kit":"clacks"}]', [chain, { ...chain, id: "z" }].map((c, i) => ({ ...c, id: `z${i}`, ts: at(1) })), { clacks: "towers" }).map((l) => [l.cause, l.to ?? null]), [["not-reached", "clacks"], ["not-this-kit", null]], "a question another kit answers is that kit's");
assert.throws(() => readLabels("sorry", []), /no list/);
assert.match(promptFor("tolls", [{ ...chain, says: ["Read the rota"] }], ["Where is the toll booth?"]), /Known questions:\n- Where is the toll booth\?/);

// Another machine's journals, chains and reviews, copied over a fake ssh that runs the script here.
const far = path.join(tmp, "far");
const farFile = (p, rows) => { fs.mkdirSync(path.dirname(path.join(far, p)), { recursive: true }); fs.writeFileSync(path.join(far, p), rows.map((r) => JSON.stringify(r)).join("\n") + "\n"); };
farFile("lipwig/carrot.jsonl", [{ ...ask, ts: at(5), session: "carrot", question: "is the mail coach late?", ok: false, error: "no horses" }]);
farFile("nudges/nudges.jsonl", [{ at: at(5) }]);
farFile("improvements/lipwig.jsonl", [{ at: at(2), kit: "lipwig", since: at(0), through: at(2), outcome: "no-change", summary: "x", evidence: [] }]);
const fakeSsh = path.join(tmp, "ssh");
fs.writeFileSync(fakeSsh, `#!/bin/sh\nfor host; do last=$host; done\ncase "$*" in *pseudopolis*) echo "ssh: no route" >&2; exit 255;; esac\nASK_KIT_STATE='${far}' sh -c "$last"\n`, { mode: 0o755 });
const farCli = path.join(tmp, "far-ask-kit");
fs.writeFileSync(farCli, `#!/bin/sh\necho '${JSON.stringify({ asks: [{ id: "fa1", ts: at(6), prompt: "x", after: 0, tokens: 1 }], chains: [{ ...chain, id: "f1", ts: at(6), kit: "lipwig", found: "the coach left at nine" }] })}'\n`, { mode: 0o755 });
process.env.ASK_KIT_SSH = fakeSsh;
const { syncMachines, machinesOf } = await import("../src/machines.mjs");
const synced = await syncMachines({ config: { machines: [{ host: "ankh", command: farCli }, "pseudopolis"] } });
assert.deepEqual(synced.map((m) => [m.host, m.ok]), [["ankh", true], ["pseudopolis", false]], JSON.stringify(synced));
assert.match(synced[1].journals, /no route/);
assert.equal(synced[0].chains, 1);
assert.ok(fs.existsSync(path.join(STATE_ROOT, "machines", "ankh", "nudges", "nudges.jsonl")), "nudges come too");
const { scanAll, report: gapsReport } = await import("../src/gaps.mjs");
const everywhere = await scanAll({ since: "1d" });
assert.deepEqual([everywhere.chains.map((c) => c.id), everywhere.asks.length, everywhere.machines[0].host], [["f1"], 1, "ankh"]);
assert.throws(() => machinesOf({ machines: ["-oProxyCommand=x"] }), /not an ssh host/);
const lipwig = await improvementBrief("lipwig", { scanned: { chains: [] }, answers: false });
assert.equal(lipwig.since, new Date(Date.parse(at(2)) + 1).toISOString(), "a review recorded on another machine counts");
assert.deepEqual([lipwig.asks, lipwig.report.flaggedAsks[0].machine, lipwig.chains.shown[0].machine, lipwig.chains.shown[0].found], [1, "ankh", "ankh", "the coach left at nine"]);
const farRecord = { since: lipwig.since, through: lipwig.through, outcome: "no-change", summary: "x", evidence: [{ journal: path.join(STATE_ROOT, "machines", "ankh", "lipwig", "carrot.jsonl"), ts: at(5) }, { chain: "f1" }], changes: [], checks: [], questions: [] };
await assert.rejects(recordImprovement("lipwig", farRecord, { scanned: { chains: [] } }), /missing: f1/);
await recordImprovement("lipwig", { ...farRecord, questions: [{ chain: "f1", question: "when did the coach leave?", cause: "not-this-kit" }] }, { scanned: { chains: [] } });
const after = await scanAll({ since: "1d" });
assert.deepEqual([after.chains[0].prompt, gapsReport(after).coverage.byHand, gapsReport(after).reviewed.notAQuestion], ["when did the coach leave?", 0, 1], "gaps uses the stored question and its cause");
// Asks sent side by side are not re-asks; slow alone does not put a kit up the queue.
write("side", "asks", [
  { ...ask, ts: at(50), startedAt: at(20), ms: 30_000 },
  { ...ask, ts: at(52), startedAt: at(21), ms: 100_000 },
  { ...ask, ts: at(57), startedAt: at(55), ms: 2000 },
]);
const side = await improvementBrief("side", { scanned: { chains: [] }, answers: false });
assert.deepEqual(side.report.flaggedAsks.map((a) => a.signals), [["slow (100s)", "re-asked"]]);
assert.equal(side.wrong, 1);
const legacy = report({ kit: "clock", real: true, since: "1h" });
assert.deepEqual(legacy.scripts.map((s) => s.name), ["clock/real"]);
assert.equal(legacy.unattributedCells, 2);
assert.equal(legacy.unattributedExamples.length, 2);
fs.rmSync(tmp, { recursive: true, force: true });
console.log("ok");
