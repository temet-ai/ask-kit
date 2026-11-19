// Early answers with a scripted backend: the investigator calls early_answer with the main fact,
// the ask returns it at once marked partial while the run goes on, and a continue: true ask
// collects the rest. No network, no model.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fakeBackend } from "./fixtures/shot-kit/fake-backend.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ask-kit-early-"));
const config = path.join(tmp, "config");
const state = path.join(tmp, "state");
fs.cpSync(path.join(ROOT, "test", "fixtures", "shot-kit"), path.join(config, "kits", "watch"), { recursive: true });

const HOLD_MS = 1500;
const fake = await fakeBackend([
  { code: 'const cable = await scripts.run("duty", { post: "Cable Street" }); cable.officers' },
  { tool: "early_answer", args: { answer: "Angua is on duty at Cable Street (scripts.run duty)." } },
  { delayMs: HOLD_MS, code: '(await scripts.run("duty", { post: "Pseudopolis Yard" })).officers' },
  { answer: "Angua is on duty at Cable Street; Pseudopolis Yard has Sam Vimes and Carrot Ironfoundersson (scripts.run duty, twice)." },
]);
fs.writeFileSync(path.join(config, "config.json"), JSON.stringify({ version: 1, sources: [], backends: { default: "fake", list: { fake: fake.backend } }, domains: { watch: {} } }));
const env = { ...process.env, ASK_KIT_CONFIG: config, ASK_KIT_STATE: state, ASK_KIT_DOMAIN: "watch", ASK_KIT_SESSION: "early-test" };
const textOf = (r) => r.content.map((c) => c.text).join("\n");

const client = new Client({ name: "test", version: "0" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, "src", "server.mjs")], env, stderr: "inherit" }));

const t0 = Date.now();
const first = await client.callTool({ name: "ask", arguments: { question: "who is on duty at Cable Street, and who else is on duty?" } });
const firstMs = Date.now() - t0;
const firstText = textOf(first);
assert.ok(!first.isError, firstText);
assert.match(firstText, /^Angua is on duty at Cable Street/);
assert.match(firstText, /more is coming: ask again with continue: true/);
assert.match(firstText, /\[watch · fake · early · \d+s\]$/);
assert.ok(firstMs < HOLD_MS, `the early answer came before the held step (${firstMs} ms)`);
assert.ok(fake.requests[0].tools.some((t) => t.function.name === "early_answer"), "the loop offers early_answer");
assert.match(fake.requests[0].messages[0].content, /call `early_answer`/, "the instructions say when to use it");

const t1 = Date.now();
const rest = await client.callTool({ name: "ask", arguments: { question: "the rest", continue: true } });
const restMs = Date.now() - t1;
const restText = textOf(rest);
assert.ok(!rest.isError, restText);
assert.match(restText, /Pseudopolis Yard has Sam Vimes and Carrot Ironfoundersson/);
assert.match(restText, /\[watch · fake · \d+s\]/);
assert.match(restText, /the rest of your earlier question/);
assert.equal(fake.requests.length, 4, "the run carried on after the early answer and asked nothing more for the follow-up");
const earlyAck = fake.requests[2].messages.findLast((m) => m.role === "tool").content;
assert.match(earlyAck, /^Sent to the caller/);

const rows = fs.readFileSync(path.join(state, "watch", "early-test.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((r) => r.type === "ask");
assert.equal(rows.length, 2);
assert.equal(rows[0].early, true);
assert.equal(rows[0].partial, true);
assert.ok(rows[1].earlyMs >= 0 && rows[1].cells === 2, "the finished run's row says when the early answer went out");

// From a shell (early: false) the loop offers no early_answer.
const fake2 = await fakeBackend([{ answer: "Angua." }]);
fs.writeFileSync(path.join(config, "config.json"), JSON.stringify({ version: 1, sources: [], backends: { default: "fake", list: { fake: fake2.backend } }, domains: { watch: {} } }));
const c2 = new Client({ name: "test", version: "0" });
await c2.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, "src", "server.mjs")], env: { ...env, ASK_KIT_SESSION: "early-off" }, stderr: "inherit" }));
await c2.callTool({ name: "ask", arguments: { question: "who is at Cable Street?", early: false } });
assert.ok(!fake2.requests[0].tools.some((t) => t.function.name === "early_answer"));
assert.doesNotMatch(fake2.requests[0].messages[0].content, /early_answer/);

if (process.env.EARLY_SHOW) console.log(`--- first (${firstMs} ms)\n${firstText}\n--- continue: true (${restMs} ms)\n${restText}`);
await client.close();
await c2.close();
await fake.close();
await fake2.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log("ok");
process.exit(0);
