// A small digest per session file: title or first prompt, project, dates and top terms. find-sessions
// ranks on it together with hit counts. Built once per file version (path, mtime, size) and kept in
// STATE_ROOT/index/digests.json, the way `ask-kit gaps` keeps its scan in index/gaps.json. Deleting
// the file is safe; digests are rebuilt when a session is next searched.
import fs from "node:fs";
import path from "node:path";
import { STATE_ROOT } from "../config.mjs";
import { clip } from "./common.mjs";

// Raise when a rule below changes what a stored digest would hold.
const VERSION = 1;
const TERMS = 12;
const STOP = new Set(
  "the and for with that this from have not are was were you your can could would should will what which when where how why did does has had but all any one out use used using into about than then them they there their its it's i'm don't just also more some like need want make see get let now new add run please sure okay yes".split(" "),
);

const file = () => path.join(STATE_ROOT, "index", "digests.json");

/** The stored digests, or {} when there is none, it is unreadable or a rule changed. */
export function loadDigests() {
  try {
    const c = JSON.parse(fs.readFileSync(file(), "utf8"));
    return c.version === VERSION ? c.sessions ?? {} : {};
  } catch {
    return {};
  }
}

export function saveDigests(sessions) {
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true, mode: 0o700 });
    fs.writeFileSync(`${file()}.tmp-${process.pid}`, JSON.stringify({ version: VERSION, sessions }));
    fs.renameSync(`${file()}.tmp-${process.pid}`, file());
  } catch {}
}

/** What identifies one version of a session's file. */
export const stampOf = (s, st) => `${s.file}|${Math.round(st.mtimeMs)}|${st.size}`;

/** The most-used words of what the person typed: distinctive terms first (longer, then more often). */
export function topTerms(texts, n = TERMS) {
  const count = new Map();
  for (const t of texts) {
    for (const w of String(t).toLowerCase().match(/[a-z0-9][a-z0-9_.\-/]{2,}/g) ?? []) {
      const word = w.replace(/[.\-/_]+$/, "");
      if (word.length < 3 || STOP.has(word) || /^\d+$/.test(word)) continue;
      count.set(word, (count.get(word) ?? 0) + 1);
    }
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length).slice(0, n).map(([w]) => w);
}

/** The digest of one session from its events. */
export function buildDigest(s, events) {
  const prompts = events.filter((e) => e.role === "user" && e.text).slice(0, 200);
  const first = prompts[0]?.text ?? null;
  return {
    title: s.title ?? (first ? clip(first.replace(/\s+/g, " ").trim(), 120) : null),
    firstPrompt: first ? clip(first.replace(/\s+/g, " ").trim(), 200) : null,
    project: s.project ?? null,
    startedAt: s.startedAt ?? null,
    updatedAt: s.updatedAt ?? null,
    prompts: prompts.length,
    terms: topTerms([s.title ?? "", ...prompts.map((e) => e.text.slice(0, 2000))]),
  };
}
