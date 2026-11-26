// `ask-kit report` counts, per domain, what the host did besides the model's work: openers run
// before the first model call, reasoning sent back, quoted rows written in and answers sent back
// for unknown ids, lookups started ahead and how many were used, and citations resolved in another
// repository. A fixture journal; no model, no network.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ask-kit-report-domains-"));
const config = path.join(tmp, "config");
const state = path.join(tmp, "state");
fs.mkdirSync(config, { recursive: true });
process.env.ASK_KIT_CONFIG = config;
process.env.ASK_KIT_STATE = state;

const now = Date.now();
const at = (minutesAgo) => new Date(now - minutesAgo * 60_000).toISOString();
const write = (rel, rows) => {
  const file = path.join(state, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
};
const ask = (minutesAgo, extra) => ({ ts: at(minutesAgo), session: "vimes-1", type: "ask", question: "who signed the duty book at Pseudopolis Yard?", backend: "fake", kind: "api", ok: true, ms: 4000, answerChars: 80, ...extra });

write("watch/vimes-1.jsonl", [
  ask(50, { askId: "a1", opened: { action: "duty", script: "duty", params: {}, ms: 12 }, reasoningBack: 3, quotes: { inserted: 2 } }),
  ask(40, { askId: "a2", reasoningBack: 1, reasoningRefused: true, quotes: { inserted: 1, unknown: ["w7", "w9"] }, quotesSentBack: 2 }),
  ask(30, { askId: "a3" }),
]);
write("watch/ask-a1.jsonl", [
  { ts: at(50), session: "ask-a1", caller: "vimes-1", code: 'scripts.run("duty", {})', scripts: [{ name: "duty", ok: true, ms: 5 }], speculated: [{ script: "roster", params: {}, used: true, ms: 9 }, { script: "posts", params: {}, used: false, ms: 3 }] },
]);
write("watch/ask-a2.jsonl", [
  { ts: at(40), session: "ask-a2", caller: "vimes-1", code: 'scripts.run("duty", {})', scripts: [{ name: "duty", ok: true, ms: 5 }], speculated: [{ script: "roster", params: {}, used: true, ms: 4 }, { script: "posts", params: {}, used: false, running: true }] },
]);
write("code/carrot-1.jsonl", [
  { ...ask(20, { askId: "c1", question: "where does semaphore-tower send a message?" }), session: "carrot-1", citations: { checked: 3, failed: 0, otherRepo: 2 } },
  { ...ask(10, { askId: "c2", question: "where is the captain set?" }), session: "carrot-1", citations: { checked: 2, failed: 1, failedList: ["src/watch.mjs:9"] } },
]);
// A domain where the host did none of these is left out.
write("sessions/nobby-1.jsonl", [{ ...ask(5, { askId: "s1" }), session: "nobby-1" }]);

const { report } = await import("../src/report.mjs");
const r = report({ since: "24h" });
assert.equal(r.asks, 6);
assert.deepEqual(r.domains.watch, {
  asks: 3,
  opened: 1,
  reasoningBack: 2,
  reasoningRefused: 1,
  quoted: 2,
  quotesInserted: 3,
  quotesUnknown: 2,
  quotesSentBack: 1,
  speculated: 4,
  speculatedUsed: 2,
  speculatedUsedShare: 0.5,
  citationsOtherRepo: 0,
});
assert.equal(r.domains.code.citationsOtherRepo, 2);
assert.equal(r.domains.code.asks, 2);
assert.ok(!("sessions" in r.domains), "a domain with nothing to count is left out");
assert.deepEqual(r.citations.code, { asks: 2, checked: 5, failed: 1, asksWithFailures: 1, otherRepo: 2, failedRate: 0.2 });

// The text report says the same in a line per domain.
const text = execFileSync(process.execPath, [path.join(ROOT, "bin", "ask-kit.mjs"), "report", "--since", "24h"], { encoding: "utf8", env: { ...process.env, ASK_KIT_CONFIG: config, ASK_KIT_STATE: state } });
assert.match(text, /^watch \(3 asks\): 1 opened by an action's script, reasoning sent back in 2, reasoning refused in 1, 3 quoted rows written into 2 \(2 unknown ids\), 1 sent back for unknown quote ids, 4 lookups started ahead, 2 used \(50%\)$/m);
assert.match(text, /^code \(2 asks\): 2 citations resolved in another repository$/m);
assert.doesNotMatch(text, /^sessions \(/m);

fs.rmSync(tmp, { recursive: true, force: true });
console.log("ok");
process.exit(0);
