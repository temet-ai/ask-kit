// Citation check: after an investigator answers, the citations in the answer are resolved with no
// model, through the domain's own REPL globals (the same `repo` and `history` the investigator had).
//
//   code domain      `path:line` and `path:line-line`: the file exists and has that many lines. A
//                    shortened path (`stage/mod.rs:12`) is the file the answer named in full, else
//                    the only file in the repository that ends so; a name several files share fails
//   sessions domain  `<source> <session id> #n` (what cite() prints), and `#m` chained after it
//                    with a comma or "and" ("codex 5ca1ab1e #12, #19"): the session has that event
//
// A bare `#41` with no session before it, a path with no line, and a citation past the time
// budget are not checked, and not counted. The answer is not changed here: the caller gets a
// bracketed line only when something did not resolve (see `checkCitations`).

export const BUDGET_MS = 3000;
const MAX_JOURNALED = 10; // the journal row's failedList; the caller's line names every one

const SOURCES = "claude-code|codex|copilot-cli|gemini-cli|opencode";
// host.tld:port is not a file: with no folder in it and a domain-like ending, it is left out.
const HOSTLIKE = /^[\w-]+(\.[\w-]+)*\.(com|org|net|io|dev|ai|co|uk|local|invalid|test|example|localhost)$/i;

/** The `path:line` citations in `text`: [{ key, file, from, to }], first mention of each only. */
export function pathCitations(text) {
  const re = /(?<![\w/.:@~-])((?:\.{0,2}\/)?[\w@.-]+(?:\/[\w@.+-]+)*\.[A-Za-z]\w{0,9}):(\d+)(?:-(\d+))?(?!\d)/g;
  const out = new Map();
  for (const m of String(text).matchAll(re)) {
    if (!m[1].includes("/") && HOSTLIKE.test(m[1])) continue;
    const from = Number(m[2]);
    const to = m[3] ? Number(m[3]) : from;
    const key = `${m[1]}:${m[2]}${m[3] ? `-${m[3]}` : ""}`;
    if (!out.has(key)) out.set(key, { key, file: m[1], from: Math.min(from, to), to: Math.max(from, to) });
  }
  return [...out.values()];
}

/** The `<source> <session> #n` citations in `text`: [{ key, source, session, n }], with `#m` after a comma or "and" taken as the same session. */
export function eventCitations(text) {
  const re = new RegExp(`\\b(${SOURCES})\\s+([A-Za-z0-9][\\w.-]{3,})\\s+#(\\d+)((?:\\s*(?:,|and|&)\\s*#\\d+)*)`, "g");
  const out = new Map();
  for (const m of String(text).matchAll(re)) {
    const ns = [m[3], ...[...m[4].matchAll(/#(\d+)/g)].map((x) => x[1])];
    for (const n of ns) {
      const key = `${m[1]} ${m[2]} #${n}`;
      if (!out.has(key)) out.set(key, { key, source: m[1], session: m[2], n: Number(n) });
    }
  }
  return [...out.values()];
}

// The line is in the file. A file that ends with a newline reports one more (empty) line than it has.
async function hasLine(c, file, g) {
  const r = await g.repo.read(file, { from: c.to, to: c.to });
  return c.to <= r.lines && !(c.to === r.lines && r.text.replace(/^\d+\t/, "") === "");
}

const endsWithPath = (full, short) => full === short || full.endsWith(`/${short}`);

// The file a shortened path means: the one named in full in the answer, else the only one that ends so.
async function fullPath(file, named, filesOf) {
  const short = file.replace(/^(\.{0,2}\/)+/, "");
  if (file.startsWith("../") || !short) return null;
  const inAnswer = [...named].filter((f) => f !== short && endsWithPath(f, short));
  const hits = inAnswer.length === 1 ? inAnswer : (await filesOf()).filter((f) => endsWithPath(f, short));
  return hits.length === 1 ? hits[0] : null;
}

// One citation against the globals: true when it resolves.
async function resolves(c, g, eventsOf, filesOf, named) {
  try {
    if (c.file) {
      try {
        return await hasLine(c, c.file, g);
      } catch {
        const full = await fullPath(c.file, named, filesOf);
        return full ? await hasLine(c, full, g) : false;
      }
    }
    return (await eventsOf(c)).has(c.n);
  } catch {
    return false;
  }
}

/**
 * Check the citations in an answer. Returns null when the domain has nothing to check against or
 * the answer cites nothing checkable; else `{ journal, line }`: `journal` is the ask row's
 * `citations` field ({ checked, failed, failedList? }), `line` the bracketed line to add to the
 * reply ("" when every checked citation resolved).
 */
export async function checkCitations(answer, domain, config, { max = Infinity, budgetMs = BUDGET_MS } = {}) {
  const text = String(answer ?? "");
  if (!text || !["code", "sessions"].includes(domain?.name)) return null;
  let g;
  try {
    g = domain.makeGlobals({ push: () => {}, config });
  } catch {
    return null;
  }
  const list = (g.repo?.read ? pathCitations(text) : g.history?.events ? eventCitations(text) : []).slice(0, max);
  if (!list.length) return null;
  const deadline = Date.now() + budgetMs;
  const sessions = new Map(); // "source session" -> Promise<Set of event numbers>
  const eventsOf = (c) => {
    const k = `${c.source} ${c.session}`;
    if (!sessions.has(k)) sessions.set(k, g.history.events(`${c.source}:${c.session}`).then((ev) => new Set(ev.map((e) => e.i))));
    return sessions.get(k);
  };
  let files = null;
  const filesOf = () => (files ??= g.repo.files());
  const named = new Set(String(text).match(/(?:[\w@.+-]+\/)+[\w@.+-]+\.[A-Za-z]\w{0,9}/g) ?? []);
  let checked = 0;
  const failed = [];
  for (const c of list) {
    const left = deadline - Date.now();
    if (left <= 0) break;
    let timer;
    const ok = await Promise.race([resolves(c, g, eventsOf, filesOf, named), new Promise((r) => (timer = setTimeout(() => r(null), left)))]);
    clearTimeout(timer);
    if (ok === null) break; // out of time: this one and the rest are left unchecked
    checked++;
    if (!ok) failed.push(c.key);
  }
  if (!checked) return null;
  const journal = { checked, failed: failed.length, ...(failed.length ? { failedList: failed.slice(0, MAX_JOURNALED) } : {}) };
  const line = failed.length ? `\n\n[${failed.length} of ${checked} citation${checked === 1 ? "" : "s"} did not resolve: ${failed.join(", ")}]` : "";
  return { journal, line };
}
