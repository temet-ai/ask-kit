// journal.trajectories: off (the default), the journal keeps a cell's code and result size and an ask's
// answer length. On, it also keeps each cell's printed result (clipped at 4,000 characters) and the
// answer on the ask row. The `ask` path runs over MCP against a scripted backend; no model, no network.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ask-kit-traj-"));
const kit = path.join(tmp, "config", "kits", "watch");
fs.mkdirSync(kit, { recursive: true });
fs.writeFileSync(path.join(kit, "ask-kit.toml"), `name = "watch"\nsays = "the Night Watch roster"\n[[sources]]\nkind = "folder"\nname = "roster"\npath = '${tmp}'\n`);

const ANSWER = "Sam Vimes holds the keys to the Treasure House.";
const steps = [{ code: '"Carrot Ironfoundersson reports to Sam Vimes. " + "x".repeat(5000)' }, { answer: ANSWER }];
let calls = 0;
const server = http.createServer(async (req, res) => {
  let raw = "";
  for await (const c of req) raw += c;
  calls++;
  const step = raw.includes("\"role\":\"tool\"") ? steps[1] : steps[0];
  const message = step.code
    ? { role: "assistant", content: null, tool_calls: [{ id: `c${calls}`, type: "function", function: { name: "repl", arguments: JSON.stringify({ code: step.code, maxChars: 20000 }) } }] }
    : { role: "assistant", content: step.answer };
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ choices: [{ message, finish_reason: step.code ? "tool_calls" : "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0 } }));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const backend = { kind: "api", preset: "custom", baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model: "fake", noKey: true };

const rowsOf = (dir) =>
  fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl")).flatMap((f) => fs.readFileSync(path.join(dir, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)));

async function run(label, journal) {
  calls = 0;
  const config = path.join(tmp, "config");
  const state = path.join(tmp, `state-${label}`);
  fs.writeFileSync(path.join(config, "config.json"), JSON.stringify({ version: 1, sources: [], backends: { default: "fake", list: { fake: backend } }, domains: { watch: {} }, ...(journal ? { journal } : {}) }));
  const env = { ...process.env, ASK_KIT_CONFIG: config, ASK_KIT_STATE: state, ASK_KIT_DOMAIN: "watch", ASK_KIT_SESSION: `traj-${label}` };
  const client = new Client({ name: "test", version: "0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, "src/server.mjs")], env, stderr: "inherit" }));
  const r = await client.callTool({ name: "ask", arguments: { question: "who holds the keys?" } });
  assert.match(r.content.map((c) => c.text).join("\n"), /Sam Vimes holds the keys/);
  await client.close();
  const rows = rowsOf(path.join(state, "watch"));
  return { ask: rows.find((x) => x.type === "ask"), cell: rows.find((x) => x.code), doctor: journal?.trajectories === false ? null : doctorLine(config, state) };
}

function doctorLine(config, state) {
  const out = execFileSync(process.execPath, [path.join(ROOT, "bin/ask-kit.mjs"), "doctor"], { env: { ...process.env, ASK_KIT_CONFIG: config, ASK_KIT_STATE: state }, encoding: "utf8", timeout: 60000 });
  return out.split("\n").find((l) => /journal:/.test(l));
}

const off = await run("off", null);
assert.ok(off.cell.resultChars > 4000, "the cell ran and its size is journaled");
assert.equal(off.cell.result, undefined, "off: no result");
assert.equal(off.ask.answer, undefined, "off: no answer");
assert.equal(off.ask.answerChars, ANSWER.length);
assert.match(off.doctor, /journal: .*not stored/);

const explicitOff = await run("explicit-off", { trajectories: false });
assert.equal(explicitOff.cell.result, undefined);
assert.equal(explicitOff.ask.answer, undefined);

const on = await run("on", { trajectories: true });
assert.equal(on.cell.resultChars, off.cell.resultChars, "the size is the same either way");
assert.equal(on.cell.result.length, 4000, "the result is clipped");
assert.match(on.cell.result, /^Carrot Ironfoundersson reports to Sam Vimes/);
assert.equal(on.ask.answer, ANSWER, "the answer is on the ask row");
assert.equal(on.ask.answerChars, ANSWER.length);
assert.match(on.doctor, /journal: trajectories ON/);

server.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log("ok");
process.exit(0);
