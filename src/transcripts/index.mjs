// `history`: one API over every agent's transcripts. The sessions domain's REPL gets it as a global.
// Sources are the adapters setup enabled; each turns its agent's own format into the same events.
import { adapter as claudeCode } from "./claude-code.mjs";
import { adapter as codex } from "./codex.mjs";
import { adapter as copilotCli } from "./copilot-cli.mjs";
import { adapter as geminiCli } from "./gemini-cli.mjs";
import { adapter as opencode } from "./opencode.mjs";
import fs from "node:fs";
import { clip, filesMayMatch, literalOf } from "./common.mjs";
import { buildDigest, loadDigests, saveDigests, stampOf } from "./digest.mjs";
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

export function makeHistory({ sources, push = () => {} }) {
  const enabled = (sources ?? Object.keys(ADAPTERS)).filter((n) => ADAPTERS[n]);
  let cache = null;
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

  const strip = ({ file, size, ...s }) => ({ ...s, kb: size != null ? Math.round(size / 1024) : undefined });

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
      if (o.maxText) ev = ev.map((e) => ({ ...e, text: clip(e.text, o.maxText), input: undefined }));
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
      const test = re ? (t) => re.test(t) : (t) => { const l = t.toLowerCase(); return words.every((w) => l.includes(w)); };
      let list = filter(await all(), o);
      if (o.session) list = [await find(o.session)];
      const roles = o.roles ? [].concat(o.roles) : ["user", "assistant", "tool_call", "tool_result"];
      const max = o.max ?? 100;
      const hits = [];
      let scanned = 0;
      let total = 0;
      const lit = re ? literalOf(re) : null;
      const needles = re ? (lit ? [lit] : []) : words;
      const maybe = await filesMayMatch(list.filter((s) => !ADAPTERS[s.source].noPrefilter).map((s) => s.file), needles);
      // What the pre-filter used: the word it searched files for and how many files held it.
      const prefilter = { needle: maybe.needle ?? needles[0] ?? null, listed: maybe.listed ?? null, kept: maybe.size };
      for (const s of list) {
        if (!ADAPTERS[s.source].noPrefilter && !maybe.has(s.file)) continue;
        scanned++;
        for (const e of await parsed(s)) {
          if (!roles.includes(e.role) || !e.text || !test(e.text)) continue;
          total++;
          if (hits.length < max) {
            const at = re ? e.text.search(re) : e.text.toLowerCase().indexOf(words[0]);
            hits.push({ source: s.source, session: s.id, project: s.project, title: s.title, i: e.i, ts: e.ts, role: e.role, tool: e.tool, snippet: clip(e.text.slice(Math.max(0, at - 120)), o.snippet ?? 300) });
          }
        }
        if (Date.now() - started > (o.budgetMs ?? 40_000)) {
          note("grep", String(query), started, total);
          return Object.assign(hits, { total, complete: false, scanned, prefilter, stoppedEarly: "time budget: narrow with since/project/source" });
        }
      }
      note("grep", String(query), started, total);
      return Object.assign(hits, { total, complete: total <= max, scanned, prefilter });
    },
  };
}

/** The standard evidence reference: "codex 5ca1ab1e #42". */
export const cite = (x = {}) => [x.source, x.session ? String(x.session).slice(0, 8) : x.id?.slice(0, 8), x.i != null ? `#${x.i}` : null].filter(Boolean).join(" ");
