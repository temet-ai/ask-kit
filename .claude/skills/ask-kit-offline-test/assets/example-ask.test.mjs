// The whole `ask` path with no network and no model: a throwaway config, a fixture kit with one
// script, the scripted backend, and the calling face of src/server.mjs over MCP.
// Copy into test/<name>.mjs, paste fakeBackend() in (or import it from a test/fixtures/ helper you own),
// and change the steps and assertions.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fakeBackend } from "./fake-backend.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ask-kit-example-"));
const config = path.join(tmp, "config");
const kit = path.join(config, "kits", "watch");
fs.mkdirSync(path.join(kit, "scripts"), { recursive: true });
fs.writeFileSync(path.join(kit, "ask-kit.toml"), `name = "watch"\nsays = "the Night Watch roster"\n[[sources]]\nkind = "folder"\nname = "roster"\npath = "${tmp}"\n`);
fs.writeFileSync(
  path.join(kit, "scripts", "greet.mjs"),
  'export const meta = { purpose: "greet an officer", params: { name: "string" }, returns: "text", example: "scripts.run(\\"greet\\", { name: \\"Vimes\\" })" };\nexport default async (g, { name }) => `hello ${name}`;\n',
);

const fake = await fakeBackend([{ code: 'await scripts.run("greet", { name: "Vimes" })' }, { answer: "The script said hello Vimes." }]);
fs.writeFileSync(path.join(config, "config.json"), JSON.stringify({ version: 1, sources: [], backends: { default: "fake", list: { fake: fake.backend } }, domains: { watch: {} } }));

const env = { ...process.env, ASK_KIT_CONFIG: config, ASK_KIT_STATE: path.join(tmp, "state"), ASK_KIT_DOMAIN: "watch", ASK_KIT_SESSION: "example-test" };
const client = new Client({ name: "test", version: "0" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, "src/server.mjs")], env, stderr: "inherit" }));
const r = await client.callTool({ name: "ask", arguments: { question: "greet Vimes" } });
const text = r.content.map((c) => c.text).join("\n");
assert.match(text, /hello Vimes/);
assert.match(text, /\[watch · fake · \d+s\]/, "the footer names the domain and backend");
const toolResult = fake.requests[1].messages.find((m) => m.role === "tool");
assert.match(toolResult.content, /hello Vimes/, "the cell ran the kit's script in the REPL");

await client.close();
await fake.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log("ok");
process.exit(0);
