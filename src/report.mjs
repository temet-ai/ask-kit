// What the journals say about how `ask` is doing: every ask with its feedback signals, which
// scripts were used, and the cell shapes that keep being written by hand (routes worth a script).
// Read by the ask-kit-improve skill and the ask-kit-tuner agent.
import fs from "node:fs";
import path from "node:path";
import { STATE_ROOT } from "./config.mjs";

function journals(dir, out = []) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory() && !["warm", "drafts", "gallery", "index"].includes(e.name)) journals(full, out);
    else if (e.name.endsWith(".jsonl")) out.push(full);
  }
  return out;
}

const parseSince = (s) => {
  const m = String(s ?? "7d").match(/^(\d+)([hd])$/);
  if (m) return Date.now() - Number(m[1]) * (m[2] === "d" ? 86400_000 : 3600_000);
  const t = Date.parse(s);
  if (Number.isNaN(t)) throw new Error(`--since ${s}: use 24h, 7d or a date`);
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
  let routed = 0;
  for (const file of journals(STATE_ROOT)) {
    const domain = path.relative(STATE_ROOT, file).split(path.sep)[0];
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
        else if (["model", "rules", "pattern", "timeout"].includes(r.how)) routed++;
        continue;
      }
      if (Date.parse(r.ts) < from) continue;
      if (r.type === "ask") asks.push({ ...r, domain, file });
      else if (r.code) {
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
    if (a.partial) signals.push(a.cutAtLength ? "cut off" : "out of steps or time");
    if (a.atLimit) signals.push("answered near the time limit");
    if (a.ms > 90_000) signals.push(`slow (${Math.round(a.ms / 1000)}s)`);
    if (a.costUsd > 0.02) signals.push(`costly ($${a.costUsd.toFixed(3)})`);
    if (a.missteps > 2) signals.push(`${a.missteps} missteps`);
    if (a.ok && !a.answerChars) signals.push("empty answer");
    // The same caller asking again within three minutes, not as a follow-up: the answer fell short.
    const next = asks.slice(i + 1).find((b) => b.session === a.session);
    if (next && !next.continued && Date.parse(next.ts) - Date.parse(a.ts) < 180_000) signals.push(next.backend !== a.backend ? "re-asked on another backend" : "re-asked");
    return { ts: a.ts, domain: a.domain, backend: a.backend, session: a.session, question: String(a.question).slice(0, 140), ms: a.ms, costUsd: a.costUsd ?? null, cells: a.cells ?? a.turns ?? null, shot: !!a.shot, signals, journal: a.file };
  });
  const flagged = rows.filter((r) => r.signals.length);
  const total = rows.reduce((s, r) => s + (r.costUsd ?? 0), 0);
  return {
    since: new Date(from).toISOString(),
    asks: rows.length,
    flagged: flagged.length,
    shots: rows.filter((r) => r.shot).length,
    noModelShare: rows.length ? Math.round((rows.filter((r) => r.shot).length / rows.length) * 100) / 100 : null,
    costUsd: Math.round(total * 1e4) / 1e4,
    medianSeconds: rows.length ? Math.round([...rows].sort((a, b) => a.ms - b.ms)[Math.floor(rows.length / 2)].ms / 1000) : null,
    flaggedAsks: flagged,
    scripts: Object.entries(scripts).sort((a, b) => b[1].runs - a[1].runs).map(([name, s]) => ({ name, ...s })),
    worthAScript: Object.entries(handCells).filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([shape, n]) => ({ shape, n })),
    // Routes the router chose itself (model, rules, pattern, timeout) and those that were wrong.
    routed,
    misroutes: misroutes.sort((a, b) => a.at.localeCompare(b.at)),
  };
}
