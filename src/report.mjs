// What the journals say about how `ask` is doing: every ask with its feedback signals, which
// scripts were used, and the cell shapes that keep being written by hand (routes worth a script).
// Read by the ask-kit-improve skill and the ask-kit-tuner agent.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { STATE_ROOT } from "./config.mjs";
import { actionsDir, readLog, readState, windowOf } from "./actions.mjs";
import { placeOf, stateRoots } from "./machines.mjs";
import { reviewOf } from "./review.mjs";

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
export function actionsSummary(from, { kit: selectedKit = null, real = false, until = Infinity } = {}) {
  const out = { actions: [], shadows: [] };
  const logs = {};
  for (const root of stateRoots()) {
    let files = [];
    try {
      files = fs.readdirSync(path.join(root, "actions")).filter((f) => f.endsWith(".jsonl"));
    } catch {}
    for (const f of files) (logs[f.slice(0, -6)] ??= []).push(...(root === STATE_ROOT ? readLog(f.slice(0, -6)) : readRows(path.join(root, "actions", f))));
  }
  for (const [kit, log] of Object.entries(logs)) {
    if (selectedKit && kit !== selectedKit) continue;
    const rows = log.filter((r) => Date.parse(r.at) <= until && (!real || realSession(r.session)));
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
    if (e.isDirectory() && !["warm", "drafts", "gallery", "index", "actions", "nudges", "improvements"].includes(e.name)) journals(full, out);
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
        const r = JSON.parse(l);
        return r && typeof r === "object" && !Array.isArray(r) ? [r] : [];
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
    const { rel } = placeOf(file);
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

export function report({ since = "7d", kit = null, real = false, until = null } = {}) {
  if (kit != null && !/^[a-z][a-z0-9-]*$/.test(kit)) throw new Error("--kit needs a kit or domain name");
  const from = parseSince(since);
  const to = until == null ? Infinity : parseSince(until);
  const asks = [];
  const scripts = {};
  const handCells = {};
  const misroutes = [];
  const cellsByDir = {};
  const reviewFindings = [];
  const outcomes = [];
  const unattributedCells = [];
  let routed = 0;
  // afterMs of each ask that became a background task (the router's {task, afterMs} row).
  const taskHandoffs = [];
  // How those tasks ended (the router's {task, done, ms} row); a task still running has no row yet.
  const taskEnds = { answered: 0, failed: 0, cancelled: 0, stopped: 0 };
  const files = journals(STATE_ROOT).filter((file) => !kit || [kit, "router"].includes(placeOf(file).rel[0]));
  const entries = files.map((file) => ({ file, rows: readRows(file) }));
  // Older cells have no caller field. Link their investigator id to the benchmark's ask row.
  const askLinks = new Map();
  const legacyAsks = [];
  for (const { file, rows } of entries) for (const r of rows) {
    if (r.type !== "ask") continue;
    const dir = path.dirname(file);
    if (r.askId) askLinks.set(`${dir}/${`ask-${r.askId}`}`, realSession(r.session));
    else if (Number.isFinite(Date.parse(r.ts)) && Number.isFinite(r.ms)) legacyAsks.push({ ...r, dir, end: Date.parse(r.ts) });
  }
  for (const { file, rows: records } of entries) {
    const domain = placeOf(file).rel[0];
    const dir = path.dirname(file);
    const isRouter = domain === "router";
    if (isRouter && path.basename(file) === "bench.jsonl") continue;
    if (domain === "kits") continue;
    if (real && !realSession(path.basename(file, ".jsonl"))) continue;
    for (const r of records) {
      if (real && (!realSession(r.caller ?? r.session) || askLinks.get(`${dir}/${r.session}`) === false)) continue;
      // The router's records: routes it decided itself, and misroutes of those.
      if (isRouter) {
        if (!(Date.parse(r.at) >= from && Date.parse(r.at) <= to)) continue;
        if (kit && ![r.domain, r.routed, r.correct].includes(kit)) continue;
        if (r.type === "misroute") misroutes.push({ at: r.at, question: String(r.question ?? "").slice(0, 140), routed: r.routed, how: r.how, correct: r.correct, why: r.why, journal: file });
        else if (typeof r.task === "string" && Number.isFinite(r.afterMs)) taskHandoffs.push(r.afterMs);
        else if (typeof r.task === "string" && r.done in taskEnds) taskEnds[r.done]++;
        else if (["model", "rules", "pattern", "timeout", "action"].includes(r.how)) routed++;
        continue;
      }
      if (!(Date.parse(r.ts) >= from && Date.parse(r.ts) <= to)) continue;
      if (r.type === "ask") asks.push({ ...r, domain, file, dir });
      else if (r.type === "outcome") {
        const review = reviewOf(r);
        const signals = [...(r.ok === false ? [`failed: ${String(r.error ?? "unknown error").slice(0, 300)}`] : []), ...(review && review.status !== "pass" ? [`review ${review.status}`] : [])];
        outcomes.push({ ts: r.ts, domain, session: r.session, jobId: r.jobId, ok: r.ok, ms: r.ms, ...(review ? { review } : {}), signals, journal: file });
      } else if (typeof r.code === "string") {
        if (real && !r.caller && !askLinks.has(`${dir}/${r.session}`)) {
          // Old CLI investigators used an unrelated UUID, with no askId or caller. Attribute
          // only an unambiguous window; warm-up and orphan cells are not evidence of real use.
          const t = Date.parse(r.ts);
          const candidates = legacyAsks.filter((a) => a.dir === dir && t >= a.end - a.ms - 1000 && t <= a.end + 1000);
          if (candidates.length !== 1) {
            unattributedCells.push({ ts: r.ts, domain, session: r.session, journal: file });
            continue;
          }
          if (!realSession(candidates[0].session)) continue;
        }
        r.scripts = Array.isArray(r.scripts) ? r.scripts.filter((s) => s && typeof s === "object") : [];
        if (r.scripts?.length) (cellsByDir[dir] ??= []).push({ session: r.session, t: Date.parse(r.ts), scripts: r.scripts, code: r.code });
        for (const s of r.scripts ?? []) {
          const k = `${domain}/${s.name}${s.draft ? " (draft)" : ""}`;
          const e = (scripts[k] ??= { runs: 0, failed: 0 });
          e.runs++;
          if (!s.ok && !s.saved) e.failed++;
          const review = reviewOf(s);
          if (review && review.status !== "pass") {
            e[review.status] = (e[review.status] ?? 0) + 1;
            reviewFindings.push({ ts: r.ts, domain, session: r.session, caller: r.caller, script: s.name, ...review, journal: file, dir });
          }
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
    const end = Date.parse(a.ts);
    const start = Number.isFinite(Date.parse(a.startedAt)) ? Date.parse(a.startedAt) : end - (a.ms ?? 0);
    const reviews = Array.isArray(a.reviews) ? a.reviews : reviewFindings.filter((r) => r.domain === a.domain && r.dir === a.dir && (a.askId ? r.session === `ask-${a.askId}` : r.caller === a.session) && Date.parse(r.ts) >= start && Date.parse(r.ts) <= end);
    for (const status of new Set(reviews.map((r) => r.status).filter((s) => ["needs_review", "unverified"].includes(s)))) signals.push(`review ${status}`);
    if (!a.ok) signals.push(a.cancelled ? "cancelled" : `failed: ${a.error}`);
    if (a.partial) signals.push(a.cutAtLength ? "cut off" : "stopped short");
    if (a.atLimit) signals.push("answered near the time limit");
    if (a.ms > 90_000) signals.push(`slow (${Math.round(a.ms / 1000)}s)`);
    if (a.costUsd > 0.02) signals.push(`costly ($${a.costUsd.toFixed(3)})`);
    if (a.missteps > 2) signals.push(`${a.missteps} missteps`);
    if (a.ok && !a.answerChars) signals.push("empty answer");
    // The same caller asking again within three minutes, not as a follow-up: the answer fell short.
    const next = asks.slice(i + 1).find((b) => b.session === a.session && b.domain === a.domain && b.dir === a.dir);
    const nextStart = next ? (Number.isFinite(Date.parse(next.startedAt)) ? Date.parse(next.startedAt) : Date.parse(next.ts) - (next.ms ?? 0)) : NaN;
    if (next && !next.continued && nextStart >= end && nextStart - end < 180_000) signals.push(next.backend !== a.backend ? "re-asked on another backend" : "re-asked");
    if (a.actionFellThrough) signals.push(`action ${a.actionFellThrough.action} fell through (${a.actionFellThrough.why})`);
    if (a.citations?.failed) signals.push(`${a.citations.failed} of ${a.citations.checked} citations did not resolve${a.citations.failedList?.length ? `: ${a.citations.failedList.join(", ")}` : ""}`);
    return { ts: a.ts, ...(placeOf(a.file).machine ? { machine: placeOf(a.file).machine } : {}), domain: a.domain, backend: a.backend ?? (a.action ? `action ${a.action}` : a.shot ? "shot" : null), session: a.session, question: String(a.question).slice(0, 140), ms: a.ms, costUsd: a.costUsd ?? null, cells: a.cells ?? a.turns ?? null, shot: !!a.shot, ...(a.citations ? { citations: a.citations } : {}), ...(a.action ? { action: a.action } : {}), signals, journal: a.file };
  });
  const flagged = rows.filter((r) => r.signals.length);
  const total = rows.reduce((s, r) => s + (r.costUsd ?? 0), 0);
  const noModel = rows.filter((r) => r.shot || r.action);
  const realRows = rows.filter((r) => realSession(r.session));
  const { actions, shadows } = actionsSummary(from, { kit, real, until: to });
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
    ...(until ? { until: new Date(to).toISOString() } : {}),
    ...(kit ? { kit } : {}),
    realOnly: real,
    asks: rows.length,
    flagged: flagged.length,
    shots: rows.filter((r) => r.shot).length,
    actionAnswers: rows.filter((r) => r.action).length,
    noModelShare: rows.length ? Math.round((noModel.length / rows.length) * 100) / 100 : null,
    // The same, on real use only (kit tests and benchmarks left out): the measure of promotion.
    realNoModelShare: realRows.length ? Math.round((realRows.filter((r) => r.shot || r.action).length / realRows.length) * 100) / 100 : null,
    costUsd: Math.round(total * 1e4) / 1e4,
    medianSeconds: rows.length ? Math.round([...rows].sort((a, b) => a.ms - b.ms)[Math.floor(rows.length / 2)].ms / 1000) : null,
    flaggedAsks: flagged,
    outcomes: outcomes.length,
    flaggedOutcomes: outcomes.filter((r) => r.signals.length),
    reviewFindings: reviewFindings.map(({ dir, ...r }) => r),
    unattributedCells: unattributedCells.length,
    unattributedExamples: unattributedCells.slice(0, 20),
    // Asks told to stop searching because their cells kept repeating, and asks with a cell that could not reach a source.
    asksStuck: asks.filter((a) => a.stuck > 0).length,
    asksUnreached: asks.filter((a) => a.unreached > 0).length,
    citations,
    scripts: Object.entries(scripts).sort((a, b) => b[1].runs - a[1].runs).map(([name, s]) => ({ name, ...s })),
    worthAScript: Object.entries(handCells).filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([shape, n]) => ({ shape, n })),
    // Routes the router chose itself (model, rules, pattern, timeout) and those that were wrong.
    routed,
    // Asks that ran past the hand-off delay and were answered as background tasks.
    tasks: taskHandoffs.length,
    tasksAnswered: taskEnds.answered,
    tasksFailed: taskEnds.failed,
    tasksCancelled: taskEnds.cancelled,
    tasksStopped: taskEnds.stopped,
    taskMedianHandoffSeconds: taskHandoffs.length ? Math.round([...taskHandoffs].sort((a, b) => a - b)[Math.floor(taskHandoffs.length / 2)] / 1000) : null,
    misroutes: misroutes.sort((a, b) => a.at.localeCompare(b.at)),
    // Actions: runs and fall-throughs, those turned off and why, and shadow runs (both answers).
    actions,
    turnedOff: actions.filter((a) => a.off).map((a) => ({ kit: a.kit, action: a.action, why: a.off, at: a.offAt })),
    shadows,
    worthAnAction: worthAnAction(asks, cellsByDir),
  };
}
