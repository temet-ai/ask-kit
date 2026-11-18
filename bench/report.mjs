// Tables for RESULTS.md from results/*.jsonl and their .graded.jsonl files.
//   node bench/report.mjs [results dir, default bench/results] > tables.md
import fs from "node:fs";
import path from "node:path";
import { HAND_GRADES, RESULTS, loadQuestions } from "./paths.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const dir = process.argv[2] ?? RESULTS;
const rows = [];
// Questions whose expected value turned out not to be defensible are kept in the file, not scored.
const UNDATED = new Set(loadQuestions().questions.filter((q) => q.tier === "undated").map((q) => q.id));
const EXCLUDED = new Set(loadQuestions().questions.filter((q) => q.excluded).map((q) => q.id));
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl") && !f.endsWith(".graded.jsonl"))) {
  const res = fs.readFileSync(path.join(dir, f), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const gf = path.join(dir, f.replace(/\.jsonl$/, ".graded.jsonl"));
  const gr = fs.existsSync(gf) ? fs.readFileSync(gf, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : [];
  // Undated session questions (tier "undated") are reported as their own set.
  res.forEach((r, i) => !EXCLUDED.has(r.id) && rows.push({ ...r, domain: UNDATED.has(r.id) ? "sessions-undated" : r.domain, verdict: gr[i]?.verdict ?? "ungraded", reason: gr[i]?.reason ?? "" }));
}
// The undated questions were added while deepseek's second full run was going, so it ran them and
// the undated pass ran them again: a repeat of (backend, question, run) is counted as a further run.
{
  const seen = new Map();
  for (const r of rows) {
    const k = `${r.backend}|${r.id}`;
    const runs = seen.get(k) ?? new Set();
    while (runs.has(r.run)) r.run++;
    runs.add(r.run);
    seen.set(k, runs);
  }
}
// Hand review wins over the judge (bench/hand-grades.json, and the private one when it is here).
const hand = HAND_GRADES.filter((f) => fs.existsSync(f)).flatMap((f) => JSON.parse(fs.readFileSync(f, "utf8")).overrides);
let overridden = 0;
for (const o of hand) {
  const r = rows.find((x) => x.id === o.id && x.backend === o.backend && x.run === o.run);
  if (r && r.verdict !== o.verdict) {
    r.judgeVerdict = r.verdict;
    r.verdict = o.verdict;
    r.reason = `hand: ${o.reason}`;
    overridden++;
  }
}

const med = (xs) => {
  const s = xs.filter((x) => x != null).sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null;
};
const sum = (xs) => xs.reduce((a, b) => a + (b ?? 0), 0);
const mean = (xs) => (xs.length ? sum(xs) / xs.length : null);
const s = (ms) => (ms == null ? "-" : `${Math.round(ms / 1000)} s`);
const usd = (x, d = 4) => (x == null ? "-" : `$${x.toFixed(d)}`);
const tok = (n) => (n == null ? "-" : n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));
const score = (rs) => {
  const c = rs.filter((r) => r.verdict === "correct").length;
  const p = rs.filter((r) => r.verdict === "partial").length;
  return { c, p, w: rs.length - c - p, n: rs.length, pts: c + p / 2 };
};
// What the calling agent's context takes with ask: the question plus the answer text, about 4
// characters a token (the tool's schema is paid once per session and shown separately).
// With a subagent: what the caller's own requests grew by (the Agent call and the subagent's
// report), plus its final answer; usage.output there would include the subagent's output too.
const isSub = (r) => r.backend.startsWith("subagent-");
const callerTokens = (r) =>
  r.backend.startsWith("baseline")
    ? (r.contextPeak ?? 0) - (r.contextFirst ?? 0) + (r.usage?.output ?? 0)
    : isSub(r)
      ? (r.contextPeak ?? 0) - (r.contextFirst ?? 0) + (r.answer?.length ?? 0) / 4
      : (r.callerChars ?? 0) / 4;
// The subagent's own cost: its model's line in modelUsage (the caller runs on a different model).
// A follow-up resumes the same session, whose modelUsage is cumulative: subtract the question it follows.
const subCostRaw = (r) => r.modelUsage?.[Object.keys(r.modelUsage ?? {}).find((k) => k.includes(r.backend.slice("subagent-".length)))]?.costUSD ?? null;
const subCost = (r) => {
  const q = loadQuestions().questions.find((x) => x.id === r.id);
  const prev = q?.followupOf && rows.find((x) => x.id === q.followupOf && x.backend === r.backend && x.run === r.run);
  return subCostRaw(r) == null ? null : subCostRaw(r) - (prev ? (subCostRaw(prev) ?? 0) : 0);
};
const by = (xs, f) => xs.reduce((m, x) => (m.set(f(x), [...(m.get(f(x)) ?? []), x]), m), new Map());
const order = ["glm-5.3-flash", "deepseek-v4.1-flash-1017", "claude-haiku", "codex", "copilot", "qwen3.5-9b", "subagent-haiku", "subagent-sonnet", "baseline-sonnet"];
const sortB = (a, b) => order.indexOf(a) - order.indexOf(b);

const out = [];
for (const domain of ["sessions", "sessions-undated", "code"]) {
  const d = rows.filter((r) => r.domain === domain);
  if (!d.length) continue;
  out.push(`\n### ${domain} questions (${new Set(d.map((r) => r.id)).size}, of which ${new Set(d.filter((r) => r.continued).map((r) => r.id)).size} follow-ups)\n`);
  out.push("| Backend | Run | Correct | Partial | Wrong | Score | Median time | Total time | Cost / question | Total cost | Mean cells | Out of steps | Errors |");
  out.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const [b, rs] of [...by(d, (r) => r.backend)].sort((x, y) => sortB(x[0], y[0]))) {
    for (const [run, rr] of [...by(rs, (r) => r.run)].sort((x, y) => x[0] - y[0])) {
      const sc = score(rr);
      const costs = rr.map((r) => r.costUsd).filter((x) => x != null);
      const cells = rr.map((r) => r.cells ?? (b.startsWith("baseline") ? r.toolCalls : isSub(r) ? r.subTurns : null)).filter((x) => x != null);
      const priced = costs.length && sum(costs) > 0;
      out.push(
        `| ${b} | ${run} | ${sc.c} | ${sc.p} | ${sc.w} | ${sc.pts}/${sc.n} | ${s(med(rr.map((r) => r.ms ?? r.wallMs)))} | ${s(sum(rr.map((r) => r.wallMs)))} | ${priced ? usd(sum(costs) / rr.length) : b === "copilot" ? "premium req." : b === "codex" ? "plan" : b.startsWith("qwen") ? "local" : "-"} | ${priced ? usd(sum(costs), 3) : "-"} | ${cells.length ? mean(cells).toFixed(1) : "-"} | ${rr.filter((r) => r.partial).length} | ${rr.filter((r) => !r.ok).length} |`,
      );
    }
  }
}

// The headline: what the calling session pays, with ask (glm, the default) and without.
out.push("\n### In the calling session: ask (default backend) vs digging itself (Sonnet)\n");
out.push("| Questions | Way | Score | Median time | Cost / question | Caller context added / question (median) | Caller context added (total) |");
out.push("|---|---|---|---|---|---|---|");
for (const domain of ["sessions", "sessions-undated", "code"]) {
  for (const b of ["glm-5.3-flash", "baseline-sonnet"]) {
    const rr = rows.filter((r) => r.domain === domain && r.backend === b && r.run === 1);
    if (!rr.length) continue;
    const sc = score(rr);
    out.push(
      `| ${domain} | ${b === "glm-5.3-flash" ? "ask → glm-5.3-flash" : "Sonnet digs (Read/Grep/Bash)"} | ${sc.pts}/${sc.n} | ${s(med(rr.map((r) => r.ms ?? r.wallMs)))} | ${usd(mean(rr.map((r) => r.costUsd ?? 0)), 3)} | ${tok(med(rr.map(callerTokens)))} | ${tok(sum(rr.map(callerTokens)))} |`,
    );
  }
}
// ask against a Claude Code subagent doing the digging for the same caller.
if (rows.some(isSub)) {
  out.push("\n### In the calling session: ask vs a subagent\n");
  out.push("| Questions | Way | Score | Median time | Digger's cost / question | Caller context added / question (median) | Caller context added (total) | Digger's steps (median) |");
  out.push("|---|---|---|---|---|---|---|---|");
  for (const domain of ["sessions", "sessions-undated", "code"]) {
    for (const b of ["glm-5.3-flash", "subagent-haiku", "subagent-sonnet"]) {
      const rr = rows.filter((r) => r.domain === domain && r.backend === b && r.run === 1);
      if (!rr.length) continue;
      const sc = score(rr);
      const cost = isSub(rr[0]) ? rr.map(subCost) : rr.map((r) => r.costUsd ?? 0);
      const steps = rr.map((r) => (isSub(r) ? r.subTurns : r.cells));
      out.push(
        `| ${domain} | ${b === "glm-5.3-flash" ? "ask → glm-5.3-flash" : `${b.slice(9)} subagent (caller ${rr[0].caller})`} | ${sc.pts}/${sc.n} | ${s(med(rr.map((r) => r.ms ?? r.wallMs)))} | ${usd(mean(cost.filter((x) => x != null)), 4)} | ${tok(med(rr.map(callerTokens)))} | ${tok(sum(rr.map(callerTokens)))} | ${med(steps) ?? "-"} |`,
      );
    }
  }
  const subs = rows.filter(isSub);
  out.push(
    `\nSubagent detail: ${subs.filter((r) => Object.keys(r.tools ?? {}).some((t) => t !== "Agent")).length} of ${subs.length} answers had the caller use a tool other than Agent; ${subs.filter((r) => !r.tools?.Agent).length} answered with no subagent (follow-ups the caller answered from what it already had count here).`,
  );
}

const base = rows.filter((r) => r.backend === "baseline-sonnet");
if (base.length) {
  out.push(
    `\nBaseline detail: median ${tok(med(base.map((r) => r.contextFirst)))} tokens of context before the first tool call (system prompt, tools, instructions); median peak ${tok(med(base.map((r) => r.contextPeak)))}; largest peak ${tok(Math.max(...base.map((r) => r.contextPeak ?? 0)))}; median ${med(base.map((r) => r.turns))} turns and ${med(base.map((r) => r.toolCalls))} tool calls; ${base.filter((r) => !r.ok).length} stopped by the per-question budget or an error.`,
  );
  const tool = rows.find((r) => r.toolChars)?.toolChars;
  if (tool) out.push(`The ask tool's own description and schema add about ${tok(tool / 4)} tokens to the calling session once.`);
}

// The baseline ran each question in a fresh `claude -p`, which also pays for writing its own
// 23k-token prefix. A calling session already has its context cached, so estimate the marginal
// cost there instead: every turn re-reads the existing context C (cache read), what the turn adds
// is written once (cache write), and output is output. Claude Sonnet 5.5 prices, $/M tokens.
const P = { read: 0.1, write: 2.5, out: 10 };
if (base.length) {
  out.push("\n### Estimated marginal cost inside an existing Sonnet 5.5 session (context C already cached)\n");
  out.push("| Questions | C | Digging itself: per question | With ask (glm): per question, incl. ask's own cost |");
  out.push("|---|---|---|---|");
  for (const domain of ["sessions", "sessions-undated", "code"]) {
    const bb = base.filter((r) => r.domain === domain);
    const aa = rows.filter((r) => r.domain === domain && r.backend === "glm-5.3-flash" && r.run === 1);
    if (!bb.length || !aa.length) continue;
    for (const C of [50_000, 150_000]) {
      const dig = mean(bb.map((r) => ((r.turns ?? 1) * C * P.read + ((r.contextPeak ?? 0) - (r.contextFirst ?? 0)) * P.write + (r.usage?.output ?? 0) * P.out) / 1e6));
      // With ask: two turns (call, then read the answer), the answer written once, ~100 output tokens for the call.
      const ask = mean(aa.map((r) => (2 * C * P.read + callerTokens(r) * P.write + 100 * P.out) / 1e6 + (r.costUsd ?? 0)));
      out.push(`| ${domain} | ${tok(C)} | ${usd(dig, 3)} | ${usd(ask, 3)} |`);
    }
  }
}

// Warm vs cold: the first question a backend gets after the prefix was built (position 0 of run 1)
// against later fresh questions; follow-ups against fresh questions.
out.push("\n### Cold vs warm, follow-up vs fresh\n");
out.push("| Backend | First question (cold): time, cost | Later fresh questions: median time, cost | Follow-ups: median time, cost | Fresh: median cells | Follow-ups: median cells |");
out.push("|---|---|---|---|---|---|");
for (const [b, rs] of [...by(rows.filter((r) => !r.backend.startsWith("baseline")), (r) => r.backend)].sort((x, y) => sortB(x[0], y[0]))) {
  const firsts = rs.filter((r) => r.run === 1 && r.position === 0 && r.domain === "sessions");
  const fresh = rs.filter((r) => !r.continued && !(r.run === 1 && r.position === 0) && r.domain === "sessions");
  const fol = rs.filter((r) => r.continued);
  const f0 = firsts[0];
  out.push(
    `| ${b} | ${f0 ? `${s(f0.ms ?? f0.wallMs)}, ${usd(f0.costUsd)}${f0.warm?.warmCostUsd ? ` (+ warm-up ${usd(f0.warm.warmCostUsd)})` : ""}` : "-"} | ${s(med(fresh.map((r) => r.ms ?? r.wallMs)))}, ${usd(med(fresh.map((r) => r.costUsd)))} | ${s(med(fol.map((r) => r.ms ?? r.wallMs)))}, ${usd(med(fol.map((r) => r.costUsd)))} | ${med(fresh.map((r) => r.cells)) ?? "-"} | ${med(fol.map((r) => r.cells)) ?? "-"} |`,
  );
}

// Per question: which backends got it.
out.push("\n### Per question (C correct, p partial, x wrong; one letter per run)\n");
const bs = [...new Set(rows.map((r) => r.backend))].sort(sortB);
out.push(`| Question | ${bs.join(" | ")} |`);
out.push(`|---|${bs.map(() => "---").join("|")}|`);
for (const id of [...new Set(rows.map((r) => r.id))]) {
  const cell = (b) =>
    rows
      .filter((r) => r.id === id && r.backend === b)
      .sort((x, y) => x.run - y.run)
      .map((r) => ({ correct: "C", partial: "p", wrong: "x" })[r.verdict] ?? "?")
      .join("") || " ";
  out.push(`| ${id} | ${bs.map(cell).join(" | ")} |`);
}

out.push(`\n${rows.length} graded answers; ${overridden} judge verdicts changed by hand.`);
console.log(out.join("\n"));
