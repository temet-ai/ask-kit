// The investigator's face of the server, over MCP, with no model: `help` lists the scripts, a cell
// runs a script, a variable survives into the next cell and into a restarted server, and the
// calling face shows only `ask`.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ask-kit-repl-"));
fs.mkdirSync(path.join(tmp, "config"));
fs.writeFileSync(
  path.join(tmp, "config", "config.json"),
  JSON.stringify({ version: 1, sources: ["claude-code", "codex", "copilot-cli", "opencode"], backends: { default: "x", list: { x: { kind: "api", preset: "ollama", model: "none" } } }, domains: { sessions: {}, code: {} } }),
);
const env = { ...process.env, ASK_KIT_CONFIG: path.join(tmp, "config"), ASK_KIT_STATE: path.join(tmp, "state"), ASK_KIT_DOMAIN: "sessions", ASK_KIT_SESSION: "repl-test" };

async function open(extra) {
  const c = new Client({ name: "test", version: "0" });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, "src/server.mjs")], env: { ...env, ...extra }, stderr: "inherit" }));
  return c;
}
const text = (r) => r.content.map((c) => c.text).join("\n");

const inner = await open({ ASK_KIT_INNER: "1" });
assert.deepEqual((await inner.listTools()).tools.map((t) => t.name).sort(), ["help", "load", "repl", "reset"]);
const help = text(await inner.callTool({ name: "help", arguments: {} }));
for (const s of ["recent", "find-sessions", "session-digest", "grep", "session-tools", "session-changes"]) assert.ok(help.includes(`- ${s}:`), `help lists ${s}`);
const r1 = await inner.callTool({ name: "repl", arguments: { code: 'const r = await scripts.run("recent", { hours: 24 * 30, limit: 3 }); r.sessions.length' } });
assert.ok(!r1.isError, text(r1));
const r2 = await inner.callTool({ name: "repl", arguments: { code: "typeof r.total" } });
assert.match(text(r2), /^number/);
await inner.close();

// Restarted: the variable comes back from the snapshot.
const again = await open({ ASK_KIT_INNER: "1" });
const r3 = await again.callTool({ name: "repl", arguments: { code: "r.sessions.length >= 0" } });
assert.match(text(r3), /restored .*r/);
await again.close();

const outer = await open({});
assert.deepEqual((await outer.listTools()).tools.map((t) => t.name), ["ask"]);
await outer.close();
console.log("ok");
