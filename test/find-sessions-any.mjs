// find-sessions with any: true and one word returns the sessions holding that word (it returned
// nothing: the any path skipped the search and the one-word fallbacks needed two words). Fixture
// Claude Code transcripts only, no model, no network.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ask-kit-any-"));
process.env.ASK_KIT_CONFIG = path.join(tmp, "config");
process.env.ASK_KIT_STATE = path.join(tmp, "state");
process.env.CLAUDE_CONFIG_DIR = path.join(tmp, "claude");
const { makeHistory } = await import("../src/transcripts/index.mjs");
const { default: findSessions } = await import("../domains/sessions/scripts/find-sessions.mjs");

const proj = path.join(tmp, "claude", "projects", "-ankh-morpork-watch");
fs.mkdirSync(proj, { recursive: true });
const user = (text, i) => JSON.stringify({ type: "user", cwd: "/ankh-morpork/watch", timestamp: new Date(Date.now() - i * 1000).toISOString(), message: { role: "user", content: text } });
const write = (name, lines) => fs.writeFileSync(path.join(proj, `${name}.jsonl`), lines.join("\n") + "\n");
write("vimes", [user("Sam Vimes asks about the ledger of the watch house", 1)]);
write("carrot", [user("Carrot reads the ledger and the footer together", 1)]);
write("angua", [user("Angua mentions the footer only", 1)]);
write("none", [user("A quiet night in Ankh-Morpork", 1)]);

const history = makeHistory({ sources: ["claude-code"] });
const run = (params) => findSessions({ history }, params);
const ids = (r) => r.sessions.map((s) => s.id).sort();

const one = await run({ topic: "ledger", any: true });
assert.equal(one.total, 2, "one word with any: true matches the sessions holding it");
assert.deepEqual(ids(one), ids(await run({ topic: "ledger" })), "same sessions as without any");

const many = await run({ topic: "ledger footer", any: true });
assert.equal(many.total, 3, "any matches a session holding either word");
assert.equal((await run({ topic: "ledger footer" })).total, 1, "without any, every word must share one event");
assert.equal((await run({ topic: "zqxjvkwplm", any: true })).total, 0);
console.log("ok");
process.exit(0);
