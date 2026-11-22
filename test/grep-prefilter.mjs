// history.grep's file prefilter: ripgrep and the JS fallback (ASK_KIT_NO_RG=1) must give the same
// hits over fixture Claude Code transcripts, for one word, several words, mixed case, a word with
// JSON-escaped characters, a word nobody wrote, and a file list long enough to need several rg runs.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ask-kit-grep-"));
process.env.ASK_KIT_STATE = path.join(tmp, "state");
process.env.CLAUDE_CONFIG_DIR = path.join(tmp, "claude");
const { makeHistory } = await import("../src/transcripts/index.mjs");
const { rgPath } = await import("../src/platform.mjs");

const proj = path.join(tmp, "claude", "projects", "-ankh-morpork-watch");
fs.mkdirSync(proj, { recursive: true });
const user = (text, i) => JSON.stringify({ type: "user", cwd: "/ankh-morpork/watch", timestamp: new Date(Date.now() - i * 1000).toISOString(), message: { role: "user", content: text } });
const write = (name, lines) => fs.writeFileSync(path.join(proj, `${name}.jsonl`), lines.join("\n") + "\n");

write("vimes", [user("Sam Vimes asks about the Footer of the watch house", 1), user("Nothing else here", 2)]);
write("carrot", [user("Carrot reads the FOOTER and the ledger together", 1)]);
write("angua", [user("Angua mentions the footer only", 1), user("and on another line the ledger", 2)]);
write("nobby", [user('Nobby said "hello there" to the watch', 1)]);
write("colon", [user("Colon wrote C:\\watch\\house on a form", 1)]);
write("none", [user("A quiet night in Ankh-Morpork", 1)]);
// Enough long names that the paths do not fit one command line: rg runs in several batches.
for (let k = 0; k < 120; k++) write(`${String(k).padStart(3, "0")}-${"x".repeat(200)}`, [user(k % 7 === 0 ? `Dibbler sells sausage number ${k}` : `Dibbler is elsewhere ${k}`, 1)]);

const keys = (r) => r.map((h) => `${h.session.slice(0, 12)}#${h.i}`).sort();
const run = async (query, o = {}) => {
  const out = {};
  for (const mode of ["rg", "js"]) {
    if (mode === "js") process.env.ASK_KIT_NO_RG = "1";
    else delete process.env.ASK_KIT_NO_RG;
    const h = makeHistory({ sources: ["claude-code"] });
    const r = await h.grep(query, { max: 1000, ...o });
    out[mode] = { keys: keys(r), total: r.total, scanned: r.scanned };
  }
  assert.deepEqual(out.rg, out.js, `rg and JS prefilter differ for ${query}`);
  return out.rg;
};

if (!rgPath()) console.log("note: no ripgrep here, both runs used the JS prefilter");

assert.equal((await run("footer")).total, 3);
assert.equal((await run("FOOTER ledger")).total, 1, "both words must share one event");
assert.equal((await run("footer ledger")).scanned, 1, "angua has both words on different lines, so only carrot is parsed");
assert.equal((await run("ledger footer")).scanned, 1, "the words in the other order than the line has them");
assert.equal((await run("together carrot footer ledger")).total, 1, "four words: ripgrep checks three, the event check the rest");
assert.equal((await run("C:\\watch form")).total, 1, "a word with regex characters, beside another word");
assert.equal((await run("(watch house")).total, 0, "regex characters are literal");
assert.equal((await run('"hello')).total, 1);
assert.equal((await run("C:\\watch")).total, 1);
assert.equal((await run("zqxjvkwplm")).total, 0);

// Enough sessions that the search workers share the parsing: the same hits, in the same order, as one process.
{
  delete process.env.ASK_KIT_NO_RG;
  const shared = await makeHistory({ sources: ["claude-code"] }).grep("dibbler", { max: 1000 });
  assert.equal(shared.total, 120);
  assert.equal(shared.scanned, 120);
  process.env.ASK_KIT_NO_RG = "1";
  const alone = await makeHistory({ sources: ["claude-code"] }).grep("dibbler", { max: 1000, session: undefined });
  delete process.env.ASK_KIT_NO_RG;
  assert.deepEqual(shared.map((h) => `${h.session}#${h.i}`), alone.map((h) => `${h.session}#${h.i}`));
  assert.ok(shared.every((h) => !("order" in h)), "the place in the search is not part of a hit");
}

// A stepped search (quickMs): newest sessions first; once a step is done with hits and the time has
// passed, those hits come back with `searched`, and the same call again returns the whole window.
{
  const old = (name, text, days) => {
    const at = new Date(Date.now() - days * 86400_000);
    const file = path.join(proj, `${name}.jsonl`);
    fs.writeFileSync(file, JSON.stringify({ type: "user", cwd: "/ankh-morpork/watch", timestamp: at.toISOString(), message: { role: "user", content: text } }) + "\n");
    fs.utimesSync(file, at, at);
  };
  write("detritus-today", [user("Detritus guards the armoury tonight", 1)]);
  old("detritus-week", "Detritus guarded the armoury on Tuesday", 3);
  old("detritus-month", "Detritus first saw the armoury", 20);
  old("detritus-month2", "Detritus walked the Tuesday patrol long ago", 20);
  delete process.env.ASK_KIT_NO_RG;
  const h = makeHistory({ sources: ["claude-code"] });
  const first = await h.grep("detritus armoury", { quickMs: 0.001 });
  assert.equal(first.length, 1, "the newest step answered");
  assert.equal(first.searched, "the last 24 hours");
  assert.equal(first.complete, false);
  assert.match(first.older, /same call again/);
  const whole = await h.grep("detritus armoury", { quickMs: 0.001 });
  assert.equal(whole.length, 3, "the same call again returns the whole window");
  assert.equal(whole.complete, true);
  assert.equal(whole.searched, undefined);
  const plain = await h.grep("detritus armoury", { quickMs: 0 });
  assert.deepEqual(keys(whole), keys(plain));
  // A search with nothing in its newest step keeps going to the first step that has hits.
  const h2 = makeHistory({ sources: ["claude-code"] });
  const later = await h2.grep("detritus tuesday", { quickMs: 0.001 });
  assert.equal(later.length, 1);
  assert.equal(later.searched, "the last 7 days");
}
assert.equal((await run("dibbler sausage")).total, 18);
assert.equal((await run("dibbler", { since: 1 })).total, 120);

fs.rmSync(tmp, { recursive: true, force: true });
console.log("ok");
process.exit(0);
