// The model's reasoning goes back to it: each assistant message the API loop keeps carries the
// reply's `reasoning`, `reasoning_details` or `reasoning_content` unchanged on the next request,
// in native-tool and code-block mode and on a follow-up; a provider that refuses those fields
// gets the same step again without them. Scripted backends on 127.0.0.1; no network, no model.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fakeBackend } from "./fixtures/shot-kit/fake-backend.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ask-kit-reasoning-"));
const config = path.join(tmp, "config");
const state = path.join(tmp, "state");
fs.cpSync(path.join(ROOT, "test", "fixtures", "shot-kit"), path.join(config, "kits", "watch"), { recursive: true });

const CELL = 'await scripts.run("duty", { post: "Cable Street" })';
// OpenRouter's shape: a text and the blocks it came from, one of them signed.
const OR = { reasoning: "Angua's post is Cable Street; the duty script lists it.", reasoning_details: [{ type: "reasoning.text", text: "Angua's post is Cable Street; the duty script lists it.", signature: "sig-ankh-1", format: "unknown", index: 0 }] };
// DeepSeek's shape.
const DS = { reasoning_content: "Ask the roster for Cable Street first." };
const DS2 = { reasoning_content: "The roster answered; Angua it is." };

const openrouter = await fakeBackend([{ code: CELL, fields: OR }, { answer: "Angua is on duty at Cable Street (scripts.run duty).", fields: { reasoning: "Done." } }, { answer: "Still Angua." }]);
const deepseek = await fakeBackend([{ code: CELL, fields: DS }, { answer: "Angua (scripts.run duty).", fields: DS2 }]);
// Refuses any request whose messages carry reasoning, as a provider that does not take it back would.
const carries = (body) => body.messages.some((m) => "reasoning" in m || "reasoning_details" in m || "reasoning_content" in m);
const strictSteps = [{ code: CELL, fields: OR }, { answer: "Angua (scripts.run duty)." }];
let strictAt = 0;
const strict = await fakeBackend([(body) => (carries(body) ? { status: 400, error: { message: "messages.2: property 'reasoning' is unsupported", code: 400 } } : strictSteps[Math.min(strictAt++, strictSteps.length - 1)])]);
const blocks = await fakeBackend([{ answer: "```js\n" + CELL + "\n```", fields: DS }, { answer: "Angua (scripts.run duty).", fields: DS2 }]);

fs.writeFileSync(
  path.join(config, "config.json"),
  JSON.stringify({
    version: 1,
    sources: [],
    backends: { default: "openrouter", list: { openrouter: openrouter.backend, deepseek: deepseek.backend, strict: strict.backend, blocks: { ...blocks.backend, nativeTools: false } } },
    domains: { watch: {} },
  }),
);
const env = { ...process.env, ASK_KIT_CONFIG: config, ASK_KIT_STATE: state, ASK_KIT_DOMAIN: "watch", ASK_KIT_SESSION: "reasoning-test" };
const textOf = (r) => r.content.map((c) => c.text).join("\n");
const client = new Client({ name: "test", version: "0" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, "src", "server.mjs")], env, stderr: "inherit" }));
const ask = async (args) => {
  const r = await client.callTool({ name: "ask", arguments: { early: false, ...args } });
  assert.ok(!r.isError, textOf(r));
  return textOf(r);
};
const assistants = (body) => body.messages.filter((m) => m.role === "assistant");

// Native tools, OpenRouter's fields: both come back on the assistant message that made the call.
assert.match(await ask({ question: "who is on duty at Cable Street?", backend: "openrouter" }), /Angua/);
const [call] = assistants(openrouter.requests[1]);
assert.equal(call.tool_calls[0].function.name, "repl");
assert.equal(call.reasoning, OR.reasoning);
assert.deepEqual(call.reasoning_details, OR.reasoning_details, "the blocks go back as they came, signature and all");
assert.ok(!("reasoning_content" in call), "no field the reply did not carry");
assert.ok(!assistants(openrouter.requests[0]).length, "the first request has no assistant message yet");

// A follow-up sends the whole saved history, reasoning included, the answer's own too.
assert.match(await ask({ question: "and now?", backend: "openrouter", continue: true }), /Still Angua/);
const kept = assistants(openrouter.requests[2]);
assert.deepEqual(kept[0].reasoning_details, OR.reasoning_details);
assert.equal(kept[1].reasoning, "Done.");

// DeepSeek's field, which its API requires back on every assistant message once tools are in use.
await ask({ question: "who is on duty at Cable Street?", backend: "deepseek" });
assert.equal(assistants(deepseek.requests[1])[0].reasoning_content, DS.reasoning_content);
assert.ok(!("reasoning" in assistants(deepseek.requests[1])[0]));

// Code-block mode keeps it on the cell's message too.
await ask({ question: "who is on duty at Cable Street?", backend: "blocks" });
const cellMsg = assistants(blocks.requests[1])[0];
assert.match(cellMsg.content, /```js/);
assert.equal(cellMsg.reasoning_content, DS.reasoning_content);

// A provider that refuses the fields: the step goes again without them, and so does every later request.
assert.match(await ask({ question: "who is on duty at Cable Street?", backend: "strict" }), /Angua/);
assert.equal(strict.requests.length, 3, "one refused request, then the same step again");
assert.ok(carries(strict.requests[1]) && !carries(strict.requests[2]));
assert.equal(assistants(strict.requests[2])[0].tool_calls[0].function.name, "repl", "the retried request still holds the call");

const rows = fs.readFileSync(path.join(state, "watch", "reasoning-test.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((r) => r.type === "ask");
const by = (b) => rows.filter((r) => r.backend === b);
assert.equal(by("openrouter")[0].reasoningBack, 2, "both replies of the first ask carried reasoning");
assert.equal(by("deepseek")[0].reasoningBack, 2);
assert.equal(by("strict")[0].reasoningRefused, true);
assert.ok(!("reasoningRefused" in by("openrouter")[0]));

await client.close();
for (const f of [openrouter, deepseek, strict, blocks]) await f.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log("ok");
process.exit(0);
