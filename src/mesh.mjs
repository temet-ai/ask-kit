// ask-kit kit mesh: how a kit fits with the kits already here, and what to do so it joins the system
// rather than sitting beside it (docs/design/mesh.md). It reads; it changes nothing. The agent that
// adds a kit for a person runs it before and after the install (the "Add a kit" steps in AGENTS.md)
// and acts on its steps: the ones marked `agent` it may take, `ask` ones need the person's yes, and
// `author` ones go to the kit's author or to ask-kit's shared library.
//
// Five joints: code (what it repeats of lib and of installed kits), routing (whose questions it would
// take, and which of its own would go elsewhere), overlaps (the same commands or the same answers as
// an installed kit), composition (installed kits it could ask instead of redoing their work), and
// readiness (settings it still needs, whether it says what it replaces, whether it has a bench).
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "./config.mjs";
import { evaluate } from "./commons.mjs";
import { compileActions, matchAction } from "./actions.mjs";
import { fetchRepo, findKits, parseRef } from "./gallery.mjs";
import { findKit, listKits, readManifest } from "./kits.mjs";
import { PROGRAMS } from "./gaps.mjs";

function codeOf(dir) {
  let s = "";
  const walkDir = (d) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      if (ent.name.startsWith(".") || ent.name === "node_modules" || ent.name === "bench") continue;
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) walkDir(p);
      else if (ent.name.endsWith(".mjs") && s.length < 2e6) s += fs.readFileSync(p, "utf8");
    }
  };
  walkDir(dir);
  return s;
}

const benchOf = (dir, m) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, m.bench ?? path.join("bench", "questions.json")), "utf8")).questions ?? [];
  } catch {
    return [];
  }
};
const words = (s) => new Set(String(s ?? "").toLowerCase().match(/[a-z][a-z0-9-]{3,}/g) ?? []);
const STOP = new Set(["what", "which", "when", "where", "this", "that", "with", "from", "they", "them", "their", "does", "about", "into", "also", "only", "kit's", "asked", "acting", "changing", "machine"]);
const overlapOf = (a, b) => {
  const x = [...words(a)].filter((w) => !STOP.has(w));
  const y = new Set([...words(b)].filter((w) => !STOP.has(w)));
  const both = x.filter((w) => y.has(w));
  return { share: both.length / Math.max(1, Math.min(x.length, y.size)), both };
};
const keywordRe = (m) => (m.keywords?.length ? new RegExp(`\\b(${m.keywords.join("|")})\\b`, "i") : null);
const claimBy = (m, q) => ((m.patterns ?? []).some((p) => new RegExp(p, "i").test(q)) ? "pattern" : matchAction(compileActions(m).filter((a) => !a.acts), q) ? "action" : null);
const heads = (list) => new Set([].concat(list ?? []).map((r) => String(r).split(" ")[0]));
// The commands a kit answers for: its replaces, its requires, and those ask-kit gaps already puts down to it.
const commandsOf = (m) => new Set([...heads(m.replaces), ...[].concat(m.requires ?? []), ...Object.entries(PROGRAMS).filter(([, k]) => k === m.name).map(([p]) => p)]);
// Programs a kit's code runs: string literals that name a known command, passed as a program.
const KNOWN = new Set(Object.keys(PROGRAMS));
function programsRun(text, extra = []) {
  const known = new Set([...KNOWN, ...extra]);
  const out = new Set();
  for (const [, p] of text.matchAll(/(?:execFile|execFileSync|spawn|spawnSync|run|sh|exec)\s*\(\s*["'`]([\w.+-]+)["'`]/g)) if (known.has(p)) out.add(p);
  for (const [, p] of text.matchAll(/\[\s*["'`]([\w.+-]+)["'`]\s*,/g)) if (known.has(p)) out.add(p);
  return out;
}

/** Resolve what to mesh: an installed kit's name, or a source (folder, owner/repo[/folder]) holding one. */
function target(ref, { only, pin } = {}) {
  const installed = /^[a-z][a-z0-9-]*$/.test(ref) && !fs.existsSync(ref) ? findKit(ref) : null;
  if (installed) return { dir: installed, m: readManifest(installed), installed: true };
  const r = parseRef(ref, { ref: pin });
  const { dir } = fetchRepo(r);
  let kits = findKits(dir).map((d) => ({ dir: d, m: readManifest(d) }));
  if (only) kits = kits.filter((k) => k.m.name === only);
  if (kits.length !== 1) throw new Error(`${ref} holds ${kits.length ? `${kits.length} kits (${kits.map((k) => k.m.name).join(", ")}): pick one with --only` : "no kit"}`);
  return { ...kits[0], installed: false, source: ref };
}

export function mesh(ref, { only, ref: pin, config = loadConfig({ required: false }) ?? {} } = {}) {
  const t = target(ref, { only, pin });
  const m = t.m;
  const others = listKits()
    .filter((n) => n !== m.name && config.domains?.[n]?.enabled !== false && config.domains?.[n])
    .map((n) => {
      const dir = findKit(n);
      try {
        return { name: n, dir, m: readManifest(dir) };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  const steps = [];
  const step = (who, what, why) => steps.push({ who, what, why });

  // 1. Code: what it repeats of lib, and code it shares with installed kits.
  const e = evaluate([{ name: m.name, dir: t.dir }, ...others.map((o) => ({ name: o.name, dir: o.dir }))]);
  const mine = e.byKit[m.name] ?? { use: [], promote: [], shares: [] };
  const code = {
    repeatsLib: mine.use.map((u) => ({ job: u.job, where: u.where, lib: u.lib })),
    sharesWith: mine.shares.filter((s) => !s.inLib).map((s) => ({ kits: s.with, similarity: s.similarity, units: s.units.slice(0, 3) })),
  };
  for (const u of code.repeatsLib) step("author", `move ${m.name}'s own ${u.job} (${u.where[0]}) onto ${u.lib}`, "read its copy first: what it does that lib's does not is a proposal for lib");
  for (const s of code.sharesWith.slice(0, 5)) step("author", `${m.name} and ${s.kits.join(", ")} share code (${s.similarity}): ${s.units[0]}`, "the same code in two kits belongs in lib, or in one kit the other uses");

  // 2. Routing, both ways, by what claims a question with no model (patterns and actions) and by keywords (the fallback and the router's shortlist).
  const own = benchOf(t.dir, m).filter((q) => q.q).map((q) => q.q);
  const takes = [];
  const lost = [];
  const wordsTake = [];
  for (const o of others) {
    for (const q of benchOf(o.dir, o.m).filter((x) => x.q).map((x) => x.q)) {
      const by = claimBy(m, q);
      if (by) takes.push({ from: o.name, question: q.slice(0, 160), by });
      else if (keywordRe(m)?.test(q) && !keywordRe(o.m)?.test(q)) wordsTake.push({ from: o.name, question: q.slice(0, 160) });
    }
    for (const q of own) {
      const by = claimBy(o.m, q);
      if (by) lost.push({ to: o.name, question: q.slice(0, 160), by });
    }
  }
  const routing = { takes, lost, wordsTake: wordsTake.slice(0, 10), ownQuestions: own.length };
  for (const x of takes) step("ask", `${m.name}'s ${x.by} takes ${x.from}'s question "${x.question}" with no model`, `narrow ${m.name}'s ${x.by}, or accept that ${m.name} answers it`);
  for (const x of lost) step("ask", `${x.to}'s ${x.by} takes ${m.name}'s question "${x.question}"`, `narrow ${x.to}'s ${x.by}, or turn that action off: ask-kit kit actions ${x.to} --disable <action>`);

  // 3. Overlaps: the same commands (declared, required, or run by its code), or much the same answers.
  const codeText = codeOf(t.dir);
  const mineCmds = new Set([...commandsOf(m), ...programsRun(codeText, others.flatMap((o) => [...commandsOf(o.m)]))]);
  const overlaps = [];
  for (const o of others) {
    const cmds = [...mineCmds].filter((h) => commandsOf(o.m).has(h));
    const reqs = [];
    const says = overlapOf(m.says, o.m.says);
    if (!cmds.length && !reqs.length && says.share < 0.3) continue;
    const named = { [m.name]: new RegExp(`\\b${o.name}\\b`).test(m.route_hint ?? ""), [o.name]: new RegExp(`\\b${m.name}\\b`).test(o.m.route_hint ?? "") };
    overlaps.push({ kit: o.name, commands: cmds, requires: reqs, saysWords: says.share >= 0.3 ? says.both.slice(0, 8) : [], routeHintNames: named, provides: { [m.name]: (m.provides ?? []).map((p) => p.capability), [o.name]: (o.m.provides ?? []).map((p) => p.capability) } });
    const on = [...cmds, ...says.both.slice(0, 3)].join(", ");
    if (cmds.length) step("ask", `${m.name} and ${o.name} both answer for ${cmds.join(", ")}: decide which does (the new kit, with ${o.name}'s route_hint pointing to it; or ${m.name} uses ${o.name}), and pin it with domains.<kit>.priority when both declare the same [[provides]]`, "two kits answering the same thing route by chance");
    if (!named[m.name]) step("author", `${m.name}'s route_hint should name what stays ${o.name}'s (they overlap on ${on})`, "the router model reads route_hint to choose between neighbours");
    if (!named[o.name]) step("author", `${o.name}'s route_hint should name what is now ${m.name}'s (${on})`, "otherwise the router keeps sending those questions to the kit it knew");
    const shared = (m.provides ?? []).map((p) => p.capability).filter((c) => (o.m.provides ?? []).some((p) => p.capability === c));
    if (shared.length) step("ask", `both provide ${shared.join(", ")}: pin which answers first with domains.<kit>.priority`, "two providers at one priority are a tie the router cannot settle");
  }

  // 4. Composition: installed kits whose commands this kit's code runs itself.
  const composition = [];
  const ran = programsRun(codeText, others.flatMap((o) => [...commandsOf(o.m)]));
  for (const o of others) {
    const progs = [...ran].filter((p) => commandsOf(o.m).has(p) && !commandsOf(m).has(p));
    // An overlap above already puts the choice to the person; this is for kits it does not overlap.
    if (progs.length && !(m.uses ?? []).includes(o.name) && !overlaps.some((x) => x.kit === o.name)) composition.push({ kit: o.name, runs: progs, says: o.m.says.slice(0, 120) });
  }
  for (const c of composition) step("author", `${m.name} runs ${c.runs.join(", ")} itself; ${c.kit} answers for that`, `ask.kit("${c.kit}", ...) from a cell, or uses = ["${c.kit}"], instead of a second copy of that work`);

  // 5. Readiness: settings it still needs, what it replaces, its bench.
  const set = config.domains?.[m.name]?.settings ?? {};
  const missing = (m.settings ?? []).filter((s) => s.required && process.env[s.key] == null && set[s.key] == null && s.default == null && !s.detect).map((s) => ({ key: s.key, about: s.about ?? null }));
  for (const s of missing) step("ask", `ask-kit kit set ${m.name} ${s.key}=<value>`, s.about ?? "a required setting");
  const bench = benchOf(t.dir, m);
  const readiness = { missingSettings: missing, replaces: m.replaces ?? null, bench: { questions: bench.filter((q) => q.q).length, shots: bench.filter((q) => q.do).length } };
  if (!m.replaces) step("author", `add replaces = [...] to ${m.name}: the commands it answers for`, "ask-kit gaps and kit suggest credit the kit only for commands it names");
  if (!readiness.bench.questions) step("agent", `collect real questions for ${m.name}'s bench from this machine's sessions (ask-kit mine ${m.name})`, "a bench of shots proves the scripts, not that a model answers well");

  return {
    kit: m.name,
    installed: t.installed,
    ...(t.source ? { source: t.source } : {}),
    against: others.map((o) => o.name),
    code,
    routing,
    overlaps,
    composition,
    readiness,
    steps,
    next: steps.length
      ? `Take the agent steps; tell the user the ask steps and take them on their yes; list the author steps in your summary (they go to ${m.name}'s author or to ask-kit's shared library). Run ask-kit kit mesh ${m.name} again after: what you settled drops out.`
      : `${m.name} fits: nothing to settle with ${others.length} installed kits.`,
  };
}

export function formatMesh(r) {
  const lines = [`${r.kit} ${r.installed ? "(installed)" : "(not installed)"} against ${r.against.length} installed kits: ${r.against.join(", ") || "none"}`];
  const sec = (title, rows) => {
    if (!rows.length) return;
    lines.push("", title);
    for (const x of rows) lines.push(`  ${x}`);
  };
  sec("Code", [...r.code.repeatsLib.map((u) => `repeats lib (${u.lib}): ${u.job} at ${u.where[0]}`), ...r.code.sharesWith.map((s) => `same code as ${s.kits.join(", ")} (${s.similarity}): ${s.units[0]}`)]);
  sec("Routing", [...r.routing.takes.map((x) => `takes ${x.from}'s "${x.question}" (${x.by})`), ...r.routing.lost.map((x) => `loses "${x.question}" to ${x.to} (${x.by})`), ...r.routing.wordsTake.map((x) => `its keywords also match ${x.from}'s "${x.question}"`)]);
  sec("Overlaps", r.overlaps.map((o) => `${o.kit}: ${[o.commands.length ? `commands ${o.commands.join(", ")}` : null, o.requires.length ? `requires ${o.requires.join(", ")}` : null, o.saysWords.length ? `says ${o.saysWords.join(", ")}` : null].filter(Boolean).join("; ")}`));
  sec("Composition", r.composition.map((c) => `runs ${c.runs.join(", ")} itself; ${c.kit} answers for that`));
  sec("Readiness", [...r.readiness.missingSettings.map((s) => `needs ${s.key}${s.about ? ` (${s.about})` : ""}`), `replaces: ${r.readiness.replaces ? r.readiness.replaces.join(", ") : "not declared"}`, `bench: ${r.readiness.bench.questions} questions for a model, ${r.readiness.bench.shots} shots`]);
  sec("Steps", r.steps.map((s) => `[${s.who}] ${s.what}${s.why ? ` (${s.why})` : ""}`));
  lines.push("", r.next);
  return lines.join("\n");
}
