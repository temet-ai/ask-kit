// `history`: one API over every agent's transcripts. The sessions domain's REPL gets it as a global.
// Sources are the adapters setup enabled; each turns its agent's own format into the same events.
import { adapter as claudeCode } from "./claude-code.mjs";
import { adapter as codex } from "./codex.mjs";
import { adapter as copilotCli } from "./copilot-cli.mjs";
import { adapter as geminiCli } from "./gemini-cli.mjs";
import { adapter as opencode } from "./opencode.mjs";
import fs from "node:fs";
import os from "node:os";
import { Worker } from "node:worker_threads";
import { clip, filesMayMatch, literalOf } from "./common.mjs";
import { buildDigest, loadDigests, saveDigests, stampOf } from "./digest.mjs";
import { scrubDeep, scrubSecrets } from "./scrub.mjs";
import { STATE_ROOT } from "../config.mjs";

// Parsed events kept in this process (the REPL server, so later cells of an ask and follow-ups
// reuse them), keyed by source, session id, path, mtime and size. The cost of an entry is the
// length of its event texts; the least recently used go first once the total passes the cap
// (ASK_KIT_PARSE_CACHE_MB, default 256; 0 turns the cache off). `parseStats.parses` counts
// adapter parses, `hits` the calls the cache answered.
export const parseStats = { parses: 0, hits: 0 };
const parsedCache = new Map();
let parsedBytes = 0;
const capBytes = () => (process.env.ASK_KIT_PARSE_CACHE_MB != null ? Number(process.env.ASK_KIT_PARSE_CACHE_MB) : 256) * 1024 * 1024;

export function clearParsed() {
  parsedCache.clear();
  parsedBytes = 0;
}

async function parsed(s) {
  let key = null;
  try {
    const st = fs.statSync(s.file);
    key = `${s.source}:${s.id}|${s.file}|${st.mtimeMs}|${st.size}`;
  } catch {}
  const hit = key && parsedCache.get(key);
  if (hit) {
    parsedCache.delete(key);
    parsedCache.set(key, hit);
    parseStats.hits++;
    return hit.events;
  }
  parseStats.parses++;
  const events = await ADAPTERS[s.source].events(s);
  if (!key) return events;
  const cost = events.reduce((n, e) => n + (e.text?.length ?? 0) + 200, 0);
  const cap = capBytes();
  if (cost <= cap / 2) {
    // A newer version of the same session replaces the old one.
    const prefix = key.slice(0, key.indexOf("|", key.indexOf("|") + 1) + 1);
    for (const [k, v] of parsedCache) if (k.startsWith(prefix)) { parsedCache.delete(k); parsedBytes -= v.cost; }
    parsedCache.set(key, { events, cost });
    parsedBytes += cost;
    for (const [k, v] of parsedCache) {
      if (parsedBytes <= cap) break;
      parsedCache.delete(k);
      parsedBytes -= v.cost;
    }
  }
  return events;
}

export const ADAPTERS = Object.fromEntries([claudeCode, codex, copilotCli, geminiCli, opencode].map((a) => [a.name, a]));

/**
 * Every session of the enabled sources, newest first, without ask-kit's own investigators
 * (claude -p, codex exec, copilot -p run in its state folder and write transcripts like any
 * session; they are not the person's work).
 */
export async function listSessions(sources) {
  const list = [];
  for (const n of (sources ?? Object.keys(ADAPTERS)).filter((n) => ADAPTERS[n])) {
    if (!ADAPTERS[n].available()) continue;
    try {
      list.push(...(await ADAPTERS[n].sessions()));
    } catch (e) {
      list.push({ source: n, error: e.message });
    }
  }
  return list
    // "/warm/cwd" also catches investigators from other installs or tools that use the same layout.
    .filter((s) => !s.error && !(s.cwd && (s.cwd.startsWith(STATE_ROOT) || s.cwd.replaceAll("\\", "/").endsWith("/warm/cwd"))))
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
}

const toMs = (x) => (x == null ? null : typeof x === "number" ? Date.now() - x * 3600_000 : Date.parse(x));

/**
 * The events of `sessions` that match `spec` ({ words | re: {source, flags}, roles, max, snippet }),
 * as hits. Each session carries `order`, its place in the search, so parts searched apart can be
 * put back in order. Used in this process and in the search workers.
 */
export async function scanSessions(sessions, spec, deadline = Infinity) {
  const re = spec.re ? new RegExp(spec.re.source, spec.re.flags) : null;
  const words = spec.words ?? [];
  const test = re ? (t) => re.test(t) : (t) => { const l = t.toLowerCase(); return words.every((w) => l.includes(w)); };
  const hits = [];
  let total = 0;
  let scanned = 0;
  let timedOut = false;
  for (const s of sessions) {
    scanned++;
    for (const e of await parsed(s)) {
      if (!spec.roles.includes(e.role) || !e.text || !test(e.text)) continue;
      total++;
      if (hits.length < spec.max) {
        const text = scrubSecrets(e.text);
        const at = re ? text.search(re) : text.toLowerCase().indexOf(words[0]);
        hits.push({ source: s.source, session: s.id, project: s.project, title: scrubSecrets(s.title), i: e.i, ts: e.ts, role: e.role, tool: e.tool, snippet: clip(text.slice(Math.max(0, at - 120)), spec.snippet ?? 240), order: s.order });
      }
    }
    if (Date.now() > deadline) {
      timedOut = true;
      break;
    }
  }
  return { hits, total, scanned, timedOut };
}

// Search workers, started at the first search with enough sessions to be worth splitting
// (PARALLEL_FROM) and kept for the life of the process: up to four, one fewer than the cores.
const PARALLEL_FROM = 32;
// How long a search of a time window runs before it answers from its newest part.
const QUICK_MS = 1500;
let pool;
function searchWorkers() {
  if (pool !== undefined) return pool;
  const want = Math.min(4, os.availableParallelism() - 1);
  if (!(want >= 2)) return (pool = null);
  try {
    const jobs = new Map();
    let seq = 0;
    const env = { ...process.env, ASK_KIT_PARSE_CACHE_MB: String(Math.max(16, Math.floor(capBytes() / 1024 / 1024 / want))) };
    const list = Array.from({ length: want }, () => {
      const w = new Worker(new URL("./scan-worker.mjs", import.meta.url), { env });
      // An idle worker does not keep the process alive: it is held (ref) only while it has a job.
      const idle = () => ![...jobs.values()].some((j) => j.w === w) && w.unref();
      w.on("message", ({ id, result, error }) => {
        const job = jobs.get(id);
        jobs.delete(id);
        idle();
        if (job) error ? job.reject(new Error(error)) : job.resolve(result);
      });
      w.on("error", (e) => {
        for (const [id, job] of jobs) if (job.w === w) (jobs.delete(id), job.reject(e));
        pool = null;
        w.unref();
      });
      w.unref();
      return w;
    });
    const run = (k, sessions, spec, deadline) =>
      new Promise((resolve, reject) => {
        const id = ++seq;
        jobs.set(id, { resolve, reject, w: list[k] });
        list[k].ref();
        list[k].postMessage({ id, sessions, spec, deadline });
      });
    return (pool = { size: want, run });
  } catch {
    return (pool = null);
  }
}
// The same session always goes to the same worker, whose parse cache then holds it.
const workerOf = (s, n) => {
  let h = 0;
  for (const c of `${s.source}:${s.id}`) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % n;
};

export function makeHistory({ sources, push = () => {} }) {
  const enabled = (sources ?? Object.keys(ADAPTERS)).filter((n) => ADAPTERS[n]);
  let cache = null;
  // Searches that answered from their newest step and are finishing the rest, by what was asked.
  const wider = new Map();
  const note = (kind, detail, started, size) => push({ kind, detail, ms: Date.now() - started, size });

  async function all() {
    if (cache && Date.now() - cache.at < 30_000) return cache.list;
    const ok = await listSessions(enabled);
    cache = { at: Date.now(), list: ok };
    return ok;
  }

  function filter(list, o = {}) {
    const since = toMs(o.since);
    const until = toMs(o.until);
    const proj = o.project?.toLowerCase();
    return list.filter(
      (s) =>
        (!o.source || [].concat(o.source).includes(s.source)) &&
        (!since || Date.parse(s.updatedAt) >= since) &&
        (!until || Date.parse(s.startedAt ?? s.updatedAt) <= until) &&
        (!proj || (s.project ?? "").toLowerCase().includes(proj) || (s.cwd ?? "").toLowerCase().includes(proj)) &&
        (!o.cwd || (s.cwd ?? "").startsWith(o.cwd)),
    );
  }

  async function find(ref) {
    if (ref && typeof ref === "object" && ref.source && ref.id) return (await all()).find((s) => s.source === ref.source && s.id === ref.id) ?? ref;
    const id = String(ref ?? "").replace(/^[a-z-]+:/, "");
    const hits = (await all()).filter((s) => s.id === id || s.id.startsWith(id));
    if (!hits.length) throw new Error(`no session ${ref}`);
    if (hits.length > 1 && !hits.some((h) => h.id === id)) throw new Error(`${ref} matches ${hits.length} sessions; give more of the id`);
    return hits.find((h) => h.id === id) ?? hits[0];
  }

  // Everything history returns has keys and tokens masked (scrub.mjs): it goes to a model.
  const strip = ({ file, size, ...s }) => ({ ...scrubDeep(s), kb: size != null ? Math.round(size / 1024) : undefined });

  return {
    sources() {
      return enabled.map((n) => ({ name: n, label: ADAPTERS[n].label, where: ADAPTERS[n].where(), available: ADAPTERS[n].available() }));
    },

    async sessions(o = {}) {
      const started = Date.now();
      const list = filter(await all(), o);
      note("sessions", JSON.stringify(o).slice(0, 120), started, list.length);
      const max = o.limit ?? 50;
      return Object.assign(list.slice(0, max).map(strip), { total: list.length });
    },

    async session(ref) {
      return strip(await find(ref));
    },

    async events(ref, o = {}) {
      const started = Date.now();
      const s = await find(ref);
      let ev = [...(await parsed(s))]; // a copy: the result gets properties, and the cached array stays as parsed
      const total = ev.length;
      if (o.roles) ev = ev.filter((e) => [].concat(o.roles).includes(e.role));
      if (o.from != null) ev = ev.filter((e) => e.i >= o.from);
      if (o.to != null) ev = ev.filter((e) => e.i <= o.to);
      ev = o.maxText ? ev.map((e) => ({ ...scrubDeep({ ...e, input: undefined }), text: clip(scrubSecrets(e.text), o.maxText) })) : ev.map((e) => scrubDeep(e));
      note("events", `${s.source}:${s.id}`, started, ev.length);
      return Object.assign(ev, { total, session: strip(s) });
    },

    async usage(ref) {
      const s = await find(ref);
      return ADAPTERS[s.source].usage(s);
    },

    /**
     * A digest per session (title or first prompt, project, dates, top terms), built once per file
     * version and kept in STATE_ROOT/index/digests.json. `refs` are sessions or {source, id}.
     * Returns the digests in order (null for a session that is gone), with `.built` and `.reused`.
     */
    async digests(refs) {
      const stored = loadDigests();
      const out = [];
      let built = 0;
      let reused = 0;
      for (const ref of refs) {
        let s;
        let st;
        try {
          s = await find(ref);
          st = fs.statSync(s.file);
        } catch {
          out.push(null);
          continue;
        }
        const id = `${s.source}:${s.id}`;
        const stamp = stampOf(s, st);
        if (stored[id]?.stamp === stamp) {
          reused++;
          out.push(stored[id].d);
          continue;
        }
        built++;
        const d = buildDigest(s, await parsed(s));
        stored[id] = { stamp, d };
        out.push(d);
      }
      if (built) saveDigests(stored);
      return Object.assign(out, { built, reused });
    },

    /**
     * Search text across sessions. `query` is words (all must appear in one event, any case) or a
     * RegExp. Files that cannot hold every word are skipped before parsing: for words by their
     * rarest word, for a RegExp by the longest literal it requires (none: no pre-filter).
     */
    async grep(query, o = {}) {
      const started = Date.now();
      const re = query instanceof RegExp ? query : null;
      const words = re ? [] : String(query).toLowerCase().split(/\s+/).filter(Boolean);
      let list = filter(await all(), o);
      if (o.session) list = [await find(o.session)];
      const roles = o.roles ? [].concat(o.roles) : ["user", "assistant", "tool_call", "tool_result"];
      const max = o.max ?? 100;
      const lit = re ? literalOf(re) : null;
      const needles = re ? (lit ? [lit] : []) : words;
      // The last 24 hours, the last 7 days and the rest of the window are searched at the same
      // time. Once the newest part is done, has hits and QUICK_MS have passed while an older part
      // is still running, its hits are returned with `searched` naming it; the search carries on,
      // and the same call again returns the whole window combined. (o.quickMs is for tests.)
      const quick = o.session ? 0 : (o.quickMs ?? QUICK_MS);
      const key = quick ? JSON.stringify([String(query), o.since ?? null, o.until ?? null, o.project ?? null, o.source ?? null, roles, max]) : null;
      // The rest of a search that answered early is collected once; after that the call searches afresh.
      if (key && wider.has(key)) {
        const rest = wider.get(key);
        wider.delete(key);
        return rest;
      }
      const maybe = await filesMayMatch(list.filter((s) => !ADAPTERS[s.source].noPrefilter).map((s) => s.file), needles);
      // What the pre-filter used: the word it searched files for and how many files held it.
      const prefilter = { needle: maybe.needle ?? needles[0] ?? null, listed: maybe.listed ?? null, kept: maybe.size };
      const cand = list.filter((s) => ADAPTERS[s.source].noPrefilter || maybe.has(s.file)).map((s, order) => ({ ...s, order }));
      const spec = { words, re: re ? { source: re.source, flags: re.flags } : null, roles, max, snippet: o.snippet };
      const deadline = started + (o.budgetMs ?? 40_000);
      // With enough sessions the parsing is shared between the search workers; a part is done when every worker's share of it is.
      const workers = cand.length >= PARALLEL_FROM ? searchWorkers() : null;
      const join = (parts) => {
        const hits = parts.flatMap((p) => p.hits).sort((a, b) => a.order - b.order || a.i - b.i).slice(0, max).map(({ order, ...h }) => h);
        const total = parts.reduce((n, p) => n + p.total, 0);
        const timedOut = parts.some((p) => p.timedOut);
        return Object.assign(hits, { total, complete: !timedOut && total <= max, scanned: parts.reduce((n, p) => n + p.scanned, 0), prefilter, ...(timedOut ? { stoppedEarly: "time budget: narrow with since/project/source" } : {}) });
      };
      const search = (sessions) => {
        if (!workers || !sessions.length) return scanSessions(sessions, spec, deadline).then((r) => [r]);
        const shares = Array.from({ length: workers.size }, () => []);
        for (const s of sessions) shares[workerOf(s, workers.size)].push(s);
        // A worker that fails leaves its share to this process.
        return Promise.all(shares.map((share, k) => (share.length ? workers.run(k, share, spec, deadline).catch(() => scanSessions(share, spec, deadline)) : { hits: [], total: 0, scanned: 0 })));
      };
      const age = (s) => started - Date.parse(s.updatedAt);
      const steps = quick
        ? [["the last 24 hours", cand.filter((s) => age(s) <= 86400_000)], ["the last 7 days", cand.filter((s) => age(s) > 86400_000 && age(s) <= 7 * 86400_000)], [null, cand.filter((s) => !(age(s) <= 7 * 86400_000))]]
        : [[null, cand]];
      const running = steps.map(([, sessions]) => search(sessions));
      const whole = Promise.all(running).then((parts) => {
        note("grep", String(query), started, parts.flat().reduce((n, p) => n + p.total, 0));
        return join(parts.flat());
      });
      if (!quick) return whole;
      let finished = false;
      whole.then(() => (finished = true), () => (finished = true));
      const done = [];
      for (let k = 0; k < steps.length - 1; k++) {
        done.push(...(await running[k]));
        // Hits from the newest sessions, time is up, and an older part with sessions in it is still being read.
        const older = steps.slice(k + 1).some(([, sessions]) => sessions.length);
        if (!finished && older && done.some((p) => p.hits.length) && Date.now() - started > quick) {
          wider.set(key, whole);
          if (wider.size > 20) wider.delete(wider.keys().next().value);
          return Object.assign(join(done), { complete: false, searched: steps[k][0], older: "still being searched: the same call again returns the whole window" });
        }
      }
      return whole;
    },
  };
}

/** The standard evidence reference: "codex 5ca1ab1e #42". */
export const cite = (x = {}) => [x.source, x.session ? String(x.session).slice(0, 8) : x.id?.slice(0, 8), x.i != null ? `#${x.i}` : null].filter(Boolean).join(" ");
