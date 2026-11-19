// The router bench: every misroute the router journaled (a question, where it went, where it should
// have gone) asked of the router again, to see whether a change to the router, a kit's says,
// keywords, patterns or provides, or the router model gets it right now.
//
//   node bench/router.mjs [--file <rows.jsonl>] [--rules] [--json]
//
// Rows come from <ASK_KIT_STATE>/router/bench.jsonl (the router writes one per misroute; `ask-kit
// report` lists them), or --file. Each is routed the way the router routes a new question: a pattern, then
// the router model (unless --rules), then the fallback rules. It uses the config and kits installed
// here, and the router model's real calls: about one short call per row.
import fs from "node:fs";

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? undefined : process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : true;
};
const { loadConfig } = await import("../src/config.mjs");
const { makeRouter, benchFile } = await import("../src/router.mjs");
const file = typeof arg("file") === "string" ? arg("file") : benchFile();
const rows = fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
if (!rows.length) {
  console.log(`No router bench rows in ${file}: misroutes are recorded as they happen.`);
  process.exit(0);
}
// The same question corrected twice counts once, with its latest correct answer.
const byQuestion = new Map(rows.map((r) => [r.question, r]));
const r = await makeRouter(loadConfig());
const out = [];
for (const row of byQuestion.values()) {
  let got = r.byPattern(row.question);
  let how = "pattern";
  if (!got) {
    try {
      if (arg("rules")) throw new Error("rules only");
      got = await r.byModel(row.question);
      how = "model";
    } catch (e) {
      got = r.fallback(row.question, e);
      how = "rules";
    }
  }
  got = r.resolve ? r.resolve(got, row.question) : got;
  out.push({ question: row.question, correct: row.correct, was: row.routed, now: got, how, ok: got === row.correct });
}
if (arg("json")) console.log(JSON.stringify(out, null, 2));
else {
  for (const o of out) console.log(`${o.ok ? "pass" : "FAIL"}  ${o.now.padEnd(16)} (by ${o.how}; want ${o.correct}, was ${o.was})  ${o.question.slice(0, 100)}`);
  console.log(`${out.filter((o) => o.ok).length}/${out.length} routed right`);
}
process.exit(out.every((o) => o.ok) ? 0 : 1);
