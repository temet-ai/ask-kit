// Grades result rows against the question set (see paths.mjs) with an LLM judge (Sonnet through `claude -p`, no
// tools, its own system prompt), a dozen answers per call. Each verdict is correct, partial or
// wrong, with a one-sentence reason. Writes <in>.graded.jsonl beside each input file.
//
//   node bench/grade.mjs <results.jsonl> [...] [--model sonnet] [--cwd <neutral dir>]
//
// Rows already graded (same id, backend, run and answer) are kept, so a re-run only grades new rows.
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { loadQuestions } from "./paths.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const argv = process.argv.slice(2);
const opt = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  if (i < 0) return d;
  const v = argv[i + 1];
  argv.splice(i, 2);
  return v;
};
const model = opt("model", "sonnet");
const cwd = opt("cwd", process.cwd());
const files = argv;
const spec = loadQuestions();
const Q = Object.fromEntries(spec.questions.map((q) => [q.id, q]));

const SYSTEM =
  "You grade answers from a question-answering tool against a reference. For each item you get the question, the reference answer, " +
  "the facts the answer must contain, and the answer. Verdicts: \"correct\" when every required fact is present and correct (wording, " +
  "rounding and extra detail do not matter; a fact stated in other words counts); \"partial\" when at least one required fact is present " +
  "and correct but another is missing; \"wrong\" when no required fact is present, or the answer states something that contradicts the " +
  "reference on a required fact, or it answers about a different session or thing. An answer that says it could not find it is wrong. " +
  "Reply with JSON only: {\"grades\":[{\"key\":...,\"verdict\":...,\"reason\":\"one sentence\"}]}.";

// The reference is part of the key, so changing a question's expected answer re-grades only it.
const hash = (r) =>
  crypto.createHash("sha1").update(`${r.id}|${r.backend}|${r.run}|${r.answer}|${Q[r.id]?.expected}|${JSON.stringify(Q[r.id]?.facts)}`).digest("hex").slice(0, 12);

function judge(items) {
  const prompt = JSON.stringify(
    items.map((it) => ({ key: it.key, question: Q[it.row.id].question, reference: Q[it.row.id].expected, requiredFacts: Q[it.row.id].facts, answer: it.row.answer.slice(0, 6000) })),
  );
  const schema = JSON.stringify({
    type: "object",
    properties: { grades: { type: "array", items: { type: "object", properties: { key: { type: "string" }, verdict: { enum: ["correct", "partial", "wrong"] }, reason: { type: "string" } }, required: ["key", "verdict", "reason"] } } },
    required: ["grades"],
  });
  const r = spawnSync(
    "claude",
    ["-p", prompt, "--model", model, "--output-format", "json", "--system-prompt", SYSTEM, "--tools", "", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}', "--setting-sources", "project,local", "--json-schema", schema],
    { cwd, encoding: "utf8", maxBuffer: 64 << 20 },
  );
  const j = JSON.parse(r.stdout);
  const out = j.structured_output ?? JSON.parse(String(j.result).replace(/^```json\s*|```\s*$/g, ""));
  return { grades: out.grades, costUsd: j.total_cost_usd ?? 0 };
}

let spent = 0;
for (const file of files) {
  const rows = fs.readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const outFile = file.replace(/\.jsonl$/, ".graded.jsonl");
  const done = new Map();
  if (fs.existsSync(outFile)) for (const l of fs.readFileSync(outFile, "utf8").trim().split("\n").filter(Boolean)) {
    const g = JSON.parse(l);
    done.set(g.hash, g);
  }
  const todo = rows.map((row) => ({ row, key: hash(row) })).filter((it) => !done.has(it.key));
  for (let i = 0; i < todo.length; i += 12) {
    const batch = todo.slice(i, i + 12);
    const { grades, costUsd } = judge(batch);
    spent += costUsd;
    for (const it of batch) {
      const g = grades.find((x) => x.key === it.key) ?? { verdict: "ungraded", reason: "judge returned nothing for this item" };
      done.set(it.key, { hash: it.key, id: it.row.id, backend: it.row.backend, run: it.row.run, verdict: g.verdict, reason: g.reason });
    }
  }
  // Rewrite in the input's order, so the graded file lines up with the results file.
  fs.writeFileSync(outFile, rows.map((r) => JSON.stringify(done.get(hash(r)))).join("\n") + "\n");
  const tally = {};
  for (const r of rows) tally[done.get(hash(r)).verdict] = (tally[done.get(hash(r)).verdict] ?? 0) + 1;
  console.log(path.basename(file), JSON.stringify(tally));
}
console.log(`judge cost $${spent.toFixed(3)}`);
