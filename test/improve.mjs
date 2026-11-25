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
  { ...chain, id: "c6", ts: at(1) },
] };
const dug = await improvementBrief("watch", { scanned, through: at(30), answers: false });
assert.deepEqual(dug.chains.shown.map((c) => c.chain), ["c2", "c1"], "this kit's to-answer chains in the window, those after an ask first");
assert.deepEqual([dug.chains.byHand, dug.chains.afterAsk, dug.chains.tokens], [2, 1, 18000]);
assert.deepEqual(dug.chains.shown[1].says, ["Read the duty roster"]);
write("quiet", "none", []);
const quiet = { chains: [{ ...chain, id: "q1", ts: at(21), kit: "quiet" }] };
assert.equal((await improvementBrief("quiet", { scanned: quiet, answers: false })).state, "pending", "a kit nobody asked is reviewed for what was dug by hand");
assert.equal((await improvementQueue({ scanned })).kits.find((k) => k.kit === "watch").chains, 2);
const dugRecord = { since: dug.since, through: dug.through, outcome: "no-change", summary: "Both chains opened files to edit them.", changes: [], checks: [] };
await assert.rejects(recordImprovement("watch", { ...dugRecord, evidence: [{ chain: "c3" }] }, { scanned }), /no chain c3/, "another kit's chain");
const dugSaved = await recordImprovement("watch", { ...dugRecord, evidence: [{ chain: "c1" }, { journal: path.join(STATE_ROOT, "watch", "new.jsonl"), ts: at(12) }] }, { scanned });
assert.deepEqual(dugSaved.evidence[0], { chain: "c1" });
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
