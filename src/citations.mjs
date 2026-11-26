// Citation check: after an investigator answers, the citations in the answer are resolved with no
// model, through the domain's own REPL globals (the same `repo` and `history` the investigator had).
//
//   code domain      `path:line` and `path:line-line`: the file exists and has that many lines. A
//                    shortened path (`stage/mod.rs:12`) is the file the answer named in full, else
//                    the only file in the repository that ends so; a name several files share fails.
//                    A relative path is looked for first in the other repositories the question or
//                    the answer names (by a path inside them, or a repository beside this one by
//                    its folder name in the question), then in this one
//   sessions domain  `<source> <session id> #n` (what cite() prints), and `#m` chained after it
//                    with a comma or "and" ("codex 5ca1ab1e #12, #19"): the session has that event
//
// A bare `#41` with no session before it, a path with no line, and a citation past the time
// budget are not checked, and not counted. The answer is not changed here: the caller gets a
// bracketed line only when something did not resolve (see `checkCitations`).

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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
  if (r.missing) throw new Error(r.missing); // the code domain notes a path that is not there instead of throwing
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

// ---- the repository a citation is in ----

const HOME = os.homedir();
const real = (p) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
};
// A checkout in .claude/worktrees/<name> sits beside its main checkout's neighbours.
const mainOf = (root) => root.replace(/\/\.claude\/worktrees\/[^/]+$/, "");

/** The top folder of the git repository that holds `p` (or the nearest folder of it that exists), or null. The home folder is never one. */
export function repoHolding(p) {
  let d = path.resolve(p);
  while (!fs.existsSync(d) && d !== path.dirname(d)) d = path.dirname(d);
  try {
    if (!fs.statSync(d).isDirectory()) d = path.dirname(d);
  } catch {
    return null;
  }
  for (; d !== path.dirname(d) && d !== HOME; d = path.dirname(d)) if (fs.existsSync(path.join(d, ".git"))) return real(d);
  return null;
}

/**
 * The repositories other than `root` that the question or the answer names, most named first: the
 * repository that holds each absolute or ~/ path in either, and a repository beside `root` whose
 * folder name the question says as a word ("why does the semaphore-tower judge skip a commit").
 */
export function namedRepos(question, answer, root) {
  const here = root ? real(root) : null;
  const n = new Map();
  const add = (r, w = 1) => r && r !== here && n.set(r, (n.get(r) ?? 0) + w);
  const paths = new Map();
  for (const t of [question, answer]) {
    for (const m of String(t ?? "").matchAll(/(?<![\w.~:/-])(?:~(?=\/)|(?=\/))(\/[\w@.+-]+)+/g)) {
      const p = m[0].startsWith("~") ? path.join(HOME, m[0].slice(1)) : m[0];
      const top = paths.has(p) ? paths.get(p) : paths.set(p, repoHolding(p)).get(p);
      add(top);
    }
  }
  if (here) {
    const beside = path.dirname(mainOf(here));
    let names = [];
    try {
      names = fs.readdirSync(beside).filter((d) => d.length >= 3 && fs.existsSync(path.join(beside, d, ".git"))).slice(0, 400);
    } catch {}
    for (const d of names) {
      const re = new RegExp(`(?<![\\w./-])${d.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w/-])`, "i");
      if (re.test(String(question ?? ""))) add(real(path.join(beside, d)), 2);
    }
  }
  return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([r]) => r).slice(0, 5);
}

// In another repository: the only file of its own that ends so, among several the one whose longer
// path the answer gives.
async function fullPathIn(file, named, filesOf) {
  const short = file.replace(/^(\.{0,2}\/)+/, "");
  if (file.startsWith("../") || !short) return null;
  let hits = (await filesOf()).filter((f) => endsWithPath(f, short));
  if (hits.length > 1) hits = hits.filter((f) => [...named].some((n) => n !== short && endsWithPath(n, short) && endsWithPath(f, n)));
  return hits.length === 1 ? hits[0] : null;
}

/** The files git knows in a repository, relative to it. */
const gitFiles = (root) =>
  new Promise((resolve) =>
    execFile("git", ["-C", root, "ls-files", "--cached", "--others", "--exclude-standard"], { encoding: "utf8", maxBuffer: 64 << 20, timeout: 10_000 }, (err, out) => resolve(err ? [] : out.split("\n").filter(Boolean))),
  );

// One citation against the globals: true when it resolves in the domain's own repository, "other"
// when in another one. A relative path is tried in each named repository, then in the domain's own.
async function resolves(c, g, eventsOf, filesOf, named, others) {
  try {
    if (c.file) {
      const relative = !path.isAbsolute(c.file) && !c.file.startsWith("../");
      for (const o of relative ? others : []) {
        if (await hasLine(c, path.join(o.root, c.file), g).catch(() => false)) return "other";
      }
      try {
        if (await hasLine(c, c.file, g)) return true;
      } catch {}
      for (const o of relative ? others : []) {
        const full = await fullPathIn(c.file, named, o.files);
        if (full && (await hasLine(c, path.join(o.root, full), g).catch(() => false))) return "other";
      }
      const full = await fullPath(c.file, named, filesOf);
      return full ? await hasLine(c, full, g) : false;
    }
    return (await eventsOf(c)).has(c.n);
  } catch {
    return false;
  }
}

/**
 * Check the citations in an answer. Returns null when the domain has nothing to check against or
 * the answer cites nothing checkable; else `{ journal, line }`: `journal` is the ask row's
 * `citations` field ({ checked, failed, failedList?, otherRepo? }), `line` the bracketed line to add to the
 * reply ("" when every checked citation resolved).
 */
export async function checkCitations(answer, domain, config, { max = Infinity, budgetMs = BUDGET_MS, question = "" } = {}) {
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
  // Other repositories the question or the answer names: their files are listed once, when needed.
  const others = g.repo?.read ? namedRepos(question, text, g.repo.root).map((root) => {
    let list = null;
    return { root, files: () => (list ??= gitFiles(root)) };
  }) : [];
  let checked = 0;
  let otherRepo = 0;
  const failed = [];
  for (const c of list) {
    const left = deadline - Date.now();
    if (left <= 0) break;
    let timer;
    const ok = await Promise.race([resolves(c, g, eventsOf, filesOf, named, others), new Promise((r) => (timer = setTimeout(() => r(null), left)))]);
    clearTimeout(timer);
    if (ok === null) break; // out of time: this one and the rest are left unchecked
    checked++;
    if (!ok) failed.push(c.key);
    else if (ok === "other") otherRepo++;
  }
  if (!checked) return null;
  const journal = { checked, failed: failed.length, ...(failed.length ? { failedList: failed.slice(0, MAX_JOURNALED) } : {}), ...(otherRepo ? { otherRepo } : {}) };
  const line = failed.length ? `\n\n[${failed.length} of ${checked} citation${checked === 1 ? "" : "s"} did not resolve: ${failed.join(", ")}]` : "";
  return { journal, line };
}
