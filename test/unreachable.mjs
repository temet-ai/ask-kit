// A source that does not answer: from the second cell that fails to connect, the investigator is
// told not to wait for it. Scripted backend, a fixture kit whose cells fetch a closed port. No model.
import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fakeBackend } from "./fixtures/shot-kit/fake-backend.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ask-kit-unreachable-"));
const config = path.join(tmp, "config");
fs.cpSync(path.join(ROOT, "test", "fixtures", "shot-kit"), path.join(config, "kits", "watch"), { recursive: true });

// A port nothing listens on.
const port = await new Promise((resolve) => {
  const s = net.createServer().listen(0, "127.0.0.1", () => {
    const p = s.address().port;
    s.close(() => resolve(p));
  });
});
// The kit's roster lives behind an HTTP service that is stopped.
fs.writeFileSync(path.join(config, "kits", "watch", "watch.mjs"), `export const make = () => ({ onDuty: async () => (await fetch("http://127.0.0.1:${port}/roster")).json() });\n`);
const down = `await watch.onDuty("Pseudopolis Yard").catch((e) => String(e))`;
const ANSWER = "The roster at Pseudopolis Yard could not be reached.";
const fake = await fakeBackend([{ code: down }, { code: down + " // again" }, { answer: ANSWER }]);
fs.writeFileSync(path.join(config, "config.json"), JSON.stringify({ version: 1, sources: [], backends: { default: "fake", list: { fake: fake.backend } }, domains: { watch: {} } }));

const client = new Client({ name: "test", version: "0" });
await client.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: [path.join(ROOT, "bin", "ask-kit.mjs"), "serve", "--domain", "watch"],
    env: { ...process.env, ASK_KIT_CONFIG: config, ASK_KIT_STATE: path.join(tmp, "state"), ASK_KIT_SESSION: "unreachable" },
    stderr: "inherit",
  }),
);
const res = await client.callTool({ name: "ask", arguments: { question: "who is on duty at Pseudopolis Yard?" } });
assert.equal(res.content.map((c) => c.text).join("\n"), ANSWER);

const toolResults = (body) => body.messages.filter((m) => m.role === "tool").map((m) => m.content);
const afterFirst = toolResults(fake.requests[1]);
assert.match(afterFirst[0], /fetch failed/, "the first cell shows the failure");
assert.doesNotMatch(afterFirst[0], /could not reach a source/, "one failed cell is not yet a source that is down");
const afterSecond = toolResults(fake.requests[2]);
assert.match(afterSecond[1], /\[2 cells could not reach a source\. It will not come back during this ask: do not wait for it or try it again\./, "the second failed cell says not to wait");

// The journal row carries the count of cells that could not reach a source, and no stuck key.
const rows = [];
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (e.name.endsWith(".jsonl")) rows.push(...fs.readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))); } };
walk(path.join(tmp, "state"));
const row = rows.find((r) => r.type === "ask" && r.question === "who is on duty at Pseudopolis Yard?");
assert.ok(row, "the ask is journaled");
assert.equal(row.unreached, 2, "two cells could not reach the source");
assert.ok(!("stuck" in row), "stuck is left out at zero");

await client.close();
await fake.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log("ok");
