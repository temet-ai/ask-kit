// Before setup, `ask-kit serve` still starts, lists `ask` and answers with how to set it up, so a client
// that installed ask-kit from a registry or an extension connects (it used to exit, and the client
// showed a server that failed to start).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const home = fs.mkdtempSync(path.join(os.tmpdir(), "ask-kit-notsetup-"));
const env = {
  PATH: process.env.PATH,
  HOME: home,
  USERPROFILE: home,
  APPDATA: path.join(home, "AppData", "Roaming"),
  LOCALAPPDATA: path.join(home, "AppData", "Local"),
  XDG_CONFIG_HOME: path.join(home, ".config"),
  XDG_STATE_HOME: path.join(home, ".local", "state"),
  XDG_DATA_HOME: path.join(home, ".local", "share"),
  ASK_KIT_CONFIG: path.join(home, "no-config"),
  ASK_KIT_STATE: path.join(home, "state"),
};
const client = new Client({ name: "test", version: "0" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, "bin", "ask-kit.mjs"), "serve"], env, cwd: home, stderr: "ignore" }));
const { tools } = await client.listTools();
assert.deepEqual(tools.map((t) => t.name), ["ask"]);
const r = await client.callTool({ name: "ask", arguments: { question: "what did I work on yesterday?" } });
assert.equal(r.isError, true);
assert.match(r.content[0].text, /not set up yet/);
assert.match(r.content[0].text, /ask-kit setup/);
await client.close();
fs.rmSync(home, { recursive: true, force: true });
console.log("ok");
process.exit(0);
