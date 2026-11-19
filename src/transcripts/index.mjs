// `history`: one API over every agent's transcripts. The sessions domain's REPL gets it as a global.
// Sources are the adapters setup enabled; each turns its agent's own format into the same events.
import { adapter as claudeCode } from "./claude-code.mjs";
import { adapter as codex } from "./codex.mjs";
import { adapter as copilotCli } from "./copilot-cli.mjs";
import { adapter as geminiCli } from "./gemini-cli.mjs";
import { adapter as opencode } from "./opencode.mjs";
import { clip, filesMayMatch } from "./common.mjs";
import { STATE_ROOT } from "../config.mjs";

export const ADAPTERS = Object.fromEntries([claudeCode, codex, copilotCli, geminiCli, opencode].map((a) => [a.name, a]));

const toMs = (x) => (x == null ? null : typeof x === "number" ? Date.now() - x * 3600_000 : Date.parse(x));

export function makeHistory({ sources, push = () => {} }) {
  const enabled = (sources ?? Object.keys(ADAPTERS)).filter((n) => ADAPTERS[n]);
  let cache = null;
  const note = (kind, detail, started, size) => push({ kind, detail, ms: Date.now() - started, size });

  async function all() {
    if (cache && Date.now() - cache.at < 30_000) return cache.list;
    const list = [];
    for (const n of enabled) {
      if (!ADAPTERS[n].available()) continue;
      try {
        list.push(...(await ADAPTERS[n].sessions()));
      } catch (e) {
        list.push({ source: n, error: e.message });
      }
    }
    // ask-kit's own investigators (claude -p, codex exec, copilot -p) run in its state folder and
    // write transcripts like any session; they are not the person's work.
    const ok = list
      // "/warm/cwd" also catches investigators from other installs or tools that use the same layout.
      .filter((s) => !s.error && !(s.cwd && (s.cwd.startsWith(STATE_ROOT) || s.cwd.replaceAll("\\", "/").endsWith("/warm/cwd"))))
      .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
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
      let ev = await ADAPTERS[s.source].events(s);
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
     * Search text across sessions. `query` is words (all must appear in one event, any case) or a
     * RegExp. Files that cannot hold every word are skipped before parsing.
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
      const maybe = await filesMayMatch(list.filter((s) => !ADAPTERS[s.source].noPrefilter).map((s) => s.file), words);
      for (const s of list) {
        if (!ADAPTERS[s.source].noPrefilter && !maybe.has(s.file)) continue;
        scanned++;
        for (const e of await ADAPTERS[s.source].events(s)) {
          if (!roles.includes(e.role) || !e.text || !test(e.text)) continue;
          total++;
          if (hits.length < max) {
            const at = re ? e.text.search(re) : e.text.toLowerCase().indexOf(words[0]);
            hits.push({ source: s.source, session: s.id, project: s.project, title: s.title, i: e.i, ts: e.ts, role: e.role, tool: e.tool, snippet: clip(e.text.slice(Math.max(0, at - 120)), o.snippet ?? 300) });
          }
        }
        if (Date.now() - started > (o.budgetMs ?? 40_000)) {
          note("grep", String(query), started, total);
          return Object.assign(hits, { total, complete: false, scanned, stoppedEarly: "time budget: narrow with since/project/source" });
        }
      }
      note("grep", String(query), started, total);
      return Object.assign(hits, { total, complete: total <= max, scanned });
    },
  };
}

/** The standard evidence reference: "codex 5ca1ab1e #42". */
export const cite = (x = {}) => [x.source, x.session ? String(x.session).slice(0, 8) : x.id?.slice(0, 8), x.i != null ? `#${x.i}` : null].filter(Boolean).join(" ");
