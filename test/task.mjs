// A slow ask answered as an MCP task (the Tasks extension, protocol revision 2026-07-28), with a
// scripted backend: a client that accepts tasks gets a task id once the ask has run for
// config.taskAfterSeconds and collects the answer with tasks/get; a quick ask and a client on an
// earlier revision get the plain answer. No network, no model.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fakeBackend } from "./fixtures/shot-kit/fake-backend.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVE = [path.join(ROOT, "bin", "ask-kit.mjs"), "serve"];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ask-kit-task-"));
const HOLD_MS = 1500;
const ANSWER = "Angua is on duty at Cable Street (scripts.run duty).";
const TASKS = "io.modelcontextprotocol/tasks";

// One router with its own config, state and backend.
async function setUp(name, steps, extra = {}) {
  const config = path.join(tmp, name, "config");
  const state = path.join(tmp, name, "state");
  fs.cpSync(path.join(ROOT, "test", "fixtures", "shot-kit"), path.join(config, "kits", "watch"), { recursive: true });
  const fake = await fakeBackend(steps);
  fs.writeFileSync(path.join(config, "config.json"), JSON.stringify({ version: 1, sources: [], backends: { default: "fake", list: { fake: fake.backend } }, domains: { watch: {} }, taskAfterSeconds: 0.3, ...extra }));
  return { fake, state, env: { ...process.env, ASK_KIT_CONFIG: config, ASK_KIT_STATE: state, ASK_KIT_SESSION: `task-${name}` } };
}

// A client on revision 2026-07-28, written out as JSON lines: every request carries the envelope,
// and with it whether this client takes a task for an answer.
function modernClient(env, { tasks = true } = {}) {
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
  const meta = {
    "io.modelcontextprotocol/protocolVersion": "2026-07-28",
    "io.modelcontextprotocol/clientInfo": { name: "test", version: "0" },
    "io.modelcontextprotocol/clientCapabilities": tasks ? { extensions: { [TASKS]: {} } } : {},
  };
  const request = (method, params = {}) =>
    new Promise((resolve) => {
      waiting.set(++id, resolve);
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params: { ...params, _meta: meta } }) + "\n");
    });
  return { request, ask: (args) => request("tools/call", { name: "ask", arguments: args }), close: () => child.kill() };
}
const textOf = (r) => r.content.map((c) => c.text).join("\n");
const until = async (fn, ms = 10_000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 50))) {
    const v = await fn();
    if (v) return v;
  }
  assert.fail("timed out waiting");
};

// 1. A slow ask becomes a task; tasks/get reports it working, then gives the answer.
{
  const { fake, state, env } = await setUp("slow", [{ code: '// who is at Cable Street\n(await scripts.run("duty", { post: "Cable Street" })).officers' }, { delayMs: HOLD_MS, answer: ANSWER }]);
  const c = modernClient(env);
  const found = await c.request("server/discover");
  assert.deepEqual(found.result.capabilities.extensions, { [TASKS]: {} }, "the server says it supports tasks");
  const t0 = Date.now();
  const { result: task } = await c.ask({ question: "who is on duty at Cable Street?" });
  assert.equal(task.resultType, "task");
  assert.equal(task.status, "working");
  assert.match(task.taskId, /^ask-[0-9a-f]{12}$/);
  assert.ok(Date.now() - t0 < HOLD_MS, "the call returned before the ask ended");
  for (const k of ["createdAt", "lastUpdatedAt", "ttlMs", "pollIntervalMs"]) assert.ok(task[k] != null, `the task carries ${k}`);
  const working = (await c.request("tasks/get", { taskId: task.taskId })).result;
  assert.equal(working.resultType, "complete");
  assert.equal(working.status, "working");
  const noted = await until(async () => {
    const r = (await c.request("tasks/get", { taskId: task.taskId })).result;
    return r.statusMessage || r.status !== "working" ? r : null;
  });
  assert.match(noted.statusMessage ?? "", /^cell 1: /, "the task says what the investigator ran last");
  const done = await until(async () => {
    const r = (await c.request("tasks/get", { taskId: task.taskId })).result;
    return r.status === "working" ? null : r;
  });
  assert.equal(done.status, "completed");
  assert.equal(textOf(done.result), ANSWER);
  assert.ok(!done.result.isError);
  const unknown = await c.request("tasks/get", { taskId: "ask-000000000000" });
  assert.equal(unknown.error.code, -32602, "an id this server does not hold is invalid params");
  const rows = fs.readFileSync(path.join(state, "router", "task-slow.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const row = rows.find((r) => r.task);
  assert.equal(row.task, task.taskId, "the router's journal says which ask became a task");
  assert.ok(row.afterMs >= 300);
  const ends = rows.filter((r) => r.task === task.taskId && r.done);
  assert.equal(ends.length, 1, "the router's journal says once how the task ended");
  assert.equal(ends[0].done, "answered");
  assert.ok(ends[0].ms >= row.afterMs);
  c.close();
  await fake.close();
}

// 2. An ask that ends before the delay is answered in the call.
{
  const { fake, env } = await setUp("quick", [{ answer: ANSWER }], { taskAfterSeconds: 30 });
  const c = modernClient(env);
  const { result } = await c.ask({ question: "who is on duty at Cable Street?" });
  assert.equal(result.resultType, "complete");
  assert.equal(textOf(result), ANSWER);
  c.close();
  await fake.close();
}

// 3. A cancelled task stops and stays cancelled.
{
  const { fake, state, env } = await setUp("cancel", [{ delayMs: HOLD_MS, answer: ANSWER }]);
  const c = modernClient(env);
  const { result: task } = await c.ask({ question: "who is on duty at Cable Street?" });
  assert.equal(task.resultType, "task");
  const ack = await c.request("tasks/cancel", { taskId: task.taskId });
  assert.ok(ack.result && !ack.error);
  assert.equal((await c.request("tasks/get", { taskId: task.taskId })).result.status, "cancelled");
  await new Promise((r) => setTimeout(r, HOLD_MS + 300));
  assert.equal((await c.request("tasks/get", { taskId: task.taskId })).result.status, "cancelled", "the ask ending later does not change it");
  // The journal says once that it was cancelled; the aborted ask ending later adds no "failed" row.
  const ends = fs.readFileSync(path.join(state, "router", "task-cancel.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((r) => r.task === task.taskId && r.done);
  assert.deepEqual(ends.map((r) => r.done), ["cancelled"]);
  assert.ok(ends[0].ms < HOLD_MS, "it was cancelled while the ask was still running");
  c.close();
  await fake.close();
}

// 4. A client that does not take tasks waits for the answer: one on 2026-07-28 without the
//    extension, and one on an earlier revision.
{
  const { fake, env } = await setUp("plain", [{ delayMs: 700, answer: ANSWER }]);
  const c = modernClient(env, { tasks: false });
  const { result } = await c.ask({ question: "who is on duty at Cable Street?" });
  assert.equal(result.resultType, "complete");
  assert.equal(textOf(result), ANSWER);
  c.close();
  const old = new Client({ name: "test", version: "0" });
  await old.connect(new StdioClientTransport({ command: process.execPath, args: SERVE, env: { ...env, ASK_KIT_SESSION: "task-old" }, stderr: "inherit" }));
  const r = await old.callTool({ name: "ask", arguments: { question: "who is on duty at Cable Street?" } });
  assert.ok(!r.isError && !r.taskId, textOf(r));
  assert.equal(textOf(r), ANSWER);
  await old.close();
  await fake.close();
}

// 5. taskAfterSeconds: 0 turns tasks off.
{
  const { fake, env } = await setUp("off", [{ delayMs: 700, answer: ANSWER }], { taskAfterSeconds: 0 });
  const c = modernClient(env);
  const { result } = await c.ask({ question: "who is on duty at Cable Street?" });
  assert.equal(result.resultType, "complete");
  assert.equal(textOf(result), ANSWER);
  c.close();
  await fake.close();
}

// 6. Follow-ups by task id. Two asks overlap, each its own task; a follow-up names one by its id
//    and reaches that ask's investigator, with the other ask asked in between. The backend answers
//    from the conversation it is sent, so the answer shows which conversation it was.
{
  const said = (body) => body.messages.filter((m) => m.role === "user").map((m) => (typeof m.content === "string" ? m.content : "").split("\n")[0]);
  const reply = (body) => {
    const users = said(body);
    const q = users.at(-1);
    if (users.length > 1) return { delayMs: /slowly/.test(q) ? 800 : 0, answer: `after [${users.slice(0, -1).join(" | ")}]: ${q}` };
    return { delayMs: 700, answer: /Cable Street/.test(q) ? ANSWER : "Carrot is on duty at Pseudopolis Yard." };
  };
  const { fake, state, env } = await setUp("follow", [reply]);
  const c = modernClient(env);
  const done = (id) => until(async () => {
    const r = (await c.request("tasks/get", { taskId: id })).result;
    return r.status === "working" ? null : r;
  });
  const [a, b] = (await Promise.all([c.ask({ question: "who is on duty at Cable Street?" }), c.ask({ question: "who is on duty at Pseudopolis Yard?" })])).map((r) => r.result);
  assert.equal(a.resultType, "task");
  assert.equal(b.resultType, "task");
  assert.notEqual(a.taskId, b.taskId);
  assert.equal(textOf((await done(a.taskId)).result), ANSWER);
  assert.match(textOf((await done(b.taskId)).result), /Carrot/);

  // The follow-up to the first ask, sent after the second: it holds the first conversation only.
  // A follow-up may itself take longer than the hand-off delay on a busy machine: read it either way.
  const answerOf = async (r) => (r.resultType === "task" ? textOf((await done(r.taskId)).result) : textOf(r));
  const f1 = (await c.ask({ question: "who relieves them?", continue: a.taskId })).result;
  assert.equal(await answerOf(f1), "after [who is on duty at Cable Street?]: who relieves them?");
  const f2 = (await c.ask({ question: "who relieves them?", continue: b.taskId })).result;
  assert.equal(await answerOf(f2), "after [who is on duty at Pseudopolis Yard?]: who relieves them?");
  // A second follow-up by the same id carries on that conversation.
  const f3 = (await c.ask({ question: "since when?", continue: a.taskId })).result;
  assert.equal(await answerOf(f3), "after [who is on duty at Cable Street? | who relieves them?]: since when?");

  // A follow-up that is slow becomes a task with an id of its own; that id and the first both reach the conversation.
  const slow = (await c.ask({ question: "answer slowly: who was there last week?", continue: b.taskId })).result;
  assert.equal(slow.resultType, "task");
  assert.notEqual(slow.taskId, b.taskId);
  // Sent while that one is still running: it waits its turn and sees the slow follow-up's answer.
  const queued = (await c.ask({ question: "and the week before?", continue: slow.taskId })).result;
  const queuedText = queued.resultType === "task" ? textOf((await done(queued.taskId)).result) : textOf(queued);
  assert.equal(queuedText, "after [who is on duty at Pseudopolis Yard? | who relieves them? | answer slowly: who was there last week?]: and the week before?");
  await done(slow.taskId);

  // continue: true still means the last ask, and an id this server never gave is refused in words.
  const last = (await c.ask({ question: "last one?", continue: true })).result;
  assert.match(await answerOf(last), /^after \[who is on duty at Pseudopolis Yard\?.*\]: last one\?$/);
  const none = (await c.ask({ question: "who relieves them?", continue: "ask-000000000000" })).result;
  assert.ok(none.isError);
  assert.match(textOf(none), /no ask with the id "ask-000000000000"/);
  // The newest five; which ones depends on how many follow-ups became tasks.
  assert.match(textOf(none), /Kept: .*ask-[0-9a-f]{12} \(watch: "/, "the refusal lists the ids that are kept");

  // The router's journal ties a follow-up to the ask it continues.
  const rows = fs.readFileSync(path.join(state, "router", "task-follow.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.ok(rows.some((r) => r.how === "follow-up" && r.continues === a.taskId));
  c.close();

  // A new router process for the same session still knows the id.
  const c2 = modernClient(env);
  let again = (await c2.ask({ question: "still there?", continue: a.taskId })).result;
  if (again.resultType === "task") {
    const id = again.taskId;
    again = (await until(async () => {
      const r = (await c2.request("tasks/get", { taskId: id })).result;
      return r.status === "working" ? null : r;
    })).result;
  }
  assert.match(textOf(again), /^after \[who is on duty at Cable Street\? \| who relieves them\? \| since when\?\]: still there\?$/);
  c2.close();
  await fake.close();
}

// 6b. A task still running when the router process ends is journalled as stopped.
{
  const { fake, state, env } = await setUp("stopped", [{ delayMs: 3000, answer: ANSWER }]);
  const c = modernClient(env);
  const { result: task } = await c.ask({ question: "who is on duty at Cable Street?" });
  assert.equal(task.resultType, "task");
  c.close();
  const file = path.join(state, "router", "task-stopped.jsonl");
  const end = await until(() => fs.readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l)).find((r) => r.task === task.taskId && r.done));
  assert.equal(end.done, "stopped");
  await fake.close();
}

// 7. wait: false hands the task back at once, long before the delay.
{
  const { fake, env } = await setUp("sendoff", [{ delayMs: 600, answer: ANSWER }], { taskAfterSeconds: 30 });
  const c = modernClient(env);
  const t0 = Date.now();
  const { result: task } = await c.ask({ question: "who is on duty at Cable Street?", wait: false });
  assert.equal(task.resultType, "task");
  assert.ok(Date.now() - t0 < 600, "the task came back before the ask ended");
  const done = await until(async () => {
    const r = (await c.request("tasks/get", { taskId: task.taskId })).result;
    return r.status === "working" ? null : r;
  });
  assert.equal(textOf(done.result), ANSWER);
  // An ask that cannot start is still answered in the call.
  const bad = (await c.ask({ wait: false })).result;
  assert.equal(bad.resultType, "complete");
  assert.ok(bad.isError);
  c.close();
  await fake.close();
}

// 8. An early answer inside a task: the task ends with the main fact and names its own id for the
//    rest, and a follow-up by that id collects what the run went on to find.
{
  const { fake, env } = await setUp("early", [
    { delayMs: 500, tool: "early_answer", args: { answer: ANSWER } },
    { delayMs: 600, code: '(await scripts.run("duty", { post: "Pseudopolis Yard" })).officers' },
    { answer: "Angua is at Cable Street; Pseudopolis Yard has Sam Vimes and Carrot Ironfoundersson." },
  ]);
  const c = modernClient(env);
  const settle = async (r) => {
    if (r.resultType !== "task") return { id: null, text: textOf(r) };
    const d = await until(async () => {
      const g = (await c.request("tasks/get", { taskId: r.taskId })).result;
      return g.status === "working" ? null : g;
    });
    return { id: r.taskId, text: textOf(d.result) };
  };
  const first = await settle((await c.ask({ question: "who is on duty at Cable Street, and who else is on duty?" })).result);
  assert.ok(first.id, "the ask became a task before its early answer");
  assert.ok(first.text.startsWith(ANSWER));
  assert.ok(first.text.includes(`more is coming: ask again with continue: "${first.id}"`), first.text);
  const rest = await settle((await c.ask({ question: "the rest", continue: first.id })).result);
  assert.match(rest.text, /Pseudopolis Yard has Sam Vimes and Carrot Ironfoundersson/);
  assert.match(rest.text, /the rest of your earlier question/);
  assert.equal(fake.requests.length, 3, "the follow-up collected the run and asked the model nothing more");
  // Whichever id the caller holds now, it reaches the finished conversation.
  for (const id of new Set([first.id, rest.id].filter(Boolean))) {
    const more = await settle((await c.ask({ question: "and tomorrow?", continue: id })).result);
    assert.match(more.text, /Pseudopolis Yard/, `continue: "${id}" carries on the conversation`);
  }
  c.close();
  await fake.close();
}

// 9. An early answer that comes inside the call says continue: true, and continue: true from a
//    client that takes tasks still collects the rest of that run.
{
  const { fake, env } = await setUp(
    "early-inline",
    [
      { tool: "early_answer", args: { answer: ANSWER } },
      { delayMs: 600, code: '(await scripts.run("duty", { post: "Pseudopolis Yard" })).officers' },
      { answer: "Angua is at Cable Street; Pseudopolis Yard has Sam Vimes and Carrot Ironfoundersson." },
      (body) => ({ answer: `after ${body.messages.filter((m) => m.role === "user").length} questions` }),
    ],
    { taskAfterSeconds: 30 },
  );
  const c = modernClient(env);
  const first = (await c.ask({ question: "who is on duty at Cable Street, and who else is on duty?" })).result;
  assert.equal(first.resultType, "complete");
  assert.match(textOf(first), /more is coming: ask again with continue: true/);
  const rest = (await c.ask({ question: "the rest", continue: true })).result;
  assert.ok(!rest.isError, textOf(rest));
  assert.match(textOf(rest), /Pseudopolis Yard has Sam Vimes and Carrot Ironfoundersson/);
  assert.equal(fake.requests.length, 3);
  // The conversation goes on from there.
  const more = (await c.ask({ question: "and tomorrow?", continue: true })).result;
  assert.equal(textOf(more), "after 2 questions");
  c.close();
  await fake.close();
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log("ok");
process.exit(0);
