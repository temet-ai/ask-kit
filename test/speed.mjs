// Speed paths of the api loop, with scripted backends: no network, no model.
//   escalate  past twice the kit's usual time (the median of its journaled asks) a stronger backend
//             finishes the ask in the same REPL, with a trace of what was tried; a follow-up
//             continues its conversation
//   body      a backend's `body` fields are merged into each investigator request
//   hedge     past `after` seconds a second backend takes the question; the first answer wins
//   opener    a kit action's pattern found inside a longer question runs its script before the
//             first model call, and the result is in the first message
//   fan-out   the work-loop text says independent searches run together with Promise.all
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fakeBackend } from "./fixtures/shot-kit/fake-backend.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ask-kit-speed-"));
const textOf = (r) => r.content.map((c) => c.text).join("\n");
const clients = [];
const fakes = [];

// One config and state per case, so each server reads its own escalate/hedge settings.
async function start(name, fixture, cfg, seed = []) {
  const config = path.join(tmp, name, "config");
  const state = path.join(tmp, name, "state");
  fs.cpSync(path.join(ROOT, "test", "fixtures", fixture), path.join(config, "kits", "watch"), { recursive: true });
  fs.writeFileSync(path.join(config, "config.json"), JSON.stringify({ version: 1, sources: [], domains: { watch: {} }, ...cfg }));
  if (seed.length) {
    fs.mkdirSync(path.join(state, "watch"), { recursive: true });
    fs.writeFileSync(path.join(state, "watch", "earlier-use.jsonl"), seed.map((r) => JSON.stringify(r)).join("\n") + "\n");
  }
  const session = `speed-${name}`;
  const env = { ...process.env, ASK_KIT_CONFIG: config, ASK_KIT_STATE: state, ASK_KIT_DOMAIN: "watch", ASK_KIT_SESSION: session };
  const client = new Client({ name: "test", version: "0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, "src", "server.mjs")], env, stderr: "inherit" }));
  clients.push(client);
  const rows = () => fs.readFileSync(path.join(state, "watch", `${session}.jsonl`), "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((r) => r.type === "ask");
  return { client, rows };
}
const fake = async (steps) => {
  const f = await fakeBackend(steps);
  fakes.push(f);
  return f;
};

// ---- escalate, with the kit's usual time from the journal, and body passthrough ----
{
  // Five earlier asks of 1.5 s: the usual time is 1.5 s, so the ask escalates at 3 s.
  const seed = Array.from({ length: 5 }, () => ({ ts: new Date().toISOString(), session: "earlier", type: "ask", backend: "weak", ms: 1500 }));
  const weak = await fake([
    { code: 'const cable = await scripts.run("duty", { post: "Cable Street" }); cable.officers' },
    { delayMs: 20_000, answer: "too late" },
    { answer: "Follow-up from the weak backend." },
  ]);
  const strong = await fake([{ code: "cable.officers.join(', ')" }, { answer: "Angua is on duty at Cable Street (scripts.run duty, then cable.officers)." }]);
  const { client, rows } = await start("escalate", "shot-kit", {
    backends: { default: "weak", list: { weak: { ...weak.backend, body: { provider: { order: ["ankh-morpork"] } } }, strong: strong.backend } },
    escalate: { backend: "strong" },
  }, seed);
  const t0 = Date.now();
  const r = await client.callTool({ name: "ask", arguments: { question: "who is on duty at Cable Street?" } });
  const ms = Date.now() - t0;
  const text = textOf(r);
  assert.ok(!r.isError, text);
  assert.match(text, /^Angua is on duty at Cable Street/, "the stronger backend's answer is the ask's");
  assert.ok(ms < 12_000, `it escalated instead of waiting out the stalled call (${ms} ms)`);
  assert.deepEqual(weak.requests[0].provider, { order: ["ankh-morpork"] }, "the backend's body is merged into the request");
  assert.equal(strong.requests[0].provider, undefined, "another backend's body is not");
  const handed = strong.requests[0].messages.findLast((m) => m.role === "user").content;
  assert.match(handed, /^who is on duty at Cable Street\?/);
  assert.match(handed, /Another investigator worked on this for \d+s without an answer, in this same REPL/);
  assert.match(handed, /scripts\.run\("duty", \{ post: "Cable Street" \}\)/, "the trace names the cell it ran");
  const cell = strong.requests[1].messages.findLast((m) => m.role === "tool").content;
  assert.match(cell, /Angua/, "the stronger backend read the weak one's variable: same REPL");
  const row = rows().at(-1);
  assert.equal(row.backend, "weak");
  assert.equal(row.escalated.to, "strong");
  assert.equal(row.escalated.cells, 1);
  assert.ok(row.escalated.atMs >= 2900 && row.escalated.atMs < 8000, `escalated at twice the usual time (${row.escalated.atMs} ms)`);
  assert.equal(row.cells, 2);
  assert.equal(row.turns, 3, "one answered call on the weak backend (the stalled one was cut off) and two on the strong one");

  const f = await client.callTool({ name: "ask", arguments: { question: "and at the Yard?", continue: true } });
  assert.match(textOf(f), /Follow-up from the weak backend/);
  const history = weak.requests[2].messages;
  assert.ok(history.some((m) => m.role === "assistant" && /^Angua is on duty at Cable Street/.test(m.content ?? "")), "a follow-up continues the stronger backend's conversation");
}

// ---- hedge: the second backend wins, then the first one does ----
{
  const first = await fake([{ delayMs: 20_000, answer: "slow" }, { delayMs: 1500, answer: "The first backend: Sam Vimes and Carrot Ironfoundersson." }]);
  const second = await fake([{ answer: "The hedge: Angua is on duty at Cable Street." }, { delayMs: 20_000, answer: "late" }]);
  const { client, rows } = await start("hedge", "shot-kit", {
    backends: { default: "first", list: { first: first.backend, second: second.backend } },
    hedge: { backend: "second", after: 1 },
  });
  const t0 = Date.now();
  const r = await client.callTool({ name: "ask", arguments: { question: "who is on duty at Cable Street?" } });
  const ms = Date.now() - t0;
  assert.match(textOf(r), /^The hedge: Angua/);
  assert.ok(ms >= 1000 && ms < 8000, `the hedge started after 1 s and answered first (${ms} ms)`);
  assert.deepEqual(rows().at(-1).hedge, { backend: "second", atMs: 1000, winner: "second" });
  assert.equal(second.requests[0].messages.findLast((m) => m.role === "user").content.startsWith("who is on duty at Cable Street?"), true, "the hedge got the same question");

  const r2 = await client.callTool({ name: "ask", arguments: { question: "who is on duty at Pseudopolis Yard?" } });
  assert.match(textOf(r2), /^The first backend: Sam Vimes/);
  assert.deepEqual(rows().at(-1).hedge, { backend: "second", atMs: 1000, winner: "first" });
  assert.equal(second.requests.length, 2, "the hedge was started and then stopped");
}

// ---- opener and the fan-out line ----
{
  const model = await fake([{ answer: "Angua is on duty at Cable Street; nobody else was asked for (the opening script)." }]);
  const { client, rows } = await start("opener", "action-kit", { backends: { default: "fake", list: { fake: model.backend } } });
  const r = await client.callTool({ name: "ask", arguments: { question: "who is on duty at Cable Street, and who else is on duty?" } });
  assert.match(textOf(r), /^Angua is on duty at Cable Street/);
  assert.equal(model.requests.length, 1, "the model answered from the first message");
  const firstMsg = model.requests[0].messages[1].content;
  assert.match(firstMsg, /^who is on duty at Cable Street, and who else is on duty\?/);
  assert.match(firstMsg, /Run for you before this message, because the question matches the kit's `duty` action/);
  assert.match(firstMsg, /"officers"[\s\S]*Angua/, "the script's result is in the first message");
  assert.match(model.requests[0].messages[0].content, /run together in one call with `await Promise\.all/, "the work loop says how to fan out");
  const row = rows().at(-1);
  assert.deepEqual({ ...row.opened, ms: 0 }, { action: "duty", script: "duty", params: { post: "Cable Street" }, ms: 0 });
  assert.equal(row.cells, 1);

  // A question that matches no action's pattern opens with nothing.
  const r2 = await client.callTool({ name: "ask", arguments: { question: "which posts are there?" } });
  assert.ok(!r2.isError);
  assert.doesNotMatch(model.requests[1].messages[1].content, /Run for you/);
  assert.equal(rows().at(-1).opened, undefined);
}

for (const c of clients) await c.close();
for (const f of fakes) f.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log("ok");
process.exit(0);
