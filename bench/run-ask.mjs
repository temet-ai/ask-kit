// Runs the question set (bench/questions.json, plus bench/private/questions.json when it exists; BENCH_QUESTIONS names another file, see bench/paths.mjs) through ask-kit's `ask` tool, one MCP server per domain (and per repo
// for code), and writes one JSONL row per question with the answer and the journal's numbers.
//
//   ASK_KIT_CONFIG=<scratch> ASK_KIT_STATE=<scratch> \
//   node bench/run-ask.mjs --backend glm-5.3-flash --set sessions|code|all --run 1 --out <file.jsonl> \
//     [--repos ask-kit=<clone>,mike-ask=<clone>] [--only id,id] [--timeout 600]
//
// Follow-ups (followUp: <id>) run right after their parent with continue: true, in the same caller
// session. Each (backend, run, domain, repo) gets its own caller session id, starting with "bench".
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import fs from "node:fs";
import path from "node:path";
import { loadQuestions } from "./paths.mjs";

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const backend = arg("backend");
const set = arg("set", "all");
const run = Number(arg("run", "1"));
const out = arg("out");
const only = arg("only")?.split(",");
const timeoutSeconds = Number(arg("timeout", "600"));
const repos = Object.fromEntries((arg("repos", "") || "").split(",").filter(Boolean).map((kv) => kv.split("=")));
if (!backend || !out || !process.env.ASK_KIT_STATE || !process.env.ASK_KIT_CONFIG) {
  console.error("needs --backend, --out, and ASK_KIT_CONFIG / ASK_KIT_STATE set to scratch folders");
  process.exit(2);
}
const spec = loadQuestions();
const qs = spec.questions.filter((q) => (set === "all" || q.domain === set) && (!only || only.includes(q.id) || only.includes(q.followupOf)));

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const slug = (s) => s.replace(/[^A-Za-z0-9._-]/g, "-");

// The newest "ask" line for this caller session, from the domain server's journal.
function lastAsk(session) {
  const files = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory() && e.name !== "warm") walk(full);
      else if (e.name === `${slug(session)}.jsonl`) files.push(full);
    }
  };
  walk(process.env.ASK_KIT_STATE);
  for (const f of files) {
    const lines = fs.readFileSync(f, "utf8").trim().split("\n").reverse();
    for (const l of lines) {
      const e = JSON.parse(l);
      if (e.type === "ask") return e;
    }
  }
  return {};
}

// Group: one server per (domain, repo).
const groups = new Map();
for (const q of qs) {
  const key = q.domain === "code" ? `code:${q.repo}` : "sessions";
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(q);
}

for (const [key, list] of groups) {
  const [domain, repo] = key.split(":");
  const session = `bench-${stamp}-${slug(backend)}-r${run}-${repo ?? domain}`;
  const cwd = repo ? repos[repo] : process.cwd();
  if (repo && !cwd) throw new Error(`--repos needs ${repo}=<path>`);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(ROOT, "bin", "ask-kit.mjs"), "serve", "--domain", domain],
    cwd,
    env: { ...process.env, ASK_KIT_SESSION: session, ...(repo ? { ASK_KIT_CODE_ROOT: cwd } : {}) },
    stderr: "pipe",
  });
  const client = new Client({ name: "ask-kit-bench", version: "0" });
  await client.connect(transport);
  // The `ask` tool as the calling agent sees it: its description and schema cost context too.
  const tools = await client.listTools();
  const askTool = tools.tools.find((t) => t.name === "ask");
  const toolChars = JSON.stringify(askTool ?? {}).length;
  let position = 0;
  for (const q of list) {
    const cont = !!q.followupOf;
    const question = q.domain === "sessions" ? q.question + (spec.sessionsNote ?? "") : q.question;
    const started = Date.now();
    let text = "";
    let isError = false;
    try {
      const res = await client.callTool({ name: "ask", arguments: { question, backend, timeoutSeconds, ...(cont ? { continue: true } : {}) } }, undefined, {
        timeout: (timeoutSeconds + 120) * 1000,
      });
      text = res.content.map((c) => c.text).join("\n");
      isError = !!res.isError;
    } catch (e) {
      text = `ERROR ${e.message}`;
      isError = true;
    }
    const wallMs = Date.now() - started;
    const footer = text.match(/\n\n\[[a-z]+ · [^\]]+\]\s*$/);
    const answer = footer ? text.slice(0, footer.index).trim() : text;
    const j = lastAsk(session);
    const row = {
      id: q.id,
      domain: q.domain,
      repo: repo ?? null,
      backend,
      run,
      position: position++,
      continued: cont,
      ok: !isError,
      partial: !!j.partial,
      atLimit: !!j.atLimit,
      wallMs,
      ms: j.ms ?? null,
      costUsd: j.costUsd ?? null,
      cells: j.cells ?? null,
      turns: j.turns ?? null,
      usage: j.usage ?? null,
      warm: j.warm ?? null,
      missteps: j.missteps ?? null,
      error: j.error ?? (isError ? answer.slice(0, 300) : null),
      callerChars: question.length + text.length,
      toolChars,
      answer,
    };
    fs.appendFileSync(out, JSON.stringify(row) + "\n");
    console.log(`${backend} r${run} ${q.id.padEnd(24)} ${row.ok ? "ok " : "ERR"}${row.partial ? " partial" : ""} ${Math.round(wallMs / 1000)}s $${(row.costUsd ?? 0).toFixed(4)} ${row.cells ?? "-"} cells`);
  }
  await client.close();
}
