// Per-kit review queue and completion records. Reading a brief runs no kit code or model;
// the tuning agent makes and verifies changes, then records what it did here.
import fs from "node:fs";
import path from "node:path";
import { STATE_ROOT } from "./config.mjs";
import { listDomains, domainDirs } from "./domains.mjs";
import { findKit } from "./kits.mjs";
import { report, parseSince } from "./report.mjs";
import { informative, scan } from "./gaps.mjs";
import { findingsAbout, joinLocal, outcomesOf } from "./join.mjs";
import { machineEvidence, stateRoots } from "./machines.mjs";
import { answersAfter } from "./mine.mjs";

const REVIEWS = ["changed", "no-change", "blocked"];
const OUTCOMES = [...REVIEWS, "labelled"];
// Labels are not reviews: they move no review window.
const reviewsIn = (history) => history.filter((r) => REVIEWS.includes(r.outcome));
// Why a chain was dug by hand. `gap`, `not-reached` and `fell-short` are the kit's to fix.
export const CAUSES = {
  gap: "the kit has nothing that answers it",
  "not-reached": "the kit answers it, and was not asked",
  "fell-short": "an ask before it left it out, or had not answered yet",
  "before-edit": "reading what the session was about to change",
  "own-output": "checking its own work, logs or files",
  "not-this-kit": "another source's question, or none",
};
const OPEN = ["gap", "not-reached", "fell-short"];
const NAME = /^[a-z][a-z0-9-]*$/;
const historyDir = () => path.join(STATE_ROOT, "improvements");
const historyFile = (kit) => path.join(historyDir(), `${kit}.jsonl`);

function checkName(kit) {
  if (!NAME.test(kit ?? "")) throw new Error("improve needs a kit or domain name");
}

export function improvementHistory(kit) {
  checkName(kit);
  return stateRoots().flatMap((root) => {
    const machine = root === STATE_ROOT ? null : path.basename(root);
    try {
      return fs.readFileSync(path.join(root, "improvements", `${kit}.jsonl`), "utf8").split("\n").filter(Boolean).flatMap((line) => {
        try {
          const r = JSON.parse(line);
          return r && OUTCOMES.includes(r.outcome) && Number.isFinite(Date.parse(r.through)) ? [machine ? { ...r, machine } : r] : [];
        } catch {
          return [];
        }
      });
    } catch (e) {
      if (e.code === "ENOENT") return [];
      throw e;
    }
  }).sort((a, b) => Date.parse(a.through) - Date.parse(b.through) || String(a.at).localeCompare(String(b.at)));
}

function sourceOf(kit) {
  const linked = findKit(kit);
  if (linked) return fs.realpathSync(linked);
  return domainDirs().map((d) => path.join(d, kit)).find((d) => fs.existsSync(path.join(d, "domain.mjs"))) ?? null;
}

/** How far back an unreviewed chain still waits for its question. */
const CHAIN_DAYS = 30;

/**
 * The lookup chains agents ran by hand that were this kit's to answer and that no review has given a
 * question: those that ended in an answer (no edit after them, not cut short by an ask), of the last
 * 30 days, up to `through`. Only a stored question closes one. `scanned` is a gaps scan to reuse.
 */
export async function handChains(kit, through, scanned) {
  const hi = Date.parse(through), lo = hi - CHAIN_DAYS * 86400_000;
  const sc = scanned ?? (await scan({ since: new Date(lo).toISOString() }));
  const ids = new Set(sc.chains.map((c) => c.id));
  const all = [...sc.chains, ...(scanned?.local ? [] : machineEvidence().chains.filter((c) => !ids.has(c.id)))];
  const done = storedQuestions();
  return all.filter((c) => c.kit === kit && c.purpose === "to-answer" && c.end !== "ask" && !done.has(c.id) && Date.parse(c.ts) >= lo && Date.parse(c.ts) <= hi);
}

/** The window's start: after the last completed review, the last blocked one's own start, or 30 days. */
function windowStart(kit, since) {
  const history = reviewsIn(improvementHistory(kit));
  const last = history.at(-1);
  const completed = history.filter((r) => r.outcome !== "blocked").at(-1);
  return since ?? (last?.outcome === "blocked" && last.since ? last.since : completed ? new Date(Date.parse(completed.through) + 1).toISOString() : "30d");
}

// Slow and costly say what an ask took. The rest say something went wrong with it.
const wentWrong = (s) => !/^(slow|costly) \(/.test(s);

const CHAINS = 30;

/**
 * The questions that were this kit's to answer, from reviews and labels: one entry per question, most
 * dug for first, with the review that last addressed it and how often it was dug for since.
 */
export function questionsOf(history) {
  const by = new Map();
  const key = (q) => q.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const cause = new Map();
  for (const r of history) for (const q of r.questions ?? []) cause.set(q.chain, { ...q, at: r.at }); // a later row corrects an earlier one
  for (const q of cause.values()) {
    if (!OPEN.includes(q.cause)) continue;
    const e = by.get(key(q.question)) ?? by.set(key(q.question), { question: q.question, causes: {}, chains: [], sessions: new Set(), last: q.ts, answer: null }).get(key(q.question));
    e.causes[q.cause] = (e.causes[q.cause] ?? 0) + 1;
    e.chains.push({ chain: q.chain, ts: q.ts });
    if (q.session) e.sessions.add(q.session);
    if (String(q.ts) > String(e.last)) e.last = q.ts;
    e.answer ??= q.answer ?? null;
  }
  for (const r of reviewsIn(history)) for (const q of r.addresses ?? []) {
    const e = by.get(key(q));
    if (e) e.addressed = { at: r.at, outcome: r.outcome, ...(r.commit ? { commit: r.commit } : {}) };
  }
  return [...by.values()]
    .map((e) => ({ question: e.question, causes: e.causes, dug: e.chains.length, sessions: e.sessions.size, last: e.last, answer: e.answer, chains: e.chains.slice(-5).map((c) => c.chain), ...(e.addressed ? { addressed: e.addressed, dugSince: e.chains.filter((c) => c.ts > e.addressed.at).length } : {}) }))
    .sort((a, b) => !!a.addressed - !!b.addressed || (b.dugSince ?? b.dug) - (a.dugSince ?? a.dug) || String(b.last).localeCompare(String(a.last)));
}

/** A kit's questions no review has addressed, or that were dug for again after one did. */
export const openQuestions = (kit) => questionsOf(improvementHistory(kit)).filter((q) => !q.addressed || q.dugSince);

/** Labels from `ask-kit improve --label`. */
export function appendLabels(kit, questions, by) {
  checkName(kit);
  if (!questions.length) return;
  const at = new Date().toISOString();
  fs.mkdirSync(historyDir(), { recursive: true, mode: 0o700 });
  fs.appendFileSync(historyFile(kit), JSON.stringify({ at, kit, through: at, outcome: "labelled", by, questions }) + "\n", { mode: 0o600 });
}

/** Chains in the order they are worth reading: after an ask (its answer was not enough), then those a person's own words started, then by cost. */
export const shownOrder = (chains) => [...chains].sort((a, b) => !!b.afterAsk - !!a.afterAsk || informative(b.prompt) - informative(a.prompt) || b.tokens - a.tokens);

export async function improvementBrief(kit, { since, through = new Date().toISOString(), scanned, answers = true, join = {} } = {}) {
  checkName(kit);
  const source = sourceOf(kit);
  if (!source && !stateRoots().some((root) => fs.existsSync(path.join(root, kit)))) throw new Error(`no kit, domain or journal named ${kit}`);
  const history = improvementHistory(kit);
  const from = windowStart(kit, since);
  const r = report({ kit, since: from, until: through, real: true });
  const chains = joinLocal(await handChains(kit, r.until, scanned));
  const shown = shownOrder(chains).slice(0, CHAINS);
  const found = answers ? await answersAfter(shown.filter((c) => !c.machine)) : new Map();
  const outcomes = answers ? await outcomesOf(shown.map((c) => c.id), join) : { byChain: new Map() };
  const cited = new Set(history.flatMap((h) => (h.evidence ?? []).map((e) => e.finding).filter(Boolean)));
  const elsewhere = answers ? await findingsAbout(kit, new Date(Date.now() - CHAIN_DAYS * 86400_000).toISOString(), cited, join) : { findings: [] };
  const wrong = r.flaggedAsks.filter((a) => a.signals.some(wentWrong)).length;
  const signals = wrong + r.flaggedOutcomes.length + r.reviewFindings.length + r.misroutes.length;
  const activity = r.asks + r.outcomes + r.scripts.reduce((n, s) => n + s.runs, 0) + r.misroutes.length;
  return {
    kit, source, since: r.since, through: r.until,
    state: activity || chains.length || openQuestions(kit).length ? "pending" : "no-new-evidence",
    asks: r.asks, outcomes: r.outcomes, flagged: r.flagged, wrong, signals,
    chains: {
      byHand: chains.length, afterAsk: chains.filter((c) => c.afterAsk).length, askNotAnswered: chains.filter((c) => c.ask?.answeredBefore === false).length,
      nudged: chains.filter((c) => c.nudged).length, outcomesFrom: outcomes.from ?? null, ...(outcomes.error ? { outcomesMissing: outcomes.error } : {}),
      sessions: new Set(chains.map((c) => `${c.source}:${c.session}`)).size, tokens: chains.reduce((n, c) => n + c.tokens, 0),
      shown: shown.map((c) => ({ chain: c.id, ...(c.machine ? { machine: c.machine } : {}), ts: c.ts, source: c.source, session: c.session, prompt: c.prompt, ...(c.says ? { says: c.says } : {}), area: c.area, lookups: c.n, tokens: c.tokens, ...(c.ask ? { ask: c.ask } : {}), ...(c.nudged ? { nudged: c.nudged } : {}), ...outcomeFields(outcomes.byChain.get(c.id)), found: found.get(c.id) ?? c.found ?? null })),
    },
    questions: questionsOf(history).slice(0, 60),
    elsewhere,
    previous: reviewsIn(history).at(-1) ?? null,
    report: { ...r, flaggedAsks: r.flaggedAsks.slice(-30), flaggedOutcomes: r.flaggedOutcomes.slice(-30), reviewFindings: r.reviewFindings.slice(-30), scripts: r.scripts.slice(0, 30), misroutes: r.misroutes.slice(-30), shadows: r.shadows.slice(-10) },
    instructions: [
      `Review only ${kit}'s evidence in this brief and the journals it names. Read the kit's instructions, roles, skills and scripts before editing.`,
      "Trace each selected failure through its cells and the caller's follow-up. Pick the smallest fix supported by that evidence; a quiet journal is not a reason to rewrite instructions.",
      "`chains` is the digging agents did by hand that this kit should have answered. For each shown chain, work out the question from its prompt, `says` and `found`, then why the kit was not asked or, with `afterAsk`, what that ask's answer left out. A chain whose question this kit cannot answer is a gap in its scripts or instructions; one it answers already was not reached, which is the kit's `says`, patterns or the nudge. One that only looked around before doing the work needs no change.",
      `Store in the record's \`questions\` the chains you worked out: {chain, question, cause, answer?}, a question two chains share written the same way. Leave out a chain whose cause you did not check; it stays open for the labels and the next review. Causes: ${Object.entries(CAUSES).map(([k, v]) => `${k} (${v})`).join("; ")}. \`questions\` in this brief is every question that was this kit's to answer, from labels and reviews, with how often it was dug for; work on those first. Name in the record's \`addresses\`, in their words, only those the change makes an ask answer; run a new or changed script live and read-only first, because a fixture does not show that it works: \`dugSince\` then counts the digging after it, and one that stays above zero means the fix did not work. A label is a model's reading of a chain: check it against the transcript before building on it, and correct it by recording the chain with another cause.`,
      "Each chain carries what is known of it: `ask` (the journal row of the ask before it; `answeredBefore: false` means it was still running), `nudged` (the hook named that kit and it was not asked), and `turnOutcome`, `next` and `sessionVerdict`, which speak of the whole turn or session: match what went unmet to the chain's own question before using it.",
      "`elsewhere` is what notes, lessons and threads say about this kit. Take what holds into this review and cite it as evidence {finding: id}; it then stops being listed.",
      "Reproduce failures with synthetic offline fixtures, and run a new or changed script once against the real source, read-only. Run the repository's required checks. Run paid model benches only when the maintainer requested that specific run.",
      "Commit verified changes in this kit's own repository. Record changed, no-change or blocked with the evidence and checks. A blocked review remains in the next queue.",
      "Use the same kit's next real asks to check the result. Do not claim a measured model improvement from an offline test alone.",
    ],
    record: { since: r.since, through: r.until, outcome: "changed|no-change|blocked", summary: "what the evidence showed and what changed", addresses: ["question this change answers, in the brief's words"], questions: [{ chain: "id from chains.shown", question: "what it was trying to find out", cause: Object.keys(CAUSES).join("|"), answer: "what it found, when known" }], evidence: [{ journal: "path from the report", ts: "record timestamp" }, { chain: "id from chains.shown" }], changes: [], checks: [{ command: "the check run", result: "its observed result", ok: true }], commit: "commit sha, required for changed" },
  };
}

function outcomeFields(o) {
  if (!o) return {};
  return { ...(o.turnOutcome ? { turnOutcome: o.turnOutcome } : {}), ...(o.next ? { next: o.next } : {}), ...(o.session_verdict ? { sessionVerdict: o.session_verdict } : {}), ...(o.otherChainsInTurn ? { otherChainsInTurn: o.otherChainsInTurn } : {}) };
}

export async function improvementQueue({ since, scanned } = {}) {
  const through = new Date().toISOString();
  const names = listDomains().sort();
  const sc = scanned ?? (await scan({ since: new Date(Date.now() - CHAIN_DAYS * 86400_000).toISOString() }));
  const kits = await Promise.all(names.map(async (kit) => {
    const b = await improvementBrief(kit, { since, through, scanned: sc, answers: false });
    return { kit, source: b.source, since: b.since, through, state: b.state, asks: b.asks, outcomes: b.outcomes, flagged: b.flagged, wrong: b.wrong, chains: b.chains.byHand, chainsAfterAsk: b.chains.afterAsk, nudged: b.chains.nudged, chainTokens: b.chains.tokens, questions: openQuestions(kit).length, signals: b.signals, previous: b.previous ? { at: b.previous.at, outcome: b.previous.outcome, summary: b.previous.summary } : null };
  }));
  kits.sort((a, b) => b.signals + b.questions - (a.signals + a.questions) || b.chains - a.chains || b.asks - a.asks || a.kit.localeCompare(b.kit));
  return { through, kits };
}

/** Save an agent's evidence and verification; no commands or model calls are run here. */
export async function recordImprovement(kit, record, { scanned } = {}) {
  checkName(kit);
  if (!record || !REVIEWS.includes(record.outcome)) throw new Error("record outcome must be changed, no-change or blocked");
  const through = Date.parse(record.through);
  if (!Number.isFinite(through) || through > Date.now()) throw new Error("record through must be the past cutoff from an improvement brief");
  const history = reviewsIn(improvementHistory(kit));
  const previous = history.filter((r) => r.outcome !== "blocked").at(-1);
  if (previous && through <= Date.parse(previous.through)) throw new Error("this review is already covered; read a fresh improvement brief");
  if (typeof record.summary !== "string" || !record.summary.trim() || record.summary.length > 2000) throw new Error("record summary must contain 1–2000 characters");
  if (!Array.isArray(record.evidence) || record.evidence.length > 100) throw new Error("record evidence must be a list of at most 100 {journal, ts}, {chain} or {finding} entries");
  const brief = await improvementBrief(kit, { since: record.since, through: record.through, scanned, answers: false });
  if (parseSince(brief.since) > through) throw new Error("record since must be before through");
  const baseline = history.at(-1)?.outcome === "blocked" ? Date.parse(history.at(-1).since) : previous ? Date.parse(previous.through) + 1 : null;
  if (baseline != null && parseSince(brief.since) > baseline) throw new Error("record since skips unreviewed evidence; use the window from a fresh brief without --since");
  if ((brief.asks || brief.outcomes || brief.signals || brief.chains.byHand) && !record.evidence.length) throw new Error("record the evidence reviewed: journal records or chains");
  const chainIds = record.evidence.some((e) => e?.chain) ? new Set((await handChains(kit, brief.through, scanned)).map((c) => c.id)) : null;
  for (const e of record.evidence) {
    if (e?.finding) {
      if (typeof e.finding !== "string" || !/^[\w:.-]{1,80}$/.test(e.finding)) throw new Error("a finding is cited by the id the brief lists");
      continue;
    }
    if (e?.chain) {
      if (!chainIds.has(e.chain)) throw new Error(`no chain ${e.chain} of this kit inside the review window`);
      continue;
    }
    const file = path.resolve(String(e?.journal ?? ""));
    const t = Date.parse(e?.ts);
    const folder = stateRoots().flatMap((root) => [kit, "router"].map((name) => ({ root, name }))).find((f) => file.startsWith(path.resolve(f.root, f.name) + path.sep));
    if (!folder || !file.endsWith(".jsonl") || !Number.isFinite(t) || t < parseSince(brief.since) || t > through) throw new Error("evidence must name a journal record for this kit inside the review window");
    const actual = fs.realpathSync(file);
    if (!actual.startsWith(fs.realpathSync(path.join(folder.root, folder.name)) + path.sep)) throw new Error("evidence must stay in this kit's journal folder");
    const found = fs.readFileSync(file, "utf8").split("\n").some((line) => {
      try {
        const r = JSON.parse(line);
        return folder.name === "router" ? r?.at === e.ts && [r.domain, r.routed, r.correct].includes(kit) : r?.ts === e.ts;
      } catch { return false; }
    });
    if (!found) throw new Error(`no journal record at ${e.ts}`);
  }
  const questions = record.questions ?? [];
  if (!Array.isArray(questions) || questions.some((q) => typeof q?.question !== "string" || !q.question.trim() || q.question.length > 300 || !CAUSES[q.cause] || (q.answer != null && (typeof q.answer !== "string" || q.answer.length > 600)))) throw new Error(`questions must be {chain, question, cause, answer?} with a cause of ${Object.keys(CAUSES).join(", ")}`);
  const windowChains = new Map((await handChains(kit, brief.through, scanned)).map((c) => [c.id, c]));
  const labelled = storedQuestions();
  const strange = questions.find((q) => !windowChains.has(q.chain) && labelled.get(q.chain)?.kit !== kit);
  if (strange) throw new Error(`no chain ${strange.chain} of this kit inside the review window`);
  const addresses = record.addresses ?? [];
  if (!Array.isArray(addresses) || addresses.some((q) => typeof q !== "string" || !q.trim() || q.length > 300)) throw new Error("addresses must be a list of questions, in the brief's words");
  if (addresses.length && record.outcome !== "changed") throw new Error("only a changed review addresses questions");
  const checks = record.checks ?? [];
  const changes = record.changes ?? [];
  if (!Array.isArray(checks) || checks.length > 30 || checks.some((c) => typeof c?.command !== "string" || !c.command.trim() || c.command.length > 1000 || typeof c.result !== "string" || !c.result.trim() || c.result.length > 2000 || typeof c.ok !== "boolean")) throw new Error("checks must contain command, result and ok");
  if (!Array.isArray(changes) || changes.length > 100 || changes.some((c) => typeof c !== "string" || !c || c.length > 500)) throw new Error("changes must be file paths");
  if (record.outcome === "changed" && (!changes.length || !checks.length || checks.some((c) => !c.ok) || !/^[a-f0-9]{7,40}$/.test(record.commit ?? ""))) throw new Error("changed needs changed paths, passing checks and a commit sha");
  const entry = { at: new Date().toISOString(), kit, since: brief.since, through: new Date(through).toISOString(), outcome: record.outcome, summary: record.summary, ...(addresses.length ? { addresses } : {}), evidence: record.evidence.map((e) => (e.finding ? { finding: e.finding } : e.chain ? { chain: e.chain } : { journal: e.journal, ts: e.ts })), ...(questions.length ? { questions: questions.map((q) => ({ chain: q.chain, ts: (windowChains.get(q.chain) ?? labelled.get(q.chain)).ts, session: (windowChains.get(q.chain) ?? labelled.get(q.chain)).session, question: q.question.trim(), cause: q.cause, ...(q.answer ? { answer: q.answer } : {}) })) } : {}), changes, checks, ...(record.commit ? { commit: record.commit } : {}) };
  fs.mkdirSync(historyDir(), { recursive: true, mode: 0o700 });
  fs.appendFileSync(historyFile(kit), JSON.stringify(entry) + "\n", { mode: 0o600 });
  return entry;
}

/** Every question reviews have stored, by chain id: {kit, question, cause, answer?}. */
export function storedQuestions() {
  const out = new Map();
  for (const kit of new Set(stateRoots().flatMap((root) => {
    try {
      return fs.readdirSync(path.join(root, "improvements")).filter((f) => f.endsWith(".jsonl")).map((f) => f.slice(0, -6)).filter((k) => NAME.test(k));
    } catch {
      return [];
    }
  }))) for (const r of improvementHistory(kit)) for (const q of r.questions ?? []) out.set(q.chain, { kit, ...q });
  return out;
}
