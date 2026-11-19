// `ask-kit kit test <name>`: a kit's bench (bench/questions.json) asked on each backend, scored
// against the patterns each answer must hold, with time and price. The questions are real ones,
// taken from what agents actually asked or dug for.
//
// bench/questions.json: {"questions": [{"id": "ci-why", "q": "why did CI fail on main?",
//   "expect": ["regex", ...], "any": ["regex", ...]?}]}. A question passes when every `expect`
// matches (any case) and, when `any` is given, at least one of it does. A question with a
// `reference` (and `askedAt`) and no patterns, as `smith scaffold` writes them, is graded by a judge
// model instead: it passes when the answer gives the reference's facts. A question with `do`
// ("<script>", optional `params` object) runs as a shot, like `ask-kit run`: no model, and it counts
// in the summary's share answered with no model. Each result carries the cells the investigator ran,
// read from the ask's journal row.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ROOT, STATE_ROOT, loadConfig } from "./config.mjs";
import { loadDomain } from "./domains.mjs";

function askOnce(kit, backend, q, session, timeoutMs) {
  return new Promise((resolve) => {
    const args = [path.join(ROOT, "bin", "ask-kit.mjs"), "ask", "--domain", kit, ...(backend ? ["--backend", backend] : []), q];
    const p = spawn(process.execPath, args, { env: { ...process.env, ASK_KIT_SESSION: session, NO_COLOR: "1" }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    const t = setTimeout(() => p.kill("SIGTERM"), timeoutMs);
    p.on("close", (code) => {
      clearTimeout(t);
      resolve({ code, out, err: err.slice(-1500) });
    });
  });
}

// One shot from the shell: the kit's script with no model.
function runOnce(kit, script, params, session, timeoutMs) {
  const words = Object.entries(params ?? {}).map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`);
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(ROOT, "bin", "ask-kit.mjs"), "run", kit, script, ...words], { env: { ...process.env, ASK_KIT_SESSION: session, NO_COLOR: "1" }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    const t = setTimeout(() => p.kill("SIGTERM"), timeoutMs);
    p.on("close", (code) => {
      clearTimeout(t);
      resolve({ code, out, err: err.slice(-1500) });
    });
  });
}

// The ask rows a question left in the kit's journal: the cells run, and whether it was a shot.
function journalOf(kit, session) {
  let rows = [];
  try {
    // A kit that keeps its state per project writes it one folder down (<kit>/<project>/).
    const dir = path.join(STATE_ROOT, kit);
    const file = [dir, ...fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(dir, e.name))].map((d) => path.join(d, `${session}.jsonl`)).find((f) => fs.existsSync(f));
    rows = fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.type === "ask");
  } catch {}
  const sum = (k) => (rows.some((r) => r[k] != null) ? rows.reduce((s, r) => s + (r[k] ?? 0), 0) : null);
  return { cells: rows.length ? sum("cells") ?? 0 : null, shot: rows.length > 0 && rows.every((r) => r.shot), costUsd: sum("costUsd"), ms: sum("ms") };
}

const JUDGE =
  "You grade answers from a question-answering tool. For each item you get a question, a reference answer an agent found by hand " +
  "when the question was asked (with its date), and the tool's answer now. Verdicts: \"correct\" when the answer gives the reference's " +
  "main facts (other wording, extra detail and new line numbers do not matter); \"partial\" when it gives some of them and misses " +
  "others; \"changed\" when it contradicts the reference but cites evidence that the thing itself has changed since the reference " +
  "was written; \"wrong\" when it contradicts the reference without such evidence, answers about something else, or says it could " +
  "not find out. Reply with JSON only: {\"grades\":[{\"key\":...,\"verdict\":...,\"reason\":\"one sentence\"}]}.";

/** {key: {verdict, reason}} for items {key, q, reference, askedAt, answer}, a dozen per judge call. */
export async function judgeAnswers(items, config) {
  const { chat } = await import("./llm.mjs");
  const out = {};
  for (let i = 0; i < items.length; i += 12) {
    const batch = items.slice(i, i + 12);
    const user = JSON.stringify(batch.map((x) => ({ key: x.key, question: x.q, reference: x.reference, referenceDate: x.askedAt ?? null, answer: x.answer })));
    try {
      const r = await chat({ system: JUDGE, user, json: true, maxTokens: 1500, config, backend: config.judge?.backend });
      for (const g of r.grades ?? []) out[g.key] = { verdict: String(g.verdict), reason: String(g.reason ?? "") };
    } catch (e) {
      for (const x of batch) out[x.key] = { verdict: "wrong", reason: `the judge failed: ${String(e.message ?? e).slice(0, 120)}` };
    }
  }
  return out;
}

export async function kitTest(name, { backends, only, timeoutSeconds = 600, log = () => {}, judge } = {}) {
  const d = await loadDomain(name);
  const file = d.bench;
  if (!file || !fs.existsSync(file)) throw new Error(`${name} has no bench (bench/questions.json in the kit)`);
  const qs = JSON.parse(fs.readFileSync(file, "utf8")).questions.filter((q) => !only || only.includes(q.id));
  const config = loadConfig();
  const list = backends?.length ? backends : [config.domains?.[name]?.backend ?? config.backends.default];
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const results = [];
  for (const be of list) {
    for (const q of qs) {
      const t0 = Date.now();
      const session = `kittest-${name}-${stamp}-${be}-${q.id}`;
      const r = q.do ? await runOnce(name, q.do, q.params, session, timeoutSeconds * 1000) : await askOnce(name, be, q.q, session, timeoutSeconds * 1000);
      const j = journalOf(name, session);
      const answer = r.out.trim();
      // Time and cost come from the journal: the answer's footer carries no cost.
      const missing = (q.expect ?? []).filter((re) => !new RegExp(re, "i").test(answer));
      const anyOk = !q.any?.length || q.any.some((re) => new RegExp(re, "i").test(answer));
      const pass = r.code === 0 && !missing.length && anyOk;
      const judged = !!q.reference && !q.expect?.length && !q.any?.length && r.code === 0;
      const row = { backend: be, id: q.id, pass, seconds: Math.round((j.ms ?? Date.now() - t0) / 1000), costUsd: j.costUsd != null ? Math.round(j.costUsd * 1e6) / 1e6 : null, cells: j.cells, noModel: !!q.do && j.shot, missing: [...missing, ...(anyOk ? [] : [`one of ${q.any.join(" | ")}`])], answer: answer.slice(0, 1500), ...(r.code ? { error: r.err } : {}) };
      results.push(row);
      if (judged) continue;
      log(`${pass ? "pass" : "FAIL"}  ${be}  ${q.id}  ${row.seconds}s${row.costUsd != null ? ` $${row.costUsd}` : ""}${row.noModel ? "  shot" : row.cells != null ? `  ${row.cells} cells` : ""}${pass ? "" : `  missing: ${row.missing.join(", ") || row.error?.slice(0, 200)}`}`);
    }
  }
  // Questions with a `reference` and no patterns (smith's mined rows) are graded by a judge: the
  // answer against what an agent found by hand when it was asked.
  const byId = Object.fromEntries(qs.map((q) => [q.id, q]));
  const toJudge = results.filter((r) => byId[r.id].reference && !byId[r.id].expect?.length && !byId[r.id].any?.length && !r.error);
  if (toJudge.length) {
    const verdicts = await (judge ?? judgeAnswers)(toJudge.map((r) => ({ key: `${r.backend}|${r.id}`, q: byId[r.id].q, reference: byId[r.id].reference, askedAt: byId[r.id].askedAt, answer: r.answer })), config);
    for (const r of toJudge) {
      const v = verdicts[`${r.backend}|${r.id}`] ?? { verdict: "wrong", reason: "the judge gave no verdict" };
      r.pass = v.verdict === "correct";
      r.verdict = v.verdict;
      r.reason = v.reason;
      if (!r.pass) r.missing = [`${v.verdict}: ${v.reason}`];
      log(`${r.pass ? "pass" : "FAIL"}  ${r.backend}  ${r.id}  ${r.seconds}s${r.costUsd != null ? ` $${r.costUsd}` : ""}  judged ${v.verdict}${r.pass ? "" : `: ${v.reason}`}`);
    }
  }
  const cellsSorted = (rs) => rs.map((r) => r.cells).filter((c) => c != null).sort((a, b) => a - b);
  const summary = list.map((be) => {
    const rs = results.filter((r) => r.backend === be);
    const secs = rs.map((r) => r.seconds).sort((a, b) => a - b);
    return { backend: be, passed: rs.filter((r) => r.pass).length, of: rs.length, medianSeconds: secs[Math.floor(secs.length / 2)] ?? null, costUsd: Number(rs.reduce((s, r) => s + (r.costUsd ?? 0), 0).toFixed(4)), cells: rs.reduce((s, r) => s + (r.cells ?? 0), 0), medianCells: cellsSorted(rs)[Math.floor(rs.length / 2)] ?? null, noModel: rs.filter((r) => r.noModel).length };
  });
  return { kit: name, bench: file, at: new Date().toISOString(), summary, results };
}
