// Time limits with no model: a synchronous endless loop in a cell is stopped and the REPL stays
// usable, an awaited promise that never settles is cut by the cell's timeout, and an agent CLI
// is stopped before the calling client's own tool timeout. An API reply that ends at the model's
// length limit is continued until it is finished.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ask-kit-limits-"));
const config = path.join(tmp, "config");
fs.mkdirSync(config);
process.env.ASK_KIT_CONFIG = config;
process.env.ASK_KIT_STATE = path.join(tmp, "state");

// A stand-in for the claude CLI: the warming call answers, the question never does.
const fakeClaude = path.join(tmp, "claude-fake.mjs");
fs.writeFileSync(
  fakeClaude,
  `#!${process.execPath}\nconst a = process.argv.slice(2);\nif (a.includes("--fork-session") || a.includes("--resume")) setTimeout(() => {}, 120000);\nelse console.log(JSON.stringify({ session_id: "warm-1", result: "ready", is_error: false, total_cost_usd: 0 }));\n`,
  { mode: 0o755 },
);
fs.writeFileSync(
  path.join(config, "config.json"),
  JSON.stringify({
    version: 1,
    sources: [],
    backends: { default: "slow", list: { slow: { kind: "claude-cli", bin: fakeClaude, model: "none" }, x: { kind: "api", preset: "ollama", model: "none" } } },
    domains: { sessions: {} },
  }),
);
const env = { ...process.env, ASK_KIT_CONFIG: config, ASK_KIT_STATE: path.join(tmp, "state"), ASK_KIT_DOMAIN: "sessions", ASK_KIT_SESSION: "limits-test" };
const text = (r) => r.content.map((c) => c.text).join("\n");
async function open(extra) {
  const c = new Client({ name: "test", version: "0" });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, "src/server.mjs")], env: { ...env, ...extra }, stderr: "inherit" }));
  return c;
}

// 1. REPL cells.
const repl = await open({ ASK_KIT_INNER: "1" });
let t = Date.now();
const loop = await repl.callTool({ name: "repl", arguments: { code: "const kept = 41; while (true) {}", timeoutSeconds: 1 } });
assert.ok(loop.isError, "an endless synchronous loop is an error");
assert.match(text(loop), /timed out after 1s of synchronous work/);
assert.ok(Date.now() - t < 10_000, "the loop was stopped, not waited out");
const after = await repl.callTool({ name: "repl", arguments: { code: "1 + 1" } });
assert.ok(!after.isError && text(after).includes("2"), "the REPL runs the next cell");
t = Date.now();
const never = await repl.callTool({ name: "repl", arguments: { code: "await new Promise(() => {})", timeoutSeconds: 1 } });
assert.ok(never.isError);
assert.match(text(never), /cell timed out after 1s/);
assert.ok(Date.now() - t < 10_000);
assert.ok(!(await repl.callTool({ name: "repl", arguments: { code: "2 + 2" } })).isError);
await repl.close();

// 2. The CLI limit.
const { cliLimitMs } = await import("../src/ask.mjs");
const { runCli } = await import("../src/platform.mjs");
assert.equal(cliLimitMs(300_000), 313_000, "no client limit: the ask's limit plus the 13 s for the CLI to finish");
assert.equal(cliLimitMs(285_000, 300_000), 298_000, "the client's limit less 15 s, plus 13 s, is 2 s inside it");
assert.equal(cliLimitMs(20_000, 20_000), 18_000, "the 20 s floor on the ask's limit does not carry the CLI past the client");
assert.equal(cliLimitMs(120_000, 600_000), 133_000, "a shorter timeoutSeconds still bounds the CLI");
const quick = await runCli(process.execPath, ["-e", "setTimeout(()=>{},60000)"], { timeoutMs: 300 });
assert.equal(quick.timedOut, true, "runCli says it stopped the process");

// 3. A whole ask against a CLI that never answers, with a client timeout of 20 s.
const caller = await open({ MCP_TOOL_TIMEOUT: "20000" });
t = Date.now();
const r = await caller.callTool({ name: "ask", arguments: { question: "who is on watch?", backend: "slow" } }, undefined, { timeout: 60_000 });
const took = Date.now() - t;
assert.ok(r.isError);
assert.match(text(r), /stopped at the time limit/);
assert.ok(took < 20_000, `ask returned in ${took} ms, inside the client's 20 s`);
await caller.close();

// 4. Replies that end at the model's length limit are continued and joined.
let steps = [];
const requests = [];
const backend = http.createServer(async (req, res) => {
  let raw = "";
  for await (const c of req) raw += c;
  requests.push(JSON.parse(raw));
  const step = steps.shift() ?? { answer: "(no step left)" };
  if (step.hang) return; // never answers
  if (step.status) return res.writeHead(step.status, { "content-type": "application/json" }).end(JSON.stringify({ error: { message: step.error } }));
  const call = step.early ? { name: "early_answer", args: { answer: step.early } } : step.call;
  const message = { role: "assistant", content: step.answer ?? null, ...(call ? { tool_calls: [{ id: "c1", type: "function", function: { name: call.name, arguments: JSON.stringify(call.args) } }] } : {}) };
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ choices: [{ message, finish_reason: step.cut ? "length" : "stop" }], usage: {} }));
});
await new Promise((ok) => backend.listen(0, "127.0.0.1", ok));
const api = { kind: "api", preset: "custom", baseUrl: `http://127.0.0.1:${backend.address().port}/v1`, model: "fake", noKey: true };
fs.writeFileSync(path.join(config, "config.json"), JSON.stringify({ version: 1, sources: [], backends: { default: "native", list: { native: api, blocks: { ...api, nativeTools: false } } }, domains: { sessions: {} } }));
const asker = await open({ ASK_KIT_SESSION: "length-test" });
const tool = (await asker.listTools()).tools.find((x) => x.name === "ask");
assert.equal(tool._meta?.["anthropic/maxResultSizeChars"], 500_000);
const askWith = async (list, extra = {}) => {
  steps = list;
  requests.length = 0;
  return asker.callTool({ name: "ask", arguments: { question: "what is in the Watch's ledger?", ...extra } }, undefined, { timeout: 60_000 });
};
const part = (name) => `${name} ${"Detritus guards the bridge. ".repeat(900)}`;
const [p1, p2, p3] = [part("one "), part(" two"), part("three").trim()];
for (const which of ["native", "blocks"]) {
  const whole = await askWith([{ answer: p1, cut: true }, { answer: p2, cut: true }, { answer: p3 }], { backend: which });
  assert.ok(text(whole) === p1 + p2 + p3, `${which}: the parts are joined, with no note and nothing lost`);
  assert.equal(requests.length, 3);
  assert.equal(requests[1].messages.at(-2).content, p1);
  assert.match(requests[1].messages.at(-1).content, /Carry on from the exact character/);
  assert.equal(requests[2].messages.at(-2).content, p1 + p2);
  assert.equal(requests[1].tools, undefined, "a continuation offers no tools");
  const next = await askWith([{ answer: "Still there." }], { backend: which, continue: true });
  assert.equal(text(next), "Still there.");
  assert.ok(requests[0].messages.some((m) => m.role === "assistant" && m.content === p1 + p2 + p3), "a follow-up holds the joined answer");
}
// A cell cut in the middle of its block is finished, then run.
assert.equal(text(await askWith([{ answer: "```js\n6 *", cut: true }, { answer: " 7\n```" }, { answer: "It is 42." }], { backend: "blocks" })), "It is 42.");
assert.match(requests[2].messages.at(-1).content, /^Cell result:\n```\n42/);
// An empty reply at the limit (all reasoning) is not an answer.
assert.equal(text(await askWith([{ answer: "", cut: true }, { answer: "Here." }], { backend: "blocks" })), "Here.");
// The investigator raises its own clip with maxChars, and clipped console output says so.
const cell = (args) => ({ call: { name: "repl", args } });
assert.equal(text(await askWith([cell({ code: "console.log('c'.repeat(9000)); 'v'.repeat(9000)" }), cell({ code: "console.log('c'.repeat(9001)); 'v'.repeat(9001)", maxChars: 20_000 }), { answer: "Read." }])), "Read.");
const [clipped, raised] = requests[2].messages.filter((m) => m.role === "tool").map((m) => m.content);
assert.match(clipped, /v\n… \[clipped: 4000 of 9000 chars\]/);
assert.match(clipped, /c\n… \[clipped: /, "console output that is clipped says so");
assert.ok(raised.includes("c".repeat(9001)) && raised.includes("v".repeat(9001)), "maxChars raises both");
// An early answer cut at the limit is not sent.
assert.equal(text(await askWith([{ early: "half of", cut: true }, { answer: "All of it." }])), "All of it.");
const NOT_FINISHED = "\n\n[not finished: ask again with continue: true to carry on from here]";
assert.ok(text(await askWith([{ answer: p1, cut: true }, { status: 500, error: "no" }])) === p1.trim() + NOT_FINISHED, "a continuation that fails keeps the text and says it is not finished");
const hurried = await open({ MCP_TOOL_TIMEOUT: "20000", ASK_KIT_SESSION: "hurried-test" });
steps = [{ answer: p1, cut: true }, { answer: p2, cut: true }, { hang: true }];
t = Date.now();
assert.ok(text(await hurried.callTool({ name: "ask", arguments: { question: "what is in the Watch's ledger?" } }, undefined, { timeout: 60_000 })) === (p1 + p2).trim() + NOT_FINISHED, "the time limit ends it: all parts so far, and the note");
assert.ok(Date.now() - t < 40_000);
await hurried.close();
const refusal = "The Patrician says no. ".repeat(400);
const refused = await askWith([{ status: 400, error: refusal }]);
assert.ok(refused.isError && text(refused).includes(refusal), "a provider's error text is whole");
await asker.close();
backend.closeAllConnections();
backend.close();

fs.rmSync(tmp, { recursive: true, force: true });
console.log("ok");
process.exit(0);
