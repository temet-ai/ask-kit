// The session-search path, offline on fixture Claude Code transcripts: the pre-filter searches for the
// rarest word, a RegExp is pre-filtered on its literal, parsed events are cached between cells (counted
// by parseStats), digests are built once per file version and kept on disk, and find-sessions ranks on
// digest plus hits.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ask-kit-search-"));
process.env.ASK_KIT_CONFIG = path.join(tmp, "config");
process.env.ASK_KIT_STATE = path.join(tmp, "state");
process.env.CLAUDE_CONFIG_DIR = path.join(tmp, "claude");
delete process.env.ASK_KIT_NO_RG;
delete process.env.ASK_KIT_PARSE_CACHE_MB;
const { makeHistory, parseStats, clearParsed } = await import("../src/transcripts/index.mjs");
const { rarestFirst, literalOf } = await import("../src/transcripts/common.mjs");
const { rgPath } = await import("../src/platform.mjs");
const { default: findSessions } = await import("../domains/sessions/scripts/find-sessions.mjs");

const proj = path.join(tmp, "claude", "projects", "-ankh-morpork-watch");
fs.mkdirSync(proj, { recursive: true });
const line = (role, text, i) =>
  JSON.stringify(
    role === "user"
      ? { type: "user", cwd: "/ankh-morpork/watch", timestamp: new Date(Date.now() - i * 1000).toISOString(), message: { role: "user", content: text } }
      : { type: "assistant", cwd: "/ankh-morpork/watch", timestamp: new Date(Date.now() - i * 1000).toISOString(), message: { id: `m${i}`, role: "assistant", model: "x", content: [{ type: "text", text }] } },
  );
const write = (name, lines) => fs.writeFileSync(path.join(proj, `${name}.jsonl`), lines.join("\n") + "\n");

// 30 sessions that all say "watch"; one also says "hallucination".
for (let k = 0; k < 30; k++) write(`w${k}`, [line("user", `Sam Vimes asks about the watch rota ${k}`, 1)]);
write("rare", [line("user", "The watch has a hallucination problem", 1)]);

const history = () => makeHistory({ sources: ["claude-code"] });
const h = history();

// 1. The pre-filter searches for the rarest word.
assert.equal(rarestFirst(["watch", "hallucination"])[0], "hallucination");
assert.equal(rarestFirst(["the", "ankh-morpork", "watch"])[0], "ankh-morpork");
assert.deepEqual(rarestFirst(["aaaa", "bbbb"]), ["aaaa", "bbbb"], "ties keep the caller's order");
const g1 = await h.grep("watch hallucination");
assert.equal(g1.total, 1);
assert.equal(g1.scanned, 1);
if (rgPath()) {
  assert.equal(g1.prefilter.needle, "hallucination", "rg looks for the rare word, not the first");
  assert.equal(g1.prefilter.listed, 1, "rg names one file; the first word would have named 31");
  console.log(`rare word: rg listed ${g1.prefilter.listed} of 31 files`);
} else console.log("note: no ripgrep here, the rare-word rg check was skipped");

// 2. A RegExp is pre-filtered on its literal.
assert.equal(literalOf(/hallucin\w*ation/), "hallucin");
assert.equal(literalOf(/halluc(ination|inate)/), "halluc");
assert.equal(literalOf(/ab?cdefg/), "cdefg", "an optional character is not required");
assert.equal(literalOf(/cat|hallucination/), null, "alternation requires no single literal");
assert.equal(literalOf(/\d+\s\w{3}/), null);
const g2 = await h.grep(/hallucin\w*ation/i);
assert.equal(g2.total, 1);
assert.equal(g2.scanned, 1, "only the file holding the literal is parsed");
if (rgPath()) assert.equal(g2.prefilter.needle, "hallucin");
const g3 = await h.grep(/\d\d/);
assert.equal(g3.prefilter.needle, null, "no literal: no pre-filter");
assert.equal(g3.scanned, 31);

// 3. Parsed events are cached between cells.
clearParsed();
const base = { ...parseStats };
await h.grep("hallucination");
await h.grep("watch hallucination");
await h.grep(/hallucin/);
const rare = (await h.sessions({ project: "watch", limit: 100 })).find((s) => s.title?.includes("hallucination"));
await h.events(rare.id);
assert.equal(parseStats.parses - base.parses, 1, "four cells over the same file parse it once");
assert.equal(parseStats.hits - base.hits, 3);
const ev = await h.events(rare.id);
ev.pop();
assert.equal((await h.events(rare.id)).length, 1, "a caller changing its result leaves the cache alone");
console.log(`parse cache: 5 cells, ${parseStats.parses - base.parses} parse, ${parseStats.hits - base.hits + 1} cache hits`);
// A changed file is parsed again.
const rareFile = path.join(proj, "rare.jsonl");
fs.appendFileSync(rareFile, line("assistant", "A second hallucination appears", 0) + "\n");
const b2 = parseStats.parses;
assert.equal((await h.grep("hallucination")).total, 2);
assert.equal(parseStats.parses - b2, 1);
// A cap of nothing keeps nothing.
process.env.ASK_KIT_PARSE_CACHE_MB = "0";
clearParsed();
const b3 = parseStats.parses;
await h.grep("hallucination");
await h.grep("hallucination");
assert.equal(parseStats.parses - b3, 2, "with a zero cap every cell parses");
delete process.env.ASK_KIT_PARSE_CACHE_MB;

// 4. Digests: built once per file version, kept on disk, rebuilt when the file changes.
write("ledger-talk", [line("user", "Please explain the ledger migration plan", 5), line("assistant", "ok", 4)]);
write("chatter", [
  line("user", "Fix the failing build on the watch house", 9),
  ...Array.from({ length: 8 }, (_, k) => line("assistant", `tool output mentions the ledger again ${k}`, 8 - k)),
]);
const refs = (await history().sessions({ project: "watch", limit: 100 })).filter((s) => ["ledger-talk", "chatter"].includes(s.id)).map((s) => ({ source: s.source, id: s.id }));
assert.equal(refs.length, 2);
clearParsed();
const d1 = await history().digests(refs);
assert.equal(d1.built, 2);
assert.equal(d1.reused, 0);
assert.ok(d1[0].terms.length && d1.some((d) => d.terms.includes("ledger")), "top terms come from the prompts");
assert.ok(fs.existsSync(path.join(tmp, "state", "index", "digests.json")), "digests are kept under the state folder");
clearParsed();
const p0 = parseStats.parses;
const d2 = await history().digests(refs); // a new run: nothing in memory
assert.equal(d2.built, 0);
assert.equal(d2.reused, 2);
assert.equal(parseStats.parses, p0, "reused digests read no transcript");
const reusedParses = parseStats.parses - p0;
assert.deepEqual([...d2], [...d1]);
fs.appendFileSync(path.join(proj, "chatter.jsonl"), line("user", "Now check the zebra crossing", 0) + "\n");
const d3 = await history().digests(refs);
assert.equal(d3.built, 1, "only the changed file is rebuilt");
assert.equal(d3.reused, 1);
assert.ok(d3.find((d) => d?.terms.includes("zebra")));
console.log(`digests: built ${d1.built}, then reused ${d2.reused} with ${reusedParses} parses, then rebuilt ${d3.built} after a change`);

// 5. find-sessions ranks on digest plus hits.
const r = await findSessions({ history: history() }, { topic: "ledger" });
const byHits = [...r.sessions].sort((a, b) => b.userHits * 3 + b.hits - (a.userHits * 3 + a.hits));
assert.equal(byHits[0].id, "chatter", "by hit counts alone the chatty session would lead");
assert.equal(r.sessions[0].id, "ledger-talk", "the session whose prompt is about the topic leads");
assert.ok(r.sessions[0].digest.terms.includes("ledger"));
assert.ok(r.sessions.every((s, i, a) => !i || a[i - 1].score >= s.score));
console.log(`ranking: ${r.sessions.map((s) => `${s.id} ${s.score}`).join(", ")}`);

fs.rmSync(tmp, { recursive: true, force: true });
console.log("ok");
process.exit(0);
