// Quoted rows on an agent CLI backend: the claude-cli investigator's REPL is named after the ask
// (ask-<askId>), so the handler finds the rows it kept with `quote` and writes them into the answer,
// and the first question tells the investigator about `quote`. A follow-up keeps the same REPL.
// A scripted stand-in for the claude CLI starts the real inner REPL from the MCP config it is
// given; no network, no model.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ask-kit-quotes-cli-")));
const config = path.join(tmp, "config");
const state = path.join(tmp, "state");
fs.cpSync(path.join(ROOT, "test", "fixtures", "shot-kit"), path.join(config, "kits", "watch"), { recursive: true });

// The stand-in: the warming call answers "ready"; a question runs one cell that quotes the duty
// book, and answers with markers (one for a row it never kept). Each call's arguments and the
// REPL's session are written to calls.jsonl.
const calls = path.join(tmp, "calls.jsonl");
const fakeClaude = path.join(tmp, "claude-fake.mjs");
fs.writeFileSync(
  fakeClaude,
  `#!${process.execPath}
import fs from "node:fs";
const { Client } = await import(${JSON.stringify(import.meta.resolve("@modelcontextprotocol/sdk/client/index.js"))});
const { StdioClientTransport } = await import(${JSON.stringify(import.meta.resolve("@modelcontextprotocol/sdk/client/stdio.js"))});
const a = process.argv.slice(2);
const cfg = JSON.parse(fs.readFileSync(a[a.indexOf("--mcp-config") + 1], "utf8")).mcpServers.repl;
const record = { prompt: a[a.indexOf("-p") + 1], resume: a.includes("--resume") ? a[a.indexOf("--resume") + 1] : null, fork: a.includes("--fork-session"), session: cfg.env.ASK_KIT_SESSION ?? null };
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify(record) + "\\n");
if (!record.resume) {
  console.log(JSON.stringify({ session_id: "warm-1", result: "ready", is_error: false, total_cost_usd: 0 }));
  process.exit(0);
}
const c = new Client({ name: "fake-claude", version: "0" });
await c.connect(new StdioClientTransport({ command: cfg.command, args: cfg.args, env: { ...process.env, ...cfg.env }, stderr: "inherit" }));
let result;
if (record.fork) {
  const code = 'const book = (await scripts.run("duty", {})).officers.map((name, i) => ({ id: "w" + (i + 1), text: name + " signed the duty book" }));\\nquote(book)';
  const r = await c.callTool({ name: "repl", arguments: { code } });
  if (r.isError) throw new Error(JSON.stringify(r.content));
  result = "On duty:\\n- {{quote:w1}}\\n- {{quote:w9}}";
} else {
  result = "Carrot: {{quote:w2}}";
}
await c.close();
console.log(JSON.stringify({ session_id: record.fork ? "fork-1" : record.resume, result, is_error: false, total_cost_usd: 0, num_turns: 2 }));
process.exit(0);
`,
  { mode: 0o755 },
);
fs.writeFileSync(
  path.join(config, "config.json"),
  JSON.stringify({ version: 1, sources: [], backends: { default: "cli", list: { cli: { kind: "claude-cli", bin: fakeClaude, model: "none" } } }, domains: { watch: {} } }),
);

const env = { ...process.env, ASK_KIT_CONFIG: config, ASK_KIT_STATE: state, ASK_KIT_DOMAIN: "watch", ASK_KIT_SESSION: "quotes-cli-test" };
const textOf = (r) => r.content.map((c) => c.text).join("\n");
const client = new Client({ name: "test", version: "0" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, "src", "server.mjs")], env, stderr: "inherit" }));

const first = await client.callTool({ name: "ask", arguments: { question: "list word for word who signed the duty book", early: false } });
const text = textOf(first);
assert.ok(!first.isError, text);
assert.equal(text, "On duty:\n- Sam Vimes signed the duty book\n- [no fetched row has id w9]", "the kept row is written in; an unknown id is marked, never guessed");

const log = fs.readFileSync(calls, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const [warm, fork] = log;
assert.equal(warm.session, null, "the warm session's REPL belongs to no ask");
assert.match(fork.session, /^ask-[0-9a-f-]{36}$/, "the question's REPL is named after the ask");
assert.match(fork.prompt, /quote\(rows, \{ id, text \}\)/, "the first question tells the investigator about quote");
assert.ok(fs.existsSync(path.join(state, "watch", `${fork.session}.quotes.json`)), "the rows are kept under the ask's REPL");

const second = await client.callTool({ name: "ask", arguments: { question: "and Carrot?", continue: true, early: false } });
assert.equal(textOf(second), "Carrot: Carrot Ironfoundersson signed the duty book", "a follow-up quotes rows the first ask kept");
const resumed = fs.readFileSync(calls, "utf8").trim().split("\n").map((l) => JSON.parse(l))[2];
assert.equal(resumed.resume, "fork-1");
assert.equal(resumed.session, fork.session, "the follow-up runs in the same REPL");
assert.doesNotMatch(resumed.prompt, /quote\(rows/, "a follow-up is not told again");

const rows = fs.readFileSync(path.join(state, "watch", "quotes-cli-test.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((r) => r.type === "ask");
assert.deepEqual(rows[0].quotes, { inserted: 1, unknown: ["w9"] });
assert.deepEqual(rows[1].quotes, { inserted: 1 });
assert.ok(!("quotesFrom" in rows[0]), "the REPL's id is not journaled");

await client.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log("ok");
process.exit(0);
