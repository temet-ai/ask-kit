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
assert.equal((await run('"hello')).total, 1);
assert.equal((await run("C:\\watch")).total, 1);
assert.equal((await run("zqxjvkwplm")).total, 0);
assert.equal((await run("dibbler sausage")).total, 18);
assert.equal((await run("dibbler", { since: 1 })).total, 120);

fs.rmSync(tmp, { recursive: true, force: true });
console.log("ok");
process.exit(0);
