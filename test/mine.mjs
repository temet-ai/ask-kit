// ask-kit mine with no real transcripts: one Claude Code session with two typed questions that were
// answered by reading the repository by hand, one asked twice, and one fleet brief. Asserts the
// drafted rows, the answer found after each chain, the suggestions, and that bench questions and
// briefs are left out.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ask-kit-mine-")));
process.env.ASK_KIT_CONFIG = path.join(tmp, "config");
process.env.ASK_KIT_STATE = path.join(tmp, "state");
process.env.CLAUDE_CONFIG_DIR = path.join(tmp, "claude");
process.env.CODEX_HOME = path.join(tmp, "codex");
process.env.COPILOT_HOME = path.join(tmp, "copilot");
process.env.GEMINI_CLI_HOME = path.join(tmp, "gemini");
process.env.OPENCODE_DB = path.join(tmp, "none.db");

const repo = path.join(tmp, "work", "unseen-university");
fs.mkdirSync(path.join(repo, ".git"), { recursive: true });
fs.mkdirSync(path.join(tmp, "config"), { recursive: true });
fs.writeFileSync(path.join(tmp, "config", "config.json"), JSON.stringify({ version: 1, domains: { sessions: { enabled: true }, code: { enabled: true } } }));

let clock = Date.now() - 86400_000;
const ts = () => new Date((clock += 1000)).toISOString();
let n = 0;
const rows = [];
const turn = (prompt, files, answer) => {
  rows.push({ type: "user", timestamp: ts(), cwd: repo, sessionId: "s1", message: { role: "user", content: prompt } });
  const content = files.map((f) => ({ type: "tool_use", id: `toolu_${n++}`, name: "Read", input: { file_path: path.join(repo, f) } }));
  rows.push({ type: "assistant", timestamp: ts(), cwd: repo, message: { id: `msg_${n++}`, model: "claude-sonnet-4", usage: { input_tokens: 1000 * files.length, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 10 }, content } });
  rows.push({ type: "user", timestamp: ts(), cwd: repo, message: { role: "user", content: content.map((c) => ({ type: "tool_result", tool_use_id: c.id, content: "x".repeat(400) })) } });
  rows.push({ type: "assistant", timestamp: ts(), cwd: repo, message: { id: `msg_${n++}`, model: "claude-sonnet-4", content: [{ type: "text", text: "Reading on." }] } });
  rows.push({ type: "assistant", timestamp: ts(), cwd: repo, message: { id: `msg_${n++}`, model: "claude-sonnet-4", content: [{ type: "text", text: answer }] } });
};
turn("Where does the Librarian decide which books may be lent out, and what is the limit?", ["src/library/lend.rs", "src/library/policy.rs", "src/library/mod.rs"],
  "In `lend_ok` at `/x/unseen-university/src/library/lend.rs:12`: `MAX_LOANS` is 3, set in `src/library/policy.rs:4`.");
turn("Where does the Librarian decide which books may be lent out, and what is the limit?", ["src/library/lend.rs", "src/library/policy.rs", "src/library/mod.rs", "src/library/shelf.rs"],
  "Same answer: `lend_ok`, limit `MAX_LOANS` = 3.");
turn("Which spell does the Octavo's lock check before opening the vault door?", ["src/vault/lock.rs", "src/vault/door.rs", "src/vault/mod.rs"],
  "It checks `Spell::Eighth` in `src/vault/lock.rs:30`.");
turn("docs-T18 of fleet vault-rework. Your brief is at /tmp/briefs/T18.md - read it in full and begin.", ["src/vault/lock.rs", "src/vault/door.rs", "src/vault/mod.rs"], "Read it.");
turn("Review the vault door change on the octavo branch and say whether it is ready to merge", ["src/vault/lock.rs", "src/vault/door.rs", "src/vault/mod.rs", "src/vault/key.rs", "src/vault/ward.rs"], "Ready to merge.");
const dir = path.join(tmp, "claude", "projects", repo.replace(/[/.]/g, "-"));
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "s1.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");

const { mine, answerAfter, suggestions, writeDrafts, formatMine, questionLike } = await import("../src/mine.mjs");

assert.equal(questionLike("where is the test data"), true);
assert.equal(questionLike("do we not handle correlation ids already?"), true);
assert.equal(questionLike("can you do a review of MR 232 against the ticket"), false);
assert.equal(questionLike("What you can do is start a session and design animations"), false);

// suggestions: repo-relative, no line numbers, escaped.
assert.deepEqual(suggestions("In `lend_ok` at `/x/y/src/library/lend.rs:12-14`, `MAX_LOANS` is 3."), ["lend_ok", "src/library/lend\\.rs", "MAX_LOANS"]);
assert.deepEqual(answerAfter([{ role: "tool_call", toolId: "a" }, { role: "assistant", text: "one" }, { role: "assistant", text: "two" }, { role: "user", text: "next" }, { role: "assistant", text: "three" }], "a"), "two");
assert.equal(answerAfter([], "a"), null);

const r = await mine({ kit: "code", since: "7d" });
assert.equal(r.considered, 4, "four to-answer chains from typed prompts; the fleet brief is left out");
assert.equal(r.rows.length, 3, "the question asked twice is one row");
assert.equal(r.rows.at(-1).kind, "task", "the review is costliest but a task, so it comes after the questions");
assert.ok(r.rows.slice(0, 2).every((x) => x.kind === "question"));
const lib = r.rows.find((x) => /Librarian/.test(x.q));
assert.match(lib.found, /^Same answer/, "the costliest chain of a repeated question is kept, with the answer after it");
assert.deepEqual(lib.expect, []);
assert.equal(lib.draft, true);
assert.ok(lib.suggest.includes("MAX_LOANS"));
assert.match(lib.source, /^claude-code s1 /);
assert.ok(r.rows[0].tokens >= r.rows[1].tokens, "costliest question first");

const file = writeDrafts(r);
assert.equal(file, path.join(tmp, "state", "drafts", "bench", "code.json"));
assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).questions.length, 3);
assert.match(formatMine(r), /3 distinct questions drafted/);

fs.rmSync(tmp, { recursive: true, force: true });
console.log("mine: ok");
