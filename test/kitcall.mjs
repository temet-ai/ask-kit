// ask.kit(name, question) in the REPL, with no model and no network: a stub MCP server stands in for
// the other kit's server (ASK_KIT_KITCALL_SERVER), and the real REPL server runs the cells.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { parseFooter } from "../src/kitcall.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ask-kit-kitcall-"));
fs.mkdirSync(path.join(tmp, "config"));
fs.writeFileSync(
  path.join(tmp, "config", "config.json"),
  JSON.stringify({ version: 1, sources: ["claude-code"], backends: { default: "x", list: { x: { kind: "api", preset: "ollama", model: "none" } } }, domains: { sessions: {}, code: {} } }),
);

// The stub: an outer-face server with one `ask` tool that reports what it was started with.
const stub = path.join(tmp, "stub-server.mjs");
fs.writeFileSync(
  stub,
  `import { McpServer } from ${JSON.stringify(import.meta.resolve("@modelcontextprotocol/sdk/server/mcp.js"))};
import { StdioServerTransport } from ${JSON.stringify(import.meta.resolve("@modelcontextprotocol/sdk/server/stdio.js"))};
import { z } from ${JSON.stringify(import.meta.resolve("zod"))};
const s = new McpServer({ name: "stub", version: "0" });
s.registerTool("ask", { description: "stub", inputSchema: { question: z.string(), continue: z.boolean().optional() } }, async ({ question, continue: c }) => ({
  content: [{ type: "text", text: "answer from " + process.env.ASK_KIT_DOMAIN + " depth=" + process.env.ASK_KIT_DEPTH + " session=" + process.env.ASK_KIT_SESSION + " inner=" + (process.env.ASK_KIT_INNER ?? "no") + " continue=" + !!c + ": " + question + "\\n\\n[" + process.env.ASK_KIT_DOMAIN + " · stub-model · 7s · $0.0031]" }],
}));
await s.connect(new StdioServerTransport());
`,
);

const base = { ...process.env, ASK_KIT_CONFIG: path.join(tmp, "config"), ASK_KIT_STATE: path.join(tmp, "state"), ASK_KIT_DOMAIN: "sessions", ASK_KIT_SESSION: "kitcall-test", ASK_KIT_INNER: "1", ASK_KIT_KITCALL_SERVER: stub };
delete base.ASK_KIT_DEPTH;
const open = async (extra = {}) => {
  const c = new Client({ name: "test", version: "0" });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, "src/server.mjs")], env: { ...base, ...extra }, stderr: "inherit" }));
  return c;
};
const text = (r) => r.content.map((c) => c.text).join("\n");
const cell = (c, code) => c.callTool({ name: "repl", arguments: { code } });

assert.deepEqual(parseFooter("x\n\n[code · glm · 12s · $0.0031]"), { backend: "glm", seconds: 12, costUsd: 0.0031 });
assert.deepEqual(parseFooter("x\n\n[code · glm · 12s]\n[routed to code by model]"), { backend: "glm", seconds: 12, costUsd: 0 });
assert.deepEqual(parseFooter("no footer"), {});

// 1. A kit asks another: the answer comes back, from a child started at depth 1 for the same session.
const repl = await open();
const r1 = await cell(repl, 'const a = await ask.kit("code", "where is the router defined?"); a');
assert.ok(!r1.isError, text(r1));
assert.match(text(r1), /answer from code depth=1 session=kitcall-test inner=no continue=false: where is the router defined\?/);
assert.match(text(r1), /\[7s · \$0\.0031\]|\[\d+ ms, 1 call\]/, "the cell reports its call");

// 2. A follow-up passes continue through, and the variable from cell 1 is still there.
const r2 = await cell(repl, 'a.length > 0 && (await ask.kit("code", "and its tests?", { continue: true }))');
assert.match(text(r2), /continue=true: and its tests\?/);

// 3. Unknown kit and itself are refused with the kits that can run.
const r3 = await cell(repl, 'await ask.kit("nope", "hi")');
assert.ok(r3.isError);
assert.match(text(r3), /no kit "nope" can run here\. Kits that can: code/);
const r4 = await cell(repl, 'await ask.kit("sessions", "hi")');
assert.ok(r4.isError);
assert.match(text(r4), /"sessions" is this kit; ask the others: code/);

// 4. The journal: one row per call with the target kit, seconds and cost from the footer.
const journal = fs
  .readFileSync(path.join(tmp, "state", "sessions", "kitcall-test.jsonl"), "utf8")
  .trim()
  .split("\n")
  .map((l) => JSON.parse(l));
const calls = journal.flatMap((j) => j.calls ?? []).filter((c) => c.kind === "ask.kit");
assert.equal(calls.length, 2, "two successful calls journaled");
assert.equal(calls[0].kit, "code");
assert.equal(calls[0].seconds, 7);
assert.equal(calls[0].costUsd, 0.0031);
assert.equal(calls[0].backend, "stub-model");
console.log("journal row:", JSON.stringify(calls[0]));
const h = text(await repl.callTool({ name: "help", arguments: {} }));
assert.match(h, /ask\.kit\(name, question, \{ continue \}\)/);
await repl.close();

// 5. Depth 1: a REPL started by ask.kit (ASK_KIT_DEPTH=1) refuses it, naming the limit.
const deep = await open({ ASK_KIT_DEPTH: "1" });
const r5 = await cell(deep, 'await ask.kit("code", "hi")');
assert.ok(r5.isError);
assert.match(text(r5), /ask\.kit is refused here: .*depth 1, the limit is 1/);
await deep.close();

console.log("ok");
