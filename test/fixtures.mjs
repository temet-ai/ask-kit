// Transcript adapters against made-up stores, so the tests run on any machine and OS with no real
// agent data. The static files under test/fixtures/ are copied into a temp dir (their __CWD__ is
// replaced by a real path of this OS), the env vars that move each agent's store are pointed there,
// and only then are the adapters imported. opencode's SQLite file is built here with node:sqlite.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ask-kit-fixtures-")));
const cwd = path.join(tmp, "work", "shop-api");
// The adapters read cwd from the JSON as-is; the exclusion of investigator sessions looks for "/warm/cwd".
const warmCwd = "/work/ask-kit/warm/cwd";
const esc = (s) => JSON.stringify(s).slice(1, -1);

function copy(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name);
    const b = path.join(to, e.name);
    if (e.isDirectory()) copy(a, b);
    else fs.writeFileSync(b, fs.readFileSync(a, "utf8").replaceAll("__CWD__", esc(cwd)).replaceAll("__WARM__", esc(warmCwd)));
  }
}

const homes = { "claude-code": "claude", codex: "codex", "copilot-cli": "copilot", "gemini-cli": "gemini" };
for (const [dir, to] of Object.entries(homes)) copy(path.join(here, "fixtures", dir), path.join(tmp, to));
process.env.CLAUDE_CONFIG_DIR = path.join(tmp, "claude");
process.env.CODEX_HOME = path.join(tmp, "codex");
process.env.COPILOT_HOME = path.join(tmp, "copilot");
process.env.GEMINI_CLI_HOME = path.join(tmp, "gemini");
process.env.OPENCODE_DB = path.join(tmp, "opencode.db");
process.env.ASK_KIT_STATE = path.join(tmp, "state");

// opencode: the columns the adapter's SQL reads.
const ocCwd = path.join(tmp, "work", "billing");
{
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(process.env.OPENCODE_DB);
  db.exec(`create table session_v2 (id text primary key, directory text, title text, time_created integer, time_updated integer, model text, time_archived integer,
    tokens_input integer, tokens_output integer, tokens_cache_read integer, tokens_cache_write integer, cost real);
    create table session_message (id text primary key, session_id text, type text, seq integer, time_created integer, data text);`);
  const s = db.prepare("insert into session_v2 values (?,?,?,?,?,?,?,?,?,?,?,?)");
  const t0 = Date.parse("2026-11-17T13:00:00.000Z");
  s.run("oc-0001", ocCwd, "Add retry to the invoice job", t0, t0 + 9000, JSON.stringify({ id: "oc-model" }), null, 700, 90, 300, 25, 0.0123);
  s.run("oc-archived", ocCwd, "Archived chat", t0, t0, JSON.stringify({ id: "oc-model" }), t0 + 1, 1, 1, 1, 1, 0);
  const m = db.prepare("insert into session_message values (?,?,?,?,?,?)");
  m.run("om1", "oc-0001", "user", 1, t0 + 1000, JSON.stringify({ text: "Add retry to the invoice job" }));
  m.run(
    "om2",
    "oc-0001",
    "assistant",
    2,
    t0 + 2000,
    JSON.stringify({
      model: { id: "oc-model" },
      content: [
        { type: "reasoning", text: "thinking about backoff" },
        { type: "text", text: "Wrapping the job in an exponential backoff." },
        { type: "tool", tool: "bash", callID: "oc_1", state: { status: "completed", input: { command: "ls jobs" }, output: "invoice.ts" } },
        { type: "tool", tool: "read", callID: "oc_2", state: { status: "error", input: { filePath: "jobs/gone.ts" }, output: "no such file" } },
      ],
    }),
  );
  m.run("om3", "oc-0001", "assistant", 3, t0 + 3000, JSON.stringify({ model: { id: "oc-model" }, content: [{ type: "text", text: "Retries are in place." }] }));
  db.close();
}

const { ADAPTERS, makeHistory } = await import("../src/transcripts/index.mjs");

const roles = (ev) => ev.map((e) => e.role);
const find = async (name, id) => {
  const list = await ADAPTERS[name].sessions();
  const s = list.find((x) => x.id === id);
  assert.ok(s, `${name}: session ${id} not found in ${JSON.stringify(list.map((x) => x.id))}`);
  return s;
};

/** Every tool_call has exactly one tool_result with the same toolId, right after it or later. */
function pairs(ev) {
  const out = {};
  for (const c of ev.filter((e) => e.role === "tool_call")) {
    const r = ev.filter((e) => e.role === "tool_result" && e.toolId === c.toolId);
    assert.equal(r.length, 1, `tool ${c.toolId} should have one result`);
    assert.ok(r[0].i > c.i, `result of ${c.toolId} comes after its call`);
    out[c.toolId] = r[0];
  }
  return out;
}

// Claude Code
{
  const name = "claude-code";
  assert.ok(ADAPTERS[name].available());
  const ids = (await ADAPTERS[name].sessions()).map((s) => s.id).sort();
  assert.deepEqual(ids, ["cc-0001", "cc-warm"]);
  const s = await find(name, "cc-0001");
  assert.equal(s.cwd, cwd);
  assert.equal(s.project, "shop-api");
  assert.equal(s.title, "Please add pagination to the orders endpoint");
  const ev = await ADAPTERS[name].events(s);
  assert.deepEqual(roles(ev), ["system", "system", "user", "assistant", "tool_call", "tool_result", "tool_call", "tool_result", "assistant"]);
  assert.deepEqual(ev.map((e) => e.i), ev.map((_, i) => i));
  assert.match(ev[1].text, /^<system-reminder>/);
  assert.equal(ev[4].tool, "Bash");
  const p = pairs(ev);
  assert.equal(p.toolu_01.ok, true);
  assert.equal(p.toolu_01.text, "handlers.js\nroutes.js");
  assert.equal(p.toolu_02.ok, false);
  assert.equal(p.toolu_02.text, "File does not exist.");
  // One message split over two lines counts once.
  assert.deepEqual(await ADAPTERS[name].usage(s), { "claude-test-1": { calls: 3, input: 370, cacheRead: 190, cacheWrite: 15, output: 85 } });
}

// Codex
{
  const name = "codex";
  assert.ok(ADAPTERS[name].available());
  const s = await find(name, "cx-0001");
  assert.equal(s.cwd, cwd);
  assert.equal(s.project, "shop-api");
  assert.equal(s.title, "Fix the flaky retry test");
  const ev = await ADAPTERS[name].events(s);
  assert.deepEqual(roles(ev), ["system", "user", "assistant", "tool_call", "tool_result", "tool_call", "tool_result", "assistant"]);
  assert.match(ev[0].text, /^# AGENTS\.md instructions/);
  const p = pairs(ev);
  assert.equal(p.call_c1.ok, true);
  assert.equal(p.call_c2.ok, false);
  assert.equal(ev[2].model, "gpt-test");
  // The last token_count is the session's running total.
  assert.deepEqual(await ADAPTERS[name].usage(s), { "gpt-test": { input: 600, cacheRead: 400, cacheWrite: 0, output: 120, reasoning: 30 } });
}

// Copilot CLI
{
  const name = "copilot-cli";
  assert.ok(ADAPTERS[name].available());
  const s = await find(name, "cp-0001");
  assert.equal(s.cwd, cwd);
  assert.equal(s.project, "shop-api");
  assert.equal(s.title, "Rename the config loader to read settings");
  const ev = await ADAPTERS[name].events(s);
  assert.deepEqual(roles(ev), ["user", "assistant", "tool_call", "tool_result", "tool_call", "tool_result", "assistant"]);
  const p = pairs(ev);
  assert.equal(p.tc_1.ok, true);
  assert.equal(p.tc_1.text, "src/main.js:4 loadConfig()");
  assert.equal(p.tc_2.ok, false);
  assert.equal(p.tc_2.text, "path not found");
  assert.deepEqual(await ADAPTERS[name].usage(s), { "copilot-test": { calls: 2, input: 500, cacheRead: 150, cacheWrite: 20, output: 65, premiumRequests: 2 } });
}

// Gemini CLI: no cwd in its files, the project is the hash.
{
  const name = "gemini-cli";
  assert.ok(ADAPTERS[name].available());
  const s = await find(name, "gm-0001");
  assert.equal(s.cwd, null);
  assert.equal(s.project, "gemini:a1b2c3d4");
  assert.equal(s.title, "Summarise the changelog for release notes");
  const ev = await ADAPTERS[name].events(s);
  assert.deepEqual(roles(ev), ["user", "system", "assistant", "tool_call", "tool_result", "tool_call", "tool_result", "assistant"]);
  assert.match(ev[1].text, /GEMINI\.md/);
  const p = pairs(ev);
  assert.equal(p.gt_1.ok, true);
  assert.equal(p.gt_2.ok, false);
  assert.equal(p.gt_2.text, "file not found");
  assert.deepEqual(await ADAPTERS[name].usage(s), { "gemini-test": { calls: 2, input: 1000, cacheRead: 300, cacheWrite: 0, output: 120 } });
}

// opencode
{
  const name = "opencode";
  assert.ok(ADAPTERS[name].available());
  const list = await ADAPTERS[name].sessions();
  assert.deepEqual(list.map((x) => x.id), ["oc-0001"], "archived sessions are left out");
  const s = list[0];
  assert.equal(s.cwd, ocCwd);
  assert.equal(s.project, "billing");
  assert.equal(s.title, "Add retry to the invoice job");
  assert.equal(s.model, "oc-model");
  const ev = await ADAPTERS[name].events(s);
  assert.deepEqual(roles(ev), ["user", "assistant", "tool_call", "tool_result", "tool_call", "tool_result", "assistant"], "reasoning is skipped");
  const p = pairs(ev);
  assert.equal(p.oc_1.ok, true);
  assert.equal(p.oc_1.text, "invoice.ts");
  assert.equal(p.oc_2.ok, false);
  assert.deepEqual(await ADAPTERS[name].usage(s), { "oc-model": { input: 700, output: 90, cacheRead: 300, cacheWrite: 25, costUsd: 0.0123 } });
}

// Through makeHistory: one API over every source.
{
  const h = makeHistory({});
  const all = await h.sessions();
  const ids = all.map((s) => s.id).sort();
  assert.deepEqual(ids, ["cc-0001", "cp-0001", "cx-0001", "gm-0001", "oc-0001"], "the investigator session (cwd ending /warm/cwd) is excluded");
  assert.equal(all.total, 5);
  assert.deepEqual((await h.sessions({ source: "codex" })).map((s) => s.id), ["cx-0001"]);
  assert.deepEqual((await h.sessions({ source: ["codex", "opencode"] })).map((s) => s.id).sort(), ["cx-0001", "oc-0001"]);
  assert.deepEqual((await h.sessions({ project: "billing" })).map((s) => s.id), ["oc-0001"]);

  // Words must share one event.
  const both = await h.grep("pagination orders");
  assert.equal(both.length, 1);
  assert.equal(both[0].session, "cc-0001");
  assert.equal(both[0].role, "user");
  assert.equal(both[0].i, 2);
  assert.equal((await h.grep("ORDERS cursor")).length, 0, "the two words sit in different events");
  assert.equal((await h.grep("cursor handler")).length, 1);
  assert.equal((await h.grep("pagination", { source: "codex" })).length, 0);

  // Every source is searchable, including opencode (no file pre-filter) and Gemini (one JSON document).
  assert.equal((await h.grep("exponential backoff")).at(0)?.session, "oc-0001");
  assert.equal((await h.grep("release notes")).at(0)?.session, "gm-0001");
  assert.equal((await h.grep("lint script missing")).at(0)?.role, "tool_result");
  assert.equal((await h.grep("loadConfig")).filter((x) => x.session === "cp-0001").length, 2);

  // A RegExp.
  const re = await h.grep(/paginat\w+/i);
  assert.equal(re.length, 1);
  assert.equal(re[0].session, "cc-0001");
  assert.equal((await h.grep(/^Fix the \w+ retry/)).at(0)?.session, "cx-0001");

  // Roles: injected text is not searched unless asked for.
  assert.equal((await h.grep("AGENTS.md")).length, 0);
  assert.equal((await h.grep("AGENTS.md", { roles: "system" })).at(0)?.session, "cx-0001");

  // An id prefix resolves to the session.
  const ev = await h.events("cc-00");
  assert.equal(ev.session.id, "cc-0001");
  assert.equal(ev.total, 9);
  assert.deepEqual((await h.events("cx-", { roles: "user" })).map((e) => e.text), ["Fix the flaky retry test"]);
  assert.deepEqual(await h.usage("oc-"), { "oc-model": { input: 700, output: 90, cacheRead: 300, cacheWrite: 25, costUsd: 0.0123 } });
  await assert.rejects(h.events("nope"), /no session/);
  await assert.rejects(h.events("c"), /matches \d+ sessions/);
  // The excluded session is not reachable by id either.
  await assert.rejects(h.events("cc-warm"), /no session/);
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log("ok");
