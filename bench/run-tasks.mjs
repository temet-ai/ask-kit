// Runs the question set through the router (`ask-kit serve`, every domain behind one `ask`) the way
// a calling agent would, in one of three modes, and writes one JSONL row per question in the shape
// run-ask.mjs writes, so grade.mjs grades it. It measures what answering as a task changes: how long
// the caller is held by each call, how long each answer takes to arrive, and how long the set takes.
//
//   serial  the client takes no tasks: every ask is answered in its call, one after the other
//   tasks   the client takes tasks: a slow ask is handed back after config.taskAfterSeconds and the
//           next question is sent while it runs; a follow-up names its parent's task id
//   nowait  every ask is sent with wait: false, a follow-up at once behind its parent
//
//   ASK_KIT_CONFIG=<scratch> ASK_KIT_STATE=<scratch> \
//   node bench/run-tasks.mjs --mode serial|tasks|nowait --out <file.jsonl> [--backend <name>] \
//     [--set sessions|code|all] [--repos ask-kit=<clone>,omarchy=<clone>] [--only id,id] \
//     [--parallel 4] [--timeout 600] [--note " (Ignore session ...)"]
//
// --parallel caps how many asks run at once in tasks and nowait mode. One router per (domain, repo).
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { loadQuestions } from "./paths.mjs";

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const mode = arg("mode");
const backend = arg("backend");
const set = arg("set", "all");
const out = arg("out");
const only = arg("only")?.split(",");
const parallel = Number(arg("parallel", "4"));
const timeoutSeconds = Number(arg("timeout", "600"));
const repos = Object.fromEntries((arg("repos", "") || "").split(",").filter(Boolean).map((kv) => kv.split("=")));
if (!["serial", "tasks", "nowait"].includes(mode) || !out || !process.env.ASK_KIT_STATE || !process.env.ASK_KIT_CONFIG) {
  console.error("needs --mode serial|tasks|nowait, --out, and ASK_KIT_CONFIG / ASK_KIT_STATE set to scratch folders");
  process.exit(2);
}
const spec = loadQuestions();
const note = arg("note", spec.sessionsNote ?? "");
const qs = spec.questions.filter((q) => (set === "all" || q.domain === set) && (!only || only.includes(q.id) || only.includes(q.followupOf)));
const TASKS = "io.modelcontextprotocol/tasks";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const textOf = (r) => (r?.content ?? []).map((c) => c.text).join("\n");

// A client on revision 2026-07-28 over stdio, as JSON lines.
function client(env, cwd, takesTasks) {
  const child = spawn(process.execPath, [path.join(ROOT, "bin", "ask-kit.mjs"), "serve"], { env, cwd, stdio: ["pipe", "pipe", "ignore"] });
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
    "io.modelcontextprotocol/clientInfo": { name: "ask-kit-bench", version: "0" },
    "io.modelcontextprotocol/clientCapabilities": takesTasks ? { extensions: { [TASKS]: {} } } : {},
  };
  const request = (method, params = {}) =>
    new Promise((resolve) => {
      waiting.set(++id, resolve);
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params: { ...params, _meta: meta } }) + "\n");
    });
  return { request, close: () => child.kill() };
}

// The newest "ask" row for this question, from the domain servers' journals.
function askRow(session, question) {
  const hits = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory() && e.name !== "warm" && e.name !== "router") walk(full);
      else if (e.name === `${session}.jsonl`) hits.push(full);
    }
  };
  walk(process.env.ASK_KIT_STATE);
  let found = {};
  for (const f of hits)
    for (const l of fs.readFileSync(f, "utf8").trim().split("\n")) {
      const e = JSON.parse(l);
      if (e.type === "ask" && e.question === question && (!found.ts || e.ts > found.ts)) found = e;
    }
  return found;
}

const groups = new Map();
for (const q of qs) {
  const key = q.domain === "code" ? `code:${q.repo}` : q.domain;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(q);
}

for (const [key, list] of groups) {
  const [domain, repo] = key.split(":");
  const session = `bench-${mode}-${repo ?? domain}`;
  const cwd = repo ? repos[repo] : process.cwd();
  if (repo && !cwd) throw new Error(`--repos needs ${repo}=<path>`);
  const c = client({ ...process.env, ASK_KIT_SESSION: session, ...(repo ? { ASK_KIT_CODE_ROOT: cwd } : {}) }, cwd, mode !== "serial");
  const t0 = Date.now();
  const sent = new Map(); // question id → { taskId, done: Promise }
  let working = 0;

  const ask = async (q) => {
    const question = q.domain === "sessions" ? q.question + note : q.question;
    const parent = q.followupOf ? sent.get(q.followupOf) : null;
    // A follow-up waits for its parent in the caller only when the parent has no task id to name.
    if (parent && !parent.taskId) await parent.done;
    while (mode !== "serial" && working >= parallel) await sleep(200);
    working++;
    const args = {
      question,
      about: domain,
      timeoutSeconds,
      ...(backend ? { backend } : {}),
      ...(q.followupOf ? { continue: parent?.taskId ?? true } : {}),
      ...(mode === "nowait" ? { wait: false } : {}),
    };
    const sentMs = Date.now();
    const first = (await c.request("tools/call", { name: "ask", arguments: args })).result;
    const heldMs = Date.now() - sentMs;
    const entry = { taskId: first?.resultType === "task" ? first.taskId : null };
    sent.set(q.id, entry);
    entry.done = (async () => {
      let result = first;
      let failure = null;
      if (entry.taskId)
        for (;;) {
          await sleep(1000);
          const r = (await c.request("tasks/get", { taskId: entry.taskId })).result;
          if (!r || r.status === "working") continue;
          result = r.result;
          if (r.status !== "completed") failure = `task ${r.status}: ${r.error?.message ?? r.statusMessage ?? ""}`;
          break;
        }
      working--;
      const wallMs = Date.now() - sentMs;
      const text = failure ?? textOf(result);
      const footer = text.match(/\n\n\[[a-z]+ · [^\]]+\]\s*$/);
      const answer = footer ? text.slice(0, footer.index).trim() : text;
      const j = askRow(session, question);
      const row = {
        id: q.id,
        domain: q.domain,
        repo: repo ?? null,
        backend: j.backend ?? backend ?? null,
        run: mode,
        mode,
        continued: !!q.followupOf,
        task: entry.taskId,
        ok: !failure && !result?.isError,
        partial: !!j.partial,
        atLimit: !!j.atLimit,
        sentAtMs: sentMs - t0,
        heldMs,
        wallMs,
        ms: j.ms ?? null,
        costUsd: j.costUsd ?? null,
        cells: j.cells ?? null,
        turns: j.turns ?? null,
        usage: j.usage ?? null,
        missteps: j.missteps ?? null,
        error: j.error ?? (failure || result?.isError ? answer.slice(0, 300) : null),
        callerChars: question.length + text.length + (entry.taskId ? JSON.stringify(first).length : 0),
        answer,
      };
      fs.appendFileSync(out, JSON.stringify(row) + "\n");
      console.log(`${mode} ${q.id.padEnd(24)} ${row.ok ? "ok " : "ERR"}${row.partial ? " partial" : ""} held ${(heldMs / 1000).toFixed(1)}s answer ${Math.round(wallMs / 1000)}s $${(row.costUsd ?? 0).toFixed(4)} ${row.cells ?? "-"} cells`);
    })();
    // In serial mode, and whenever the call itself carried the answer, the caller had it before going on.
    if (!entry.taskId) await entry.done;
  };

  // The caller sends one call at a time, as Claude Code does; a call that hands back a task frees it.
  for (const q of list) await ask(q);
  await Promise.all([...sent.values()].map((e) => e.done));
  fs.appendFileSync(out.replace(/\.jsonl$/, ".groups.jsonl"), JSON.stringify({ mode, group: key, questions: list.length, elapsedMs: Date.now() - t0 }) + "\n");
  console.log(`${mode} ${key}: ${list.length} questions in ${Math.round((Date.now() - t0) / 1000)}s`);
  c.close();
}
