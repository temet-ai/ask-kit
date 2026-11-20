// What the journals say about how `ask` is doing: every ask with its feedback signals, which
// scripts were used, and the cell shapes that keep being written by hand (routes worth a script).
// Read by the ask-kit-improve skill and the ask-kit-tuner agent.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { STATE_ROOT } from "./config.mjs";
import { actionsDir, readLog, readState, windowOf } from "./actions.mjs";

// Kit-test and benchmark sessions are not real use.
const realSession = (session) => !/^(kittest-|bench)/.test(String(session ?? ""));

// A question's template: literals blanked (quoted text, paths, ids, numbers), so the same question
// about another container, PR or file counts as the same question.
export const templateOf = (q) =>
  String(q ?? "")
    .toLowerCase()
    .replace(/(["'`])(?:\\.|(?!\1).)*\1/g, "<text>")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, "<id>")
    .replace(/(?:~|\.{1,2})?\/[\w.@~-]+(?:\/[\w.@~-]+)*|\b[\w.-]+\/[\w.-]+(?:\/[\w.@~-]+)*/g, "<path>")
    .replace(/#?\b[0-9a-f]{7,40}\b/g, (w) => (/[a-f]/.test(w) ? "<id>" : w))
    .replace(/#?\b\d+(?:\.\d+)?\b/g, "N")
    .replace(/\b[\w-]*\d[\w-]*\b/g, "<id>")
    .replace(/[?.!\s]+$/, "")
    .replace(/\s+/g, " ")
    .trim();

// The params of a script call written in a cell, for cell records older than params in `scripts`.
const paramsInCode = (code, name) => {
  const m = String(code).match(new RegExp(`scripts\\.run\\(\\s*["'\`]${name.replace(/[^\w-]/g, "")}["'\`]\\s*,\\s*(\\{[^}]{0,200}\\})`));
  return m ? m[1].replace(/\s+/g, " ") : null;
};

/**
 * Real questions (kit tests and benchmarks left out) clustered by kit, question template and the
 * library script their cells ran, ranked by count times cost: what is worth an [[actions]] entry.
 * `asks` are ask rows with `domain` and `dir`; `cellsByDir` maps a journal folder to its cell rows.
 */
export function worthAnAction(asks, cellsByDir, { min = 2, top = 10 } = {}) {
  const groups = {};
  for (const a of asks) {
    if (!realSession(a.session) || a.shot || a.action || !a.ok || a.continued) continue;
    const end = Date.parse(a.ts);
    const start = end - (a.ms ?? 0) - 1000;
    const cells = (cellsByDir[a.dir] ?? []).filter((c) => (a.askId ? c.session === `ask-${a.askId}` : String(c.session).startsWith("ask-")) && c.t >= start && c.t <= end + 1000);
    const ran = new Map();
    for (const c of cells) for (const s of c.scripts ?? []) if (s.ok && !s.draft && !s.saved && !ran.has(s.name)) ran.set(s.name, s.params != null ? JSON.stringify(s.params) : paramsInCode(c.code, s.name));
    const template = templateOf(a.question);
    for (const [script, params] of ran) {
      const g = (groups[`${a.domain}\t${template}\t${script}`] ??= { kit: a.domain, template, script, n: 0, sessions: new Set(), costUsd: 0, ms: [], questions: [], params: new Set() });
      g.n++;
      g.sessions.add(a.session);
      g.costUsd += a.costUsd ?? 0;
      if (a.ms != null) g.ms.push(a.ms);
      if (g.questions.length < 3 && !g.questions.includes(a.question)) g.questions.push(String(a.question).slice(0, 140));
      if (params && g.params.size < 6) g.params.add(params);
    }
  }
  return Object.values(groups)
    .filter((g) => g.n >= min)
    .map((g) => ({ kit: g.kit, template: g.template, script: g.script, n: g.n, sessions: g.sessions.size, costUsd: Math.round(g.costUsd * 1e4) / 1e4, medianSeconds: g.ms.length ? Math.round(median(g.ms) / 100) / 10 : null, questions: g.questions, params: [...g.params] }))
    .sort((a, b) => b.costUsd - a.costUsd || b.n * (b.medianSeconds ?? 0) - a.n * (a.medianSeconds ?? 0) || b.n - a.n)
    .slice(0, top);
}

/** Per kit action since `from`: runs, answers, fall-throughs by why, re-asks, and whether it is off and why; and shadow runs. */
export function actionsSummary(from) {
  const out = { actions: [], shadows: [] };
  let files = [];
  try {
    files = fs.readdirSync(actionsDir()).filter((f) => f.endsWith(".jsonl"));
  } catch {
    return out;
  }
  for (const f of files) {
    const kit = f.slice(0, -6);
    const rows = readLog(kit);
    const state = readState(kit);
    const recent = rows.filter((r) => Date.parse(r.at) >= from);
    const names = [...new Set([...recent.filter((r) => r.type === "run").map((r) => r.action), ...Object.keys(state).filter((n) => state[n].off)])];
    for (const name of names) {
      const runs = recent.filter((r) => r.type === "run" && r.action === name);
      const fell = {};
      for (const r of runs) if (r.fellThrough) fell[r.fellThrough] = (fell[r.fellThrough] ?? 0) + 1;
      out.actions.push({ kit, action: name, runs: runs.length, answered: runs.filter((r) => !r.fellThrough).length, fellThrough: fell, reasked: recent.filter((r) => r.type === "reask" && r.action === name).length, window: windowOf(kit, name, rows, state[name]?.enabledAt), ...(state[name]?.off ? { off: state[name].why, offAt: state[name].at } : {}) });
    }
    for (const r of recent) if (r.type === "shadow") out.shadows.push({ kit, ...r });
  }
  out.actions.sort((a, b) => b.runs - a.runs);
  out.shadows.sort((a, b) => a.at.localeCompare(b.at));
  return out;
}

function journals(dir, out = []) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory() && !["warm", "drafts", "gallery", "index", "actions", "nudges"].includes(e.name)) journals(full, out);
    else if (e.name.endsWith(".jsonl")) out.push(full);
  }
  return out;
}

/** `--since`: 24h, 7d, a date, or a git commit sha or ref (its commit date, from the repository in the current folder). */
export const parseSince = (s) => {
  const m = String(s ?? "7d").match(/^(\d+)([hd])$/);
  if (m) return Date.now() - Number(m[1]) * (m[2] === "d" ? 86400_000 : 3600_000);
  const text = String(s);
  if (/^\d{4}-\d{2}(-\d{2})?([T ]|$)/.test(text) && !Number.isNaN(Date.parse(text))) return Date.parse(text);
  if (!text.startsWith("-")) {
    try {
      const out = execFileSync("git", ["log", "-1", "--format=%cI", text, "--"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      if (out && !Number.isNaN(Date.parse(out))) return Date.parse(out);
    } catch {}
  }
  const t = Date.parse(text);
  if (Number.isNaN(t)) throw new Error(`--since ${s}: use 24h, 7d, a date, or a git commit sha or ref (run in its repository)`);
  return t;
};

// A cell's shape: its first call, with literals blanked, so the same hand-written search counts once.
const shapeOf = (code) =>
  code
    .replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '"…"')
    .replace(/\b\d+\b/g, "N")
    .replace(/\b(const|let|var)\s+\w+\s*=\s*/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90);

const median = (xs) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null);
const readRows = (file) =>
  fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((l) => {
      try {
        return [JSON.parse(l)];
      } catch {
        return [];
      }
    });

/**
 * What each kit and domain costs and does, from the journals: how often the router chose it, its
 * asks' median time, cost and cells, its misroutes, fallbacks away from it and no-data answers,
 * and (from `router`, a makeRouter result) the router-prompt tokens it adds to every routed ask
 * and the milliseconds it adds to building the router. Kit-test and benchmark sessions are left
 * out: they are not real use.
 */
export function kitProfile({ since = "30d", router = null } = {}) {
  const from = parseSince(since);
  const real = (session) => !/^(kittest-|bench)/.test(String(session ?? ""));
  const p = {};
  const row = (n) => (p[n] ??= { name: n, chosen: 0, asks: 0, ms: [], cells: [], costUsd: 0, misroutes: 0, fallbacks: 0, noData: 0 });
  for (const n of router ? [...router.enabled, ...router.hidden] : []) row(n);
  for (const file of journals(STATE_ROOT)) {
    const rel = path.relative(STATE_ROOT, file).split(path.sep);
    if (rel[0] === "kits") continue;
    if (rel[0] === "router") {
      if (rel[1] === "bench.jsonl" || !real(path.basename(file, ".jsonl"))) continue;
      for (const r of readRows(file)) {
        if (!(Date.parse(r.at) >= from)) continue;
        if (r.type === "misroute") row(r.routed).misroutes++;
        else if (r.domain) {
          row(r.domain).chosen++;
          if (r.how === "fallback" && r.from) row(r.from).fallbacks++;
        }
      }
      continue;
    }
    for (const r of readRows(file)) {
      if (r.type !== "ask" || !(Date.parse(r.ts) >= from) || !real(r.session)) continue;
      const e = row(rel[0]);
      e.asks++;
      if (r.ms != null) e.ms.push(r.ms);
      if ((r.cells ?? r.turns) != null) e.cells.push(r.cells ?? r.turns);
      e.costUsd += r.costUsd ?? 0;
      if (r.noData) e.noData++;
    }
  }
  return {
    since: new Date(from).toISOString(),
    kits: Object.values(p)
      .map((e) => ({
        name: e.name,
        chosen: e.chosen,
        asks: e.asks,
        medianSeconds: e.ms.length ? Math.round(median(e.ms) / 100) / 10 : null,
        costUsd: Math.round(e.costUsd * 1e4) / 1e4,
        medianCells: median(e.cells),
        misroutes: e.misroutes,
        fallbacks: e.fallbacks,
        noData: e.noData,
        routerTokens: router?.promptTokens?.[e.name] ?? 0,
        loadMs: router?.loadMs?.[e.name] ?? null,
        ...(router?.hidden?.includes(e.name) ? { hidden: router.skipped[e.name] } : {}),
      }))
      .sort((a, b) => b.chosen - a.chosen || b.asks - a.asks || a.name.localeCompare(b.name)),
  };
}

export function report({ since = "7d" } = {}) {
  const from = parseSince(since);
  const asks = [];
  const scripts = {};
  const handCells = {};
  const misroutes = [];
  const cellsByDir = {};
  let routed = 0;
  for (const file of journals(STATE_ROOT)) {
    const domain = path.relative(STATE_ROOT, file).split(path.sep)[0];
    const dir = path.dirname(file);
    const isRouter = domain === "router";
    if (isRouter && path.basename(file) === "bench.jsonl") continue;
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      if (!line) continue;
      let r;
      try {
        r = JSON.parse(line);
      } catch {
        continue;
      }
      // The router's records: routes it decided itself, and misroutes of those.
      if (isRouter) {
        if (!(Date.parse(r.at) >= from)) continue;
        if (r.type === "misroute") misroutes.push({ at: r.at, question: String(r.question ?? "").slice(0, 140), routed: r.routed, how: r.how, correct: r.correct, why: r.why, journal: file });
        else if (["model", "rules", "pattern", "timeout", "action"].includes(r.how)) routed++;
        continue;
      }
      if (Date.parse(r.ts) < from) continue;
      if (r.type === "ask") asks.push({ ...r, domain, file, dir });
      else if (r.code) {
        if (r.scripts?.length) (cellsByDir[dir] ??= []).push({ session: r.session, t: Date.parse(r.ts), scripts: r.scripts, code: r.code });
        for (const s of r.scripts ?? []) {
          const k = `${domain}/${s.name}${s.draft ? " (draft)" : ""}`;
          const e = (scripts[k] ??= { runs: 0, failed: 0 });
          e.runs++;
          if (!s.ok && !s.saved) e.failed++;
        }
        if (!(r.scripts ?? []).length) {
          const k = `${domain}: ${shapeOf(r.code)}`;
          handCells[k] = (handCells[k] ?? 0) + 1;
        }
      }
    }
  }
  asks.sort((a, b) => a.ts.localeCompare(b.ts));
  const rows = asks.map((a, i) => {
    const signals = [];
    if (!a.ok) signals.push(a.cancelled ? "cancelled" : `failed: ${a.error}`);
    if (a.partial) signals.push(a.cutAtLength ? "cut off" : "stopped short");
    if (a.atLimit) signals.push("answered near the time limit");
    if (a.ms > 90_000) signals.push(`slow (${Math.round(a.ms / 1000)}s)`);
    if (a.costUsd > 0.02) signals.push(`costly ($${a.costUsd.toFixed(3)})`);
    if (a.missteps > 2) signals.push(`${a.missteps} missteps`);
    if (a.ok && !a.answerChars) signals.push("empty answer");
    // The same caller asking again within three minutes, not as a follow-up: the answer fell short.
    const next = asks.slice(i + 1).find((b) => b.session === a.session);
    if (next && !next.continued && Date.parse(next.ts) - Date.parse(a.ts) < 180_000) signals.push(next.backend !== a.backend ? "re-asked on another backend" : "re-asked");
    if (a.actionFellThrough) signals.push(`action ${a.actionFellThrough.action} fell through (${a.actionFellThrough.why})`);
    if (a.citations?.failed) signals.push(`${a.citations.failed} of ${a.citations.checked} citations did not resolve${a.citations.failedList?.length ? `: ${a.citations.failedList.join(", ")}` : ""}`);
    return { ts: a.ts, domain: a.domain, backend: a.backend ?? (a.action ? `action ${a.action}` : a.shot ? "shot" : null), session: a.session, question: String(a.question).slice(0, 140), ms: a.ms, costUsd: a.costUsd ?? null, cells: a.cells ?? a.turns ?? null, shot: !!a.shot, ...(a.citations ? { citations: a.citations } : {}), ...(a.action ? { action: a.action } : {}), signals, journal: a.file };
  });
  const flagged = rows.filter((r) => r.signals.length);
  const total = rows.reduce((s, r) => s + (r.costUsd ?? 0), 0);
  const noModel = rows.filter((r) => r.shot || r.action);
  const real = rows.filter((r) => realSession(r.session));
  const { actions, shadows } = actionsSummary(from);
  // Citations the host checked after each answer (src/citations.mjs), by domain.
  const citations = {};
  for (const r of rows) {
    if (!r.citations) continue;
    const e = (citations[r.domain] ??= { asks: 0, checked: 0, failed: 0, asksWithFailures: 0 });
    e.asks++;
    e.checked += r.citations.checked;
    e.failed += r.citations.failed;
    if (r.citations.failed) e.asksWithFailures++;
  }
  for (const e of Object.values(citations)) e.failedRate = Math.round((e.failed / e.checked) * 100) / 100;
  return {
    since: new Date(from).toISOString(),
    asks: rows.length,
    flagged: flagged.length,
    shots: rows.filter((r) => r.shot).length,
    actionAnswers: rows.filter((r) => r.action).length,
    noModelShare: rows.length ? Math.round((noModel.length / rows.length) * 100) / 100 : null,
    // The same, on real use only (kit tests and benchmarks left out): the measure of promotion.
    realNoModelShare: real.length ? Math.round((real.filter((r) => r.shot || r.action).length / real.length) * 100) / 100 : null,
    costUsd: Math.round(total * 1e4) / 1e4,
    medianSeconds: rows.length ? Math.round([...rows].sort((a, b) => a.ms - b.ms)[Math.floor(rows.length / 2)].ms / 1000) : null,
    flaggedAsks: flagged,
    citations,
    scripts: Object.entries(scripts).sort((a, b) => b[1].runs - a[1].runs).map(([name, s]) => ({ name, ...s })),
    worthAScript: Object.entries(handCells).filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([shape, n]) => ({ shape, n })),
    // Routes the router chose itself (model, rules, pattern, timeout) and those that were wrong.
    routed,
    misroutes: misroutes.sort((a, b) => a.at.localeCompare(b.at)),
    // Actions: runs and fall-throughs, those turned off and why, and shadow runs (both answers).
    actions,
    turnedOff: actions.filter((a) => a.off).map((a) => ({ kit: a.kit, action: a.action, why: a.off, at: a.offAt })),
    shadows,
    worthAnAction: worthAnAction(asks, cellsByDir),
  };
}
