// Time limits with no model: a synchronous endless loop in a cell is stopped and the REPL stays
// usable, an awaited promise that never settles is cut by the cell's timeout, and an agent CLI
// is stopped before the calling client's own tool timeout.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
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

fs.rmSync(tmp, { recursive: true, force: true });
console.log("ok");
process.exit(0);
