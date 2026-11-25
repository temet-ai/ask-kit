// ask-kit mine <kit>: the questions agents dug for by hand on a kit's sources, as draft bench rows.
// Smith's third step (docs/design/smith.md). It reads gaps' scan: every to-answer lookup chain put
// down to the kit (or to a source with no kit yet, by the name `ask-kit gaps` shows), started from a
// typed question. For each it reads the transcript once more for what the agent answered after the
// chain. That answer is where to look, not the expected answer: the code or service may have moved
// on since, so each row is checked by hand against the source before its `expect` is filled in.
//
// Drafts go to STATE_ROOT/drafts/bench/<kit>.json in kit test's format ({id, q, expect}), with
// `found` (the agent's answer, clipped), `source` (agent, session, time), `touched` (what the chain
// read) and `suggest` (identifiers and path:line the answer named, as regex candidates for
// `expect`). Questions already in the kit's bench are left out.
import fs from "node:fs";
import path from "node:path";
import { ADAPTERS, listSessions } from "./transcripts/index.mjs";
import { STATE_ROOT } from "./config.mjs";
import { informative, scan } from "./gaps.mjs";
import { findKit, readManifest } from "./kits.mjs";

const norm = (q) => q.toLowerCase().replace(/\s+/g, " ").trim();
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** What the agent said after the chain, up to the next user turn: its last text, clipped. */
export function answerAfter(events, toolId, max = 1500) {
  const at = events.findIndex((e) => e.role === "tool_call" && e.toolId === toolId);
  if (at < 0) return null;
  const texts = [];
  for (const e of events.slice(at + 1)) {
    if (e.role === "user") break;
    if (e.role === "assistant" && e.text?.trim()) texts.push(e.text.trim());
  }
  if (!texts.length) return null;
  const last = texts.at(-1);
  return last.length > max ? `${last.slice(0, max)}…` : last;
}

/** What the agent answered after each chain, by chain id, clipped. */
export async function answersAfter(chains, max = 600) {
  const out = new Map();
  if (!chains.length) return out;
  const sessions = new Map((await listSessions([...new Set(chains.map((c) => c.source))])).map((s) => [`${s.source}:${s.id}`, s]));
  const events = new Map();
  for (const c of chains) {
    const key = `${c.source}:${c.session}`;
    if (!events.has(key)) {
      const s = sessions.get(key);
      try {
        events.set(key, s ? await ADAPTERS[c.source].events(s) : []);
      } catch {
        events.set(key, []);
      }
    }
    out.set(c.id, answerAfter(events.get(key), c.id, max));
  }
  return out;
}

/** Backticked identifiers and path:line in an answer, as regex candidates for `expect`. */
export function suggestions(text, n = 6) {
  const out = [];
  for (const [, t] of (text ?? "").matchAll(/`([^`\n]{3,80})`/g)) {
    const s = t.replace(/^\/.*?\/(?=(crates|src|lib|app|packages|scripts|test)\/)/, "").replace(/:(\d+)(-\d+)?$/, "");
    if (!/[A-Za-z_]/.test(s) || /\s{2,}/.test(s)) continue;
    const r = esc(s);
    if (!out.includes(r)) out.push(r);
    if (out.length >= n) break;
  }
  return out;
}

/** Does a prompt ask something, rather than set a task? Questions make the best bench rows. */
// "can you", "could you" and "do a" open requests, so those count only with a question mark.
export const questionLike = (p) => /\?\s*$/.test(p ?? "") || /^(where|what|which|why|how|when|who|whose|does|did|is|are|was|were)\b(?! you can\b)/i.test((p ?? "").trim());

const slug = (q) => norm(q).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").split("-").slice(0, 5).join("-") || "q";

/**
 * o: {kit, since, n, sources, scan}. Returns {kit, since, file, considered, rows}. `scan` may be
 * passed in (tests, or a caller that already scanned).
 */
export async function mine(o = {}) {
  if (!o.kit) throw new Error("mine needs a kit or source name, as `ask-kit gaps` lists them");
  const sc = o.scan ?? (await scan({ since: o.since ?? "30d", sources: o.sources }));
  const have = new Set();
  const dir = findKit(o.kit);
  if (dir) {
    try {
      const bench = readManifest(dir)?.bench ?? path.join(dir, "bench", "questions.json");
      for (const q of JSON.parse(fs.readFileSync(path.resolve(dir, bench), "utf8")).questions ?? []) have.add(norm(q.q ?? q.question ?? ""));
    } catch {}
  }
  // A question a review worked out stands in for the prompt that started the chain.
  const { storedQuestions } = await import("./improve.mjs");
  const asked = storedQuestions();
  const ours = sc.chains.map((c) => (asked.has(c.id) ? { ...c, prompt: asked.get(c.id).question, cause: asked.get(c.id).cause } : c)).filter((c) => !["before-edit", "own-output", "not-this-kit"].includes(c.cause));
  const chains = ours.filter((c) => c.kit === o.kit && c.purpose === "to-answer" && c.end !== "ask" && informative(c.prompt));
  // One row per question: the costliest chain that question started.
  const best = new Map();
  for (const c of chains) {
    const k = norm(c.prompt);
    if (have.has(k)) continue;
    if (!best.has(k) || best.get(k).tokens < c.tokens) best.set(k, c);
  }
  // Questions first, then tasks that ended in an answer (a review, a status read); costliest first in each.
  const picked = [...best.values()].sort((a, b) => questionLike(b.prompt) - questionLike(a.prompt) || b.tokens - a.tokens).slice(0, o.n ?? 20);

  const sessions = new Map((await listSessions(o.sources)).map((s) => [`${s.source}:${s.id}`, s]));
  const events = new Map();
  const rows = [];
  const ids = new Set();
  for (const c of picked) {
    const key = `${c.source}:${c.session}`;
    if (!events.has(key)) {
      const s = sessions.get(key);
      try {
        events.set(key, s ? await ADAPTERS[c.source].events(s) : []);
      } catch {
        events.set(key, []);
      }
    }
    const found = answerAfter(events.get(key), c.id);
    let id = slug(c.prompt);
    for (let i = 2; ids.has(id); i++) id = `${slug(c.prompt)}-${i}`;
    ids.add(id);
    rows.push({
      id,
      q: c.prompt,
      expect: [],
      draft: true,
      kind: questionLike(c.prompt) ? "question" : "task",
      found,
      suggest: suggestions(found),
      touched: c.touched?.length ? c.touched : [c.area],
      source: `${c.source} ${c.session} ${c.ts}`,
      tokens: c.tokens,
    });
  }
  const file = path.join(STATE_ROOT, "drafts", "bench", `${o.kit}.json`);
  return { kit: o.kit, since: sc.since, file, considered: chains.length, rows };
}

/** Writes the drafts where `kit test` users look for them, and returns the path. */
export function writeDrafts(r) {
  fs.mkdirSync(path.dirname(r.file), { recursive: true, mode: 0o700 });
  const doc = {
    about: `Draft bench rows for ${r.kit}, mined by \`ask-kit mine\` on ${new Date().toISOString().slice(0, 10)} from to-answer lookup chains since ${r.since.slice(0, 10)}. Each q is a question an agent dug for by hand. Before a row goes into the kit's bench/questions.json: read the answer in the source as it is now (\`found\` is what the agent said then, and may be out of date), fill \`expect\` with regexes the right answer must hold (\`suggest\` has candidates), and drop draft, found, suggest, touched and tokens.`,
    questions: r.rows,
  };
  fs.writeFileSync(r.file, JSON.stringify(doc, null, 2) + "\n");
  return r.file;
}

/** The result as text for the terminal. */
export function formatMine(r) {
  const lines = [`${r.kit}: ${r.considered} to-answer chains from typed questions since ${r.since.slice(0, 10)}; ${r.rows.length} distinct questions drafted.`];
  for (const x of r.rows) {
    lines.push("", `${x.id}  (${x.kind}, ${x.source.split(" ").slice(0, 2).join(" ").slice(0, 30)}, ${Math.round(x.tokens / 1000)}k tokens)`, `  q: ${x.q.slice(0, 200)}`);
    if (x.found) lines.push(`  found: ${x.found.replace(/\s+/g, " ").slice(0, 200)}`);
    if (x.suggest.length) lines.push(`  suggest: ${x.suggest.join("  ")}`);
  }
  return lines.join("\n");
}
