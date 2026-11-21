// ask-kit kit commons: code kits share, so it is written once. Every kit's modules and scripts are
// parsed; each named function and each long regular expression is a unit. Units are compared two
// ways: by what they do (markers for jobs kits keep redoing: redaction, secret paths, HTTP through a
// proxy, running a program, refusals, the kit's state folder) and by their code (shared runs of
// tokens, with local names ignored, so the same logic written with other names still matches).
//
// What it reports: for each job, every kit's own copy and the host library's, if it has one; and
// clusters of near-identical code in two or more kits. A kit added later is checked against both:
// its copy of something the library has is a candidate to move onto the library, and what its copy
// does that the library's does not is a candidate to bring into the library.
import fs from "node:fs";
import path from "node:path";
import { parse, tokenizer } from "acorn";
import { ROOT } from "./config.mjs";
import { findKit, listKits } from "./kits.mjs";

// Jobs kits keep writing for themselves. A unit matches a job when its source matches every
// pattern in `all` (any one of `any` too, when given).
// `lib` names what the host gives for the job (lib.<name>, or make()'s context); `max` is the size of a
// function whose job this is: a larger one only mentions it on the way to something else.
export const JOBS = {
  redact: { about: "redacting secrets in text or values before they reach the model", lib: "lib.redact, lib.redactDeep", max: 3000, any: [/<redacted>|\[redacted\]|redacted["'`]/i], all: [/pass(word)?|token|secret|api.?key|bearer|authorization/i] },
  "secret-paths": { about: "recognising files that hold credentials (.env, keys, tokens)", lib: "lib.isSecretPath", max: 900, all: [/id_(rsa|ed25519)|\\\.pem|\.pem\b|\\\.env|credential|\.netrc|\.npmrc/i] },
  "http-proxy": { about: "HTTP requests that go through HTTPS_PROXY / NO_PROXY", lib: "lib.http.request", max: 6000, any: [/["']CONNECT["']|HTTPS?_PROXY|NO_PROXY|createConnection/], all: [/request|connect|fetch/i] },
  run: { about: "running a program with a timeout and journaling the call", lib: "lib.run", max: 2500, any: [/\b(execFile|spawn|execFileSync|spawnSync)\s*\(/], all: [/timeout/i] },
  refuse: { about: "refusing a call, and the \"not in this ask\" sentence", lib: "lib.deny, lib.notInThisAsk", max: 400, any: [/not allowed:|not in this ask|caller did not ask for a change/], all: [/throw|Error/] },
  "state-dir": { about: "working out ask-kit's state folder for the kit's own data", lib: "stateDir in make(), ${STATE_DIR}", max: 1200, any: [/XDG_STATE_HOME|LOCALAPPDATA|ASK_KIT_STATE/], all: [/state/i] },
  walk: { about: "walking folders with a skip list and a cap", lib: "lib.walk", max: 4000, any: [/node_modules/], all: [/readdir/] },
  "caller-dir": { about: "finding the folder the agent works in", lib: "callerDir in make(), ${CALLER_DIR}, lib.path", max: 600, any: [/settings\.WORKDIR/], all: [/WORKDIR/] },
  "human-size": { about: "sizes and ages as text (1.4 GB, 3 days ago)", lib: "lib.size, lib.age", max: 800, any: [/\*\*\s*30|1024\s*\*\s*1024|2\s*\*\*\s*20|86_?400/], all: [/(GB|MB|KB|days|min|ago)\b/] },
  pool: { about: "running work a few at a time", lib: "lib.pool", max: 1200, any: [/Promise\.all\(\s*Array\.from/], all: [/next\s*\+\+|i\s*\+\+|shift\(\)/] },
};
const fits = (j, u) => u.chars <= j.max && (!j.any || j.any.some((re) => re.test(u.src))) && j.all.every((re) => re.test(u.src));

const MIN_UNIT = 160; // characters: shorter functions are glue
const MAX_UNIT = 6000; // longer ones are whole modules (make()); their inner functions are units of their own
const SHINGLE = 6;

function children(node) {
  const out = [];
  for (const k of Object.keys(node)) {
    if (k === "loc" || k === "start" || k === "end") continue;
    const v = node[k];
    if (Array.isArray(v)) for (const x of v) x && typeof x.type === "string" && out.push(x);
    else if (v && typeof v.type === "string") out.push(v);
  }
  return out;
}

function walk(node, visit, parent = null) {
  visit(node, parent);
  for (const c of children(node)) walk(c, visit, node);
}

const nameOf = (node, parent) => {
  if (node.id?.name) return node.id.name;
  if (parent?.type === "VariableDeclarator" && parent.id?.type === "Identifier") return parent.id.name;
  if ((parent?.type === "Property" || parent?.type === "MethodDefinition" || parent?.type === "PropertyDefinition") && parent.key) return parent.key.name ?? parent.key.value ?? null;
  if (parent?.type === "AssignmentExpression" && parent.left?.type === "MemberExpression") return parent.left.property?.name ?? null;
  return null;
};

/** The units of one file: [{name, kind, line, chars, src}]. Files that do not parse give none. */
export function unitsOf(file, text = fs.readFileSync(file, "utf8")) {
  let ast;
  try {
    ast = parse(text.replace(/^#!.*/, ""), { ecmaVersion: "latest", sourceType: "module", locations: true, allowAwaitOutsideFunction: true });
  } catch {
    return [];
  }
  const out = [];
  walk(ast, (node, parent) => {
    const fn = node.type === "FunctionDeclaration" || node.type === "FunctionExpression" || node.type === "ArrowFunctionExpression";
    const re = (node.type === "Literal" && node.regex) || (node.type === "NewExpression" && node.callee?.name === "RegExp");
    if (!fn && !re) return;
    const src = text.slice(node.start, node.end);
    if (re && src.length < 40) return;
    if (fn && (src.length < MIN_UNIT || src.length > MAX_UNIT)) return;
    const name = nameOf(node, parent) ?? (re && parent?.type === "VariableDeclarator" ? parent.id?.name : null) ?? (fn ? null : "regex");
    if (fn && !name) return; // an anonymous callback is part of its caller
    out.push({ name, kind: fn ? "function" : "regex", line: node.loc.start.line, chars: src.length, src });
  });
  return out;
}

// Tokens with the unit's own names replaced, so `const bad = (x) => ...` and `const hidden = (s) => ...`
// written the same way share their shingles. Property names, globals and strings are kept.
function tokensOf(src) {
  const local = new Set();
  try {
    const ast = parse(`(${src})`, { ecmaVersion: "latest", sourceType: "module", allowAwaitOutsideFunction: true });
    walk(ast, (n, p) => {
      if (n.type === "Identifier" && p && ((p.type === "VariableDeclarator" && p.id === n) || ((p.type === "FunctionDeclaration" || p.type === "FunctionExpression" || p.type === "ArrowFunctionExpression") && p.params.includes(n)))) local.add(n.name);
      if (n.type === "ObjectPattern" || n.type === "ArrayPattern") walk(n, (x) => x.type === "Identifier" && local.add(x.name));
    });
  } catch {}
  const out = [];
  let prevDot = false;
  try {
    for (const t of tokenizer(src, { ecmaVersion: "latest", sourceType: "module", allowAwaitOutsideFunction: true })) {
      const label = t.type.label;
      if (label === "name") out.push(!prevDot && local.has(t.value) ? "$" : t.value);
      else if (label === "regexp") out.push(...String(t.value?.pattern ?? t.value).split(/(?<=[|)])/).slice(0, 40));
      else if (label === "string" || label === "template") out.push(String(t.value).length > 30 ? String(t.value).slice(0, 30) : String(t.value));
      else if (label === "num") out.push("0");
      else out.push(label);
      prevDot = label === ".";
    }
  } catch {}
  return out;
}

const shinglesOf = (tokens) => {
  const s = new Set();
  for (let i = 0; i + SHINGLE <= tokens.length; i++) s.add(tokens.slice(i, i + SHINGLE).join("\u0001"));
  return s;
};

/** The .mjs files of a kit folder that are its code: modules, scripts, lib/. Benches and node_modules are left out. */
export function codeFiles(dir) {
  const out = [];
  const go = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith(".") || e.name === "node_modules" || e.name === "bench" || e.name === "test") continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) go(p);
      else if (e.name.endsWith(".mjs")) out.push(p);
    }
  };
  go(dir);
  return out.sort();
}

/**
 * Compare kits. kits: [{name, dir}]; the host library, when given as {name: "lib", dir}, is one of them.
 * Returns {kits, jobs: {job: {about, copies: [{kit, file, line, name, chars}]}}, clusters: [{similarity, units: [...] }]}.
 */
export function compare(kits, { threshold = 0.4 } = {}) {
  const units = [];
  for (const k of kits) {
    for (const f of codeFiles(k.dir)) {
      for (const u of unitsOf(f)) units.push({ kit: k.name, file: path.relative(k.dir, f).split(path.sep).join("/"), ...u });
    }
  }
  // By job.
  const jobs = {};
  for (const [job, j] of Object.entries(JOBS)) {
    const copies = units.filter((u) => u.kit !== "lib" && fits(j, u));
    // One row per kit and file: the largest unit there stands for it.
    const byFile = new Map();
    for (const u of copies) {
      const key = `${u.kit}|${u.file}`;
      const cur = byFile.get(key);
      byFile.set(key, { kit: u.kit, file: u.file, line: cur?.line ?? u.line, name: cur && cur.chars >= u.chars ? cur.name : u.name, chars: (cur?.chars ?? 0) + u.chars, units: (cur?.units ?? 0) + 1 });
    }
    const rows = [...byFile.values()].sort((a, b) => a.kit.localeCompare(b.kit) || b.chars - a.chars);
    jobs[job] = { about: j.about, kits: [...new Set(rows.map((r) => r.kit))].length, copies: rows };
  }
  // By code: candidate pairs share shingles (an inverted index); a pair is kept above the threshold.
  for (const u of units) u.sh = shinglesOf(tokensOf(u.src));
  const index = new Map();
  units.forEach((u, i) => {
    for (const s of u.sh) (index.get(s) ?? index.set(s, []).get(s)).push(i);
  });
  const common = Math.max(12, Math.ceil(units.length / 25)); // a run of tokens in very many units says nothing
  const shared = new Map();
  for (const ids of index.values()) {
    if (ids.length < 2 || ids.length > common) continue;
    for (let a = 0; a < ids.length; a++)
      for (let b = a + 1; b < ids.length; b++) {
        if (units[ids[a]].kit === units[ids[b]].kit) continue;
        const key = `${ids[a]},${ids[b]}`;
        shared.set(key, (shared.get(key) ?? 0) + 1);
      }
  }
  const parent = units.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const pairSim = new Map();
  for (const [key, n] of shared) {
    const [a, b] = key.split(",").map(Number);
    const sim = n / Math.min(units[a].sh.size, units[b].sh.size); // how much of the smaller is in the larger
    if (sim < threshold || Math.min(units[a].sh.size, units[b].sh.size) < 8) continue;
    pairSim.set(key, sim);
    parent[find(a)] = find(b);
  }
  const groups = new Map();
  for (const key of pairSim.keys()) for (const i of key.split(",").map(Number)) (groups.get(find(i)) ?? groups.set(find(i), new Set()).get(find(i))).add(i);
  const clusters = [...groups.values()]
    .map((set) => {
      const members = [...set].map((i) => units[i]);
      const sims = [...pairSim].filter(([k]) => k.split(",").every((i) => set.has(Number(i)))).map(([, s]) => s);
      return {
        kits: [...new Set(members.map((m) => m.kit))].sort(),
        similarity: +Math.max(...sims).toFixed(2),
        jobs: Object.keys(JOBS).filter((j) => members.some((m) => fits(JOBS[j], m))),
        units: members.map(({ kit, file, line, name, chars, kind }) => ({ kit, file, line, name, kind, chars })).sort((a, b) => a.kit.localeCompare(b.kit)),
      };
    })
    .filter((c) => c.kits.length >= 2)
    .sort((a, b) => b.kits.length - a.kits.length || b.units.reduce((s, u) => s + u.chars, 0) - a.units.reduce((s, u) => s + u.chars, 0));
  return { kits: kits.map((k) => k.name), units: units.length, jobs, clusters };
}

/** What one kit repeats: its copies of jobs the library (kit "lib") does, and clusters it is in. */
export function forKit(result, name) {
  const jobs = Object.fromEntries(
    Object.entries(result.jobs)
      .map(([job, j]) => [job, { about: j.about, own: j.copies.filter((c) => c.kit === name), library: j.copies.filter((c) => c.kit === "lib"), others: [...new Set(j.copies.filter((c) => c.kit !== name && c.kit !== "lib").map((c) => c.kit))] }])
      .filter(([, j]) => j.own.length),
  );
  return { kit: name, jobs, clusters: result.clusters.filter((c) => c.kits.includes(name)) };
}

// ---- the outcomes, for a person to act on ----

export const LIB_DIR = path.join(ROOT, "src", "kitlib");

/**
 * The evaluation with outcomes. kits: [{name, dir}] (default: every installed kit); the host library
 * is added as "lib". For each kit and job: `use` (lib has it, the kit has its own copy), `promote`
 * (two or more kits have it and lib does not), and for each cluster of similar code across kits the
 * same. `contribute` is where the kit's copy is larger than lib's for the same job: a lead for a
 * person to read both, since what a copy does better cannot be told from its size.
 */
export function evaluate(kits = listKits().map((n) => ({ name: n, dir: findKit(n) })).filter((k) => k.dir && !k.dir.startsWith(path.join(ROOT, "kits")))) {
  const r = compare([...kits, { name: "lib", dir: LIB_DIR }]);
  const byKit = {};
  const row = (k) => (byKit[k] ??= { use: [], contribute: [], promote: [], shares: [] });
  for (const [job, j] of Object.entries(r.jobs)) {
    const kitsWith = [...new Set(j.copies.map((c) => c.kit))];
    for (const k of kitsWith) {
      const own = j.copies.filter((c) => c.kit === k);
      const where = own.map((c) => `${c.file}:${c.line}${c.name ? ` ${c.name}` : ""}`).slice(0, 4);
      const chars = own.reduce((s, c) => s + c.chars, 0);
      // Every copy is a lead: move onto lib, after reading it for anything lib's does not do.
      if (JOBS[job].lib) row(k).use.push({ job, about: j.about, where, chars, lib: JOBS[job].lib });
      else if (kitsWith.length >= 2) row(k).promote.push({ job, about: j.about, where, chars, alsoIn: kitsWith.filter((x) => x !== k) });
    }
  }
  for (const c of r.clusters) {
    const others = c.kits.filter((k) => k !== "lib");
    for (const k of others) row(k).shares.push({ with: c.kits.filter((x) => x !== k), similarity: c.similarity, inLib: c.kits.includes("lib"), units: c.units.filter((u) => u.kit === k).map((u) => `${u.file}:${u.line} ${u.name}`) });
  }
  const promote = Object.entries(r.jobs).filter(([job, j]) => !JOBS[job].lib && new Set(j.copies.map((c) => c.kit)).size >= 2).map(([job, j]) => ({ job, about: j.about, kits: [...new Set(j.copies.map((c) => c.kit))] }));
  const jobs = Object.fromEntries(Object.entries(r.jobs).map(([job, j]) => [job, { about: j.about, lib: JOBS[job].lib ?? null, kits: [...new Set(j.copies.map((c) => c.kit))] }]));
  // Shared code no job of lib's covers: the next things lib could hold, most kits first.
  const sharedNotInLib = r.clusters
    .filter((c) => !c.kits.includes("lib") && c.kits.length >= 2 && !c.jobs.some((j) => JOBS[j].lib))
    .sort((a, b) => b.kits.length - a.kits.length || b.similarity - a.similarity)
    .map((c) => ({ kits: c.kits, similarity: c.similarity, units: c.units.map((u) => `${u.kit}:${u.file}:${u.line} ${u.name}`) }));
  return { kits: kits.map((k) => k.name), units: r.units, jobs, byKit, promote, sharedNotInLib: sharedNotInLib.slice(0, 20) };
}

export function formatEvaluation(e, only) {
  const lines = [];
  if (!only) {
    lines.push(`${e.kits.length} kits, ${e.units} functions and patterns compared.`, "", "Jobs kits do for themselves:");
    for (const [job, j] of Object.entries(e.jobs)) if (j.kits.length) lines.push(`  ${job.padEnd(13)} ${String(j.kits.length).padStart(2)} kits  ${j.lib ? `lib has it: ${j.lib}` : "not in lib"}  (${j.kits.join(", ")})`);
    lines.push("");
  }
  for (const k of only ? [only] : Object.keys(e.byKit).sort()) {
    const x = e.byKit[k];
    if (!x) {
      lines.push(`${k}: nothing it repeats.`);
      continue;
    }
    lines.push(k);
    for (const u of x.use) lines.push(`  use ${u.lib} for ${u.job}: its own copy at ${u.where.join(", ")}; read it for anything lib's does not do`);
    for (const p of x.promote) lines.push(`  promote ${p.job} into lib: also in ${p.alsoIn.join(", ")}`);
    for (const s of x.shares.slice(0, 4)) lines.push(`  same code as ${s.with.join(", ")} (${s.similarity}): ${s.units.slice(0, 2).join("; ")}`);
  }
  if (!only && e.sharedNotInLib.length) {
    lines.push("", "Code two or more kits share that lib has no job for (candidates for lib):");
    for (const s of e.sharedNotInLib.slice(0, 10)) lines.push(`  ${s.similarity}  ${s.units.slice(0, 4).join(" | ")}`);
  }
  return lines.join("\n");
}
