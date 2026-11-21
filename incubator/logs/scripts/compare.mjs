export const meta = {
  purpose:
    "What is different between two logs, or between two windows of one log: the kinds of entry (by signature) that are only in one, and those whose count changed most. By default warnings and errors are compared. The answer to 'what changed after the deploy', 'what does the failing run log that the good run does not', 'which errors are new since 21:14', 'is today worse than yesterday'.",
  params: {
    a: "the first log (the earlier or the good one): a file, or leave out and give file with split or the a_ window",
    b: "the second log",
    file: "one log to compare two windows of",
    split: 'with file: a time; a is everything before it and b everything from it on ("21:14", "last-1h", an ISO time)',
    a_since: "start of window a, optional",
    a_until: "end of window a, optional",
    b_since: "start of window b, optional",
    b_until: "end of window b, optional",
    all: "true compares every entry, not only warnings and errors",
    level: 'lowest level compared, default "warn"',
    top: "rows per list, default 8, at most 40",
    rotated: "false reads only the files named, not the rotated files beside them (needed to compare app.log.1 with app.log)",
  },
  returns: "{verdict, what, a:{logs, window, entries, compared, kinds}, b:{...}, onlyInA:[{signature, count, example}], onlyInB:[...], changed:[{signature, a, b, change}], unchanged, counts:{onlyInA, onlyInB, changed}, leftOut?, notes?} or {error}",
  example: 'await scripts.run("compare", { file: "logs/app.log", split: "last-1h" })',
};

export default async function ({ logs }, { a, b, file, split, a_since, a_until, b_since, b_until, all, level, top, rotated } = {}) {
  const has = (v) => v != null && v !== "";
  if (!has(a) && !has(b) && !has(file)) throw new Error('compare needs two logs (a and b), or one log with a time to split it at: { file: "app.log", split: "21:14" }');
  if (has(file) && !has(split) && ![a_since, a_until, b_since, b_until].some(has)) throw new Error('compare of one file needs split (a time: a is before it, b from it on) or the windows a_since, a_until, b_since, b_until');
  const A = { file: has(a) ? a : file, since: a_since, until: has(split) ? split : a_until };
  const B = { file: has(b) ? b : file, since: has(split) ? split : b_since, until: b_until };
  if (!has(A.file) || !has(B.file)) throw new Error("compare needs both a and b, or file");
  const r = await logs.compare(A, B, { all, level, top, rotated });
  if (r.error) return r;
  const c = r.counts;
  const short = (s) => (s.length > 80 ? s.slice(0, 80) + "…" : s);
  const parts = [];
  parts.push(c.onlyInB ? `${c.onlyInB} ${c.onlyInB === 1 ? "kind" : "kinds"} only in b: ${r.onlyInB.slice(0, 3).map((x) => `"${short(x.signature)}" (${x.count})`).join(", ")}` : "nothing only in b");
  parts.push(c.onlyInA ? `${c.onlyInA} only in a: ${r.onlyInA.slice(0, 3).map((x) => `"${short(x.signature)}" (${x.count})`).join(", ")}` : "nothing only in a");
  if (c.changed) parts.push(`biggest change: "${short(r.changed[0].signature)}" ${r.changed[0].a} to ${r.changed[0].b}`);
  return { verdict: `${r.what}: ${parts.join("; ")}`, ...r };
}
