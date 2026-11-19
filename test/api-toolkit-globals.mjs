// The api.d.ts of each domain declares every toolkit helper the REPL really has, plus `tk` and
// `ask`. The real globals come from a started investigator REPL (no model, no network).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ask-kit-apidts-"));
fs.mkdirSync(path.join(tmp, "config"));
fs.writeFileSync(
  path.join(tmp, "config", "config.json"),
  JSON.stringify({ version: 1, sources: ["claude-code"], backends: { default: "x", list: { x: { kind: "api", preset: "ollama", model: "none" } } }, domains: { sessions: {}, code: {} } }),
);

for (const domain of ["sessions", "code"]) {
  const env = { ...process.env, ASK_KIT_CONFIG: path.join(tmp, "config"), ASK_KIT_STATE: path.join(tmp, "state"), ASK_KIT_DOMAIN: domain, ASK_KIT_SESSION: `apidts-${domain}`, ASK_KIT_INNER: "1" };
  const c = new Client({ name: "test", version: "0" });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, "src/server.mjs")], env, stderr: "inherit" }));
  const r = await c.callTool({ name: "repl", arguments: { code: "({ tk: Object.keys(tk).sort(), spread: Object.keys(tk).filter((k) => typeof globalThis[k] === 'function').sort(), ask: typeof ask.kit })" } });
  assert.ok(!r.isError, r.content[0].text);
  const real = JSON.parse(r.content[0].text.match(/\{[\s\S]*\n\}/)[0]);
  assert.deepEqual(real.spread, real.tk, `${domain}: every tk helper is also a global`);
  assert.equal(real.ask, "function");
  const dts = fs.readFileSync(path.join(ROOT, "domains", domain, "api.d.ts"), "utf8");
  for (const k of real.tk) assert.match(dts, new RegExp(`declare function ${k}\\b`), `${domain}/api.d.ts declares ${k}`);
  assert.match(dts, /declare const tk\b/, `${domain}/api.d.ts declares tk`);
  assert.match(dts, /declare const ask\b/, `${domain}/api.d.ts declares ask`);
  const tkDecl = dts.match(/declare const tk: \{([^}]*)\}/)[1];
  for (const k of real.tk) assert.match(tkDecl, new RegExp(`\\b${k}:`), `${domain}: tk declares ${k}`);
  await c.close();
}
console.log("ok");
process.exit(0);
