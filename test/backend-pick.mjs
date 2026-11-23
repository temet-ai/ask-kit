// A backend that refuses an ask for its key (402, as OpenRouter past a key's limit): the person
// picks another backend in a form (MCP elicitation) and the ask is answered by it; "from now on"
// changes the config. A client that shows no forms is told the choices. Scripted backends, no model.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { backendChoices, refusalOf, replaceBackend } from "../src/router.mjs";
import { fakeBackend } from "./fixtures/shot-kit/fake-backend.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVE = [path.join(ROOT, "bin", "ask-kit.mjs"), "serve"];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ask-kit-pick-"));
const ANSWER = "Carrot is on duty at Pseudopolis Yard.";
const QUESTION = "who is on duty at Pseudopolis Yard?";
const LIMIT = { message: "Key limit exceeded (monthly limit). Manage it using https://example.com/keys/WATCH-12 $20.00 of $20.00 used; resets 2026-12-01T00:00:00.000Z.", code: 403 };

// The parts on their own.
{
  const list = { broke: { kind: "api", preset: "openrouter", model: "vetinari/flash", key: { env: "WATCH_KEY" } }, twin: { kind: "api", preset: "openrouter", model: "vetinari/pro", key: { env: "WATCH_KEY" } }, cli: { kind: "claude-cli", model: "haiku" } };
  const r = refusalOf(`ask failed (broke): openrouter 403: ${JSON.stringify(LIMIT)}`, list);
  assert.equal(r.backend, "broke");
  assert.equal(r.reason, "Key limit exceeded (monthly limit). $20.00 of $20.00 used; resets 2026-12-01T00:00:00.000Z.", "the provider's message, without its link");
  assert.equal(refusalOf("ask failed (broke): the calling client cancelled the ask", list), null, "a cancel is not a refusal");
  assert.equal(refusalOf("ask failed (vimes): openrouter 403: {}", list), null, "a backend the config does not hold");
  const c = backendChoices(list, "broke");
  assert.deepEqual(c.map((x) => x.name), ["cli", "twin"], "another account first, the same key last");
  assert.match(c[1].label, /same key, likely refused too/);
  const cfg = replaceBackend({ backends: { default: "broke" }, router: { backend: "broke" }, hedge: { backend: "twin" }, domains: { watch: { backend: "broke" }, docs: {} } }, "broke", "cli");
  assert.deepEqual([cfg.backends.default, cfg.router.backend, cfg.hedge.backend, cfg.domains.watch.backend], ["cli", "cli", "twin", "cli"]);
}

const broke = await fakeBackend([{ status: 402, error: LIMIT }]);
const spare = await fakeBackend([{ answer: ANSWER }]);
function setUp(name, extra = {}) {
  const config = path.join(tmp, name, "config");
  fs.cpSync(path.join(ROOT, "test", "fixtures", "shot-kit"), path.join(config, "kits", "watch"), { recursive: true });
  fs.writeFileSync(path.join(config, "config.json"), JSON.stringify({ version: 1, sources: [], backends: { default: "broke", list: { broke: broke.backend, spare: spare.backend } }, domains: { watch: {} }, ...extra }));
  return { config, env: { ...process.env, ASK_KIT_CONFIG: config, ASK_KIT_STATE: path.join(tmp, name, "state"), ASK_KIT_SESSION: `pick-${name}` } };
}
async function legacy(name, onForm) {
  const { config, env } = setUp(name);
  const client = new Client({ name: "test", version: "0" }, { capabilities: onForm ? { elicitation: {} } : {} });
  const forms = [];
  if (onForm) client.setRequestHandler(ElicitRequestSchema, async (req) => (forms.push(req.params), onForm(req.params)));
  await client.connect(new StdioClientTransport({ command: process.execPath, args: SERVE, env, stderr: "inherit" }));
  const res = await client.callTool({ name: "ask", arguments: { question: QUESTION } });
  await client.close();
  return { res, forms, config: JSON.parse(fs.readFileSync(path.join(config, "config.json"), "utf8")) };
}
const text = (r) => r.content.map((c) => c.text).join("\n");

// 1. The person picks spare, from now on: spare answers, and the config defaults to it.
{
  const { res, forms, config } = await legacy("accept", () => ({ action: "accept", content: { backend: "spare", always: true } }));
  assert.equal(forms.length, 1, "one form");
  assert.match(forms[0].message, /^broke refused this ask: Key limit exceeded \(monthly limit\)\. \$20\.00 of \$20\.00 used/);
  assert.deepEqual(forms[0].requestedSchema.properties.backend.oneOf.map((o) => o.const), ["spare"]);
  assert.ok(!res.isError, text(res));
  assert.equal(text(res), ANSWER);
  assert.equal(config.backends.default, "spare", "from now on: the default is spare");
}

// 2. The person declines: the refusal comes back, saying no other backend was chosen.
{
  const { res, config } = await legacy("decline", () => ({ action: "decline" }));
  assert.ok(res.isError);
  assert.match(text(res), /^ask failed \(broke\): custom 402:/);
  assert.match(text(res), /chose no other backend/);
  assert.equal(config.backends.default, "broke");
}

// 3. A client that shows no forms is told the choices, to put to the person.
{
  const { res } = await legacy("noforms", null);
  assert.ok(res.isError);
  assert.match(text(res), /Other backends in ask-kit's config: spare: fake on custom\. Ask the user which one to use, then send the same ask again with backend: "<name>"/);
}

// 4. Revision 2026-07-28: input_required with the form, then the same call with the answer.
{
  const { env } = setUp("modern");
  const child = spawn(process.execPath, SERVE, { env, stdio: ["pipe", "pipe", "inherit"] });
  const waiting = new Map();
  let buf = "";
  let id = 0;
  child.stdout.on("data", (d) => {
    buf += d;
    for (let i; (i = buf.indexOf("\n")) >= 0; ) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      const m = JSON.parse(line);
      waiting.get(m.id)?.(m);
      waiting.delete(m.id);
    }
  });
  const meta = { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientInfo": { name: "test", version: "0" }, "io.modelcontextprotocol/clientCapabilities": { elicitation: { form: {} } } };
  const call = (extra = {}) =>
    new Promise((resolve) => {
      waiting.set(++id, resolve);
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "ask", arguments: { question: QUESTION }, ...extra, _meta: meta } }) + "\n");
    });
  const first = (await call()).result;
  assert.equal(first.resultType, "input_required", JSON.stringify(first));
  const [key] = Object.keys(first.inputRequests);
  assert.equal(key, "backend:broke");
  assert.equal(first.inputRequests[key].method, "elicitation/create");
  const second = (await call({ inputResponses: { [key]: { action: "accept", content: { backend: "spare" } } } })).result;
  assert.ok(!second.isError, JSON.stringify(second));
  assert.equal(text(second), ANSWER);
  child.kill();
}

await broke.close();
await spare.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log("ok");
