// Per-kit review queue and completion records. Reading a brief runs no kit code or model;
// the tuning agent makes and verifies changes, then records what it did here.
import fs from "node:fs";
import path from "node:path";
import { STATE_ROOT } from "./config.mjs";
import { listDomains, domainDirs } from "./domains.mjs";
import { findKit } from "./kits.mjs";
import { report, parseSince } from "./report.mjs";
import { informative, scan } from "./gaps.mjs";
import { machineChains, stateRoots } from "./machines.mjs";
import { answersAfter } from "./mine.mjs";

const OUTCOMES = ["changed", "no-change", "blocked"];
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

/**
 * The lookup chains agents ran by hand that were this kit's to answer, in a window: those that ended
 * in an answer (no edit after them, not cut short by an ask). `scanned` is a gaps scan to reuse.
 */
async function handChains(kit, from, through, scanned) {
  const sc = scanned ?? (await scan({ since: from }));
  const ids = new Set(sc.chains.map((c) => c.id));
  const all = [...sc.chains, ...(scanned?.local ? [] : machineChains().filter((c) => !ids.has(c.id)))];
  const lo = Date.parse(from), hi = Date.parse(through);
  return all.filter((c) => c.kit === kit && c.purpose === "to-answer" && c.end !== "ask" && Date.parse(c.ts) >= lo && Date.parse(c.ts) <= hi);
}

/** The window's start: after the last completed review, the last blocked one's own start, or 30 days. */
function windowStart(kit, since) {
  const history = improvementHistory(kit);
  const last = history.at(-1);
  const completed = history.filter((r) => r.outcome !== "blocked").at(-1);
  return since ?? (last?.outcome === "blocked" && last.since ? last.since : completed ? new Date(Date.parse(completed.through) + 1).toISOString() : "30d");
}

// Slow and costly say what an ask took. The rest say something went wrong with it.
const wentWrong = (s) => !/^(slow|costly) \(/.test(s);

const CHAINS = 30;

/** The questions earlier reviews worked out from chains that were this kit's to fix, newest first, with what was done. */
function questionsOf(history) {
  return history.flatMap((r) => (r.questions ?? []).filter((q) => OPEN.includes(q.cause)).map((q) => ({ ...q, at: r.at, outcome: r.outcome, ...(r.commit ? { commit: r.commit } : {}) }))).reverse().slice(0, 60);
}

export async function improvementBrief(kit, { since, through = new Date().toISOString(), scanned, answers = true } = {}) {
  checkName(kit);
  const source = sourceOf(kit);
  if (!source && !stateRoots().some((root) => fs.existsSync(path.join(root, kit)))) throw new Error(`no kit, domain or journal named ${kit}`);
  const history = improvementHistory(kit);
  const from = windowStart(kit, since);
  const r = report({ kit, since: from, until: through, real: true });
  const chains = await handChains(kit, r.since, r.until, scanned);
  // After an ask first (its answer was not enough), then those a person's own words started, then by cost.
  const shown = [...chains].sort((a, b) => !!b.afterAsk - !!a.afterAsk || informative(b.prompt) - informative(a.prompt) || b.tokens - a.tokens).slice(0, CHAINS);
  const found = answers ? await answersAfter(shown.filter((c) => !c.machine)) : new Map();
  const wrong = r.flaggedAsks.filter((a) => a.signals.some(wentWrong)).length;
  const signals = wrong + r.flaggedOutcomes.length + r.reviewFindings.length + r.misroutes.length;
  const activity = r.asks + r.outcomes + r.scripts.reduce((n, s) => n + s.runs, 0) + r.misroutes.length;
  return {
    kit, source, since: r.since, through: r.until,
    state: activity || chains.length ? "pending" : "no-new-evidence",
    asks: r.asks, outcomes: r.outcomes, flagged: r.flagged, wrong, signals,
    chains: {
      byHand: chains.length, afterAsk: chains.filter((c) => c.afterAsk).length,
      sessions: new Set(chains.map((c) => `${c.source}:${c.session}`)).size, tokens: chains.reduce((n, c) => n + c.tokens, 0),
      shown: shown.map((c) => ({ chain: c.id, ...(c.machine ? { machine: c.machine } : {}), ts: c.ts, source: c.source, session: c.session, prompt: c.prompt, ...(c.says ? { says: c.says } : {}), area: c.area, lookups: c.n, tokens: c.tokens, ...(c.afterAsk ? { afterAsk: c.afterAsk } : {}), found: found.get(c.id) ?? c.found ?? null })),
    },
    questions: questionsOf(history),
    previous: history.at(-1) ?? null,
    report: { ...r, flaggedAsks: r.flaggedAsks.slice(-30), flaggedOutcomes: r.flaggedOutcomes.slice(-30), reviewFindings: r.reviewFindings.slice(-30), scripts: r.scripts.slice(0, 30), misroutes: r.misroutes.slice(-30), shadows: r.shadows.slice(-10) },
    instructions: [
      `Review only ${kit}'s evidence in this brief and the journals it names. Read the kit's instructions, roles, skills and scripts before editing.`,
      "Trace each selected failure through its cells and the caller's follow-up. Pick the smallest fix supported by that evidence; a quiet journal is not a reason to rewrite instructions.",
      "`chains` is the digging agents did by hand that this kit should have answered. For each shown chain, work out the question from its prompt, `says` and `found`, then why the kit was not asked or, with `afterAsk`, what that ask's answer left out. A chain whose question this kit cannot answer is a gap in its scripts or instructions; one it answers already was not reached, which is the kit's `says`, patterns or the nudge. One that only looked around before doing the work needs no change.",
      `Store each shown chain's question in the record's \`questions\`: {chain, question, cause, answer?}, one per shown chain, a question two chains share written the same way. Causes: ${Object.entries(CAUSES).map(([k, v]) => `${k} (${v})`).join("; ")}. \`questions\` in this brief holds what earlier reviews found: one dug for again after its fix means the fix did not work.`,
      "With the mike kit enabled, `ask` it for the outcomes of these chains (its `chain-outcomes` script takes the ids): whether the turn was corrected and what it left undone.",
      "Reproduce failures with synthetic offline fixtures. Run the repository's required checks. Run paid model benches only when the maintainer requested that specific run.",
      "Commit verified changes in this kit's own repository. Record changed, no-change or blocked with the evidence and checks. A blocked review remains in the next queue.",
      "Use the same kit's next real asks to check the result. Do not claim a measured model improvement from an offline test alone.",
    ],
    record: { since: r.since, through: r.until, outcome: "changed|no-change|blocked", summary: "what the evidence showed and what changed", questions: [{ chain: "id from chains.shown", question: "what it was trying to find out", cause: Object.keys(CAUSES).join("|"), answer: "what it found, when known" }], evidence: [{ journal: "path from the report", ts: "record timestamp" }, { chain: "id from chains.shown" }], changes: [], checks: [{ command: "the check run", result: "its observed result", ok: true }], commit: "commit sha, required for changed" },
  };
}

export async function improvementQueue({ since, scanned } = {}) {
  const through = new Date().toISOString();
  const names = listDomains().sort();
  const starts = names.map((kit) => parseSince(windowStart(kit, since)));
  const sc = scanned ?? (await scan({ since: new Date(Math.min(Date.now(), ...starts)).toISOString() }));
  const kits = await Promise.all(names.map(async (kit) => {
    const b = await improvementBrief(kit, { since, through, scanned: sc, answers: false });
    return { kit, source: b.source, since: b.since, through, state: b.state, asks: b.asks, outcomes: b.outcomes, flagged: b.flagged, wrong: b.wrong, chains: b.chains.byHand, chainsAfterAsk: b.chains.afterAsk, chainTokens: b.chains.tokens, signals: b.signals, previous: b.previous ? { at: b.previous.at, outcome: b.previous.outcome, summary: b.previous.summary } : null };
  }));
  kits.sort((a, b) => b.signals + b.chains - (a.signals + a.chains) || b.asks - a.asks || a.kit.localeCompare(b.kit));
  return { through, kits };
}

/** Save an agent's evidence and verification; no commands or model calls are run here. */
export async function recordImprovement(kit, record, { scanned } = {}) {
  checkName(kit);
  if (!record || !OUTCOMES.includes(record.outcome)) throw new Error("record outcome must be changed, no-change or blocked");
  const through = Date.parse(record.through);
  if (!Number.isFinite(through) || through > Date.now()) throw new Error("record through must be the past cutoff from an improvement brief");
  const history = improvementHistory(kit);
  const previous = history.filter((r) => r.outcome !== "blocked").at(-1);
  if (previous && through <= Date.parse(previous.through)) throw new Error("this review is already covered; read a fresh improvement brief");
  if (typeof record.summary !== "string" || !record.summary.trim() || record.summary.length > 2000) throw new Error("record summary must contain 1–2000 characters");
  if (!Array.isArray(record.evidence) || record.evidence.length > 100) throw new Error("record evidence must be a list of at most 100 {journal, ts} or {chain} entries");
  const brief = await improvementBrief(kit, { since: record.since, through: record.through, scanned, answers: false });
  if (parseSince(brief.since) > through) throw new Error("record since must be before through");
  const baseline = history.at(-1)?.outcome === "blocked" ? Date.parse(history.at(-1).since) : previous ? Date.parse(previous.through) + 1 : null;
  if (baseline != null && parseSince(brief.since) > baseline) throw new Error("record since skips unreviewed evidence; use the window from a fresh brief without --since");
  if ((brief.asks || brief.outcomes || brief.signals || brief.chains.byHand) && !record.evidence.length) throw new Error("record the evidence reviewed: journal records or chains");
  const chainIds = record.evidence.some((e) => e?.chain) ? new Set((await handChains(kit, brief.since, brief.through, scanned)).map((c) => c.id)) : null;
  for (const e of record.evidence) {
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
  const windowChains = new Map((await handChains(kit, brief.since, brief.through, scanned)).map((c) => [c.id, c]));
  const strange = questions.find((q) => !windowChains.has(q.chain));
  if (strange) throw new Error(`no chain ${strange.chain} of this kit inside the review window`);
  const asked = new Set(questions.map((q) => q.chain));
  const without = record.outcome === "blocked" ? [] : brief.chains.shown.filter((c) => !asked.has(c.chain));
  if (without.length) throw new Error(`record a question for every chain the brief shows; missing: ${without.slice(0, 10).map((c) => c.chain).join(", ")}`);
  const checks = record.checks ?? [];
  const changes = record.changes ?? [];
  if (!Array.isArray(checks) || checks.length > 30 || checks.some((c) => typeof c?.command !== "string" || !c.command.trim() || c.command.length > 1000 || typeof c.result !== "string" || !c.result.trim() || c.result.length > 2000 || typeof c.ok !== "boolean")) throw new Error("checks must contain command, result and ok");
  if (!Array.isArray(changes) || changes.length > 100 || changes.some((c) => typeof c !== "string" || !c || c.length > 500)) throw new Error("changes must be file paths");
  if (record.outcome === "changed" && (!changes.length || !checks.length || checks.some((c) => !c.ok) || !/^[a-f0-9]{7,40}$/.test(record.commit ?? ""))) throw new Error("changed needs changed paths, passing checks and a commit sha");
  const entry = { at: new Date().toISOString(), kit, since: brief.since, through: new Date(through).toISOString(), outcome: record.outcome, summary: record.summary, evidence: record.evidence.map((e) => (e.chain ? { chain: e.chain } : { journal: e.journal, ts: e.ts })), ...(questions.length ? { questions: questions.map((q) => ({ chain: q.chain, ts: windowChains.get(q.chain).ts, question: q.question.trim(), cause: q.cause, ...(q.answer ? { answer: q.answer } : {}) })) } : {}), changes, checks, ...(record.commit ? { commit: record.commit } : {}) };
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
