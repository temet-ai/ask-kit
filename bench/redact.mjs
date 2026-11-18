// Copies raw result files into bench/results/ with private details replaced: home paths, and any
// term listed (one regular expression per line, "pattern => replacement") in a terms file kept
// outside the repo, so the private words themselves are never committed.
//   node bench/redact.mjs --terms <private terms file> <raw.jsonl> [...]
import fs from "node:fs";
import path from "node:path";
import { PRIVATE_RESULTS, RESULTS, ROOT, loadQuestions } from "./paths.mjs";
const argv = process.argv.slice(2);
const ti = argv.indexOf("--terms");
const termsFile = ti >= 0 ? argv.splice(ti, 2)[1] : null;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Home folders, and the folder this checkout sits in (where the other projects usually are).
const rules = [
  [new RegExp(esc(path.dirname(path.dirname(ROOT))) + "/", "g"), "<projects>/"],
  [/\/(home|Users)\/[A-Za-z0-9._-]+/g, "~"],
];
if (termsFile)
  for (const line of fs.readFileSync(termsFile, "utf8").split("\n")) {
    const m = line.match(/^(.+?)\s*=>\s*(.*)$/);
    if (m) rules.push([new RegExp(m[1], "gi"), m[2]]);
  }
const clean = (v) => (typeof v === "string" ? rules.reduce((t, [re, rep]) => t.replace(re, rep), v) : Array.isArray(v) ? v.map(clean) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clean(x)])) : v);

// Each row goes to the public results unless its question is in the private set. A results file
// and its .graded.jsonl twin are split the same way, row by row, so they stay lined up.
const isPrivate = new Set(loadQuestions().questions.filter((q) => q.private).map((q) => q.id));
const ids = (f) => {
  const base = f.replace(/\.graded\.jsonl$/, ".jsonl");
  return fs.readFileSync(base, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l).id);
};
for (const f of argv) {
  const text = fs.readFileSync(f, "utf8").trim();
  const rows = text ? text.split("\n").map((l) => clean(JSON.parse(l))) : [];
  const rowIds = ids(f);
  const split = { [RESULTS]: [], [PRIVATE_RESULTS]: [] };
  rows.forEach((r, i) => split[isPrivate.has(rowIds[i]) ? PRIVATE_RESULTS : RESULTS].push(JSON.stringify(r)));
  for (const [dir, lines] of Object.entries(split)) {
    if (!lines.length) continue;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, path.basename(f)), lines.join("\n") + "\n");
  }
  console.log(`${path.basename(f)}: ${split[RESULTS].length} public, ${split[PRIVATE_RESULTS].length} private`);
}
