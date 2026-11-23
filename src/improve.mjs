// Per-kit review queue and completion records. Reading a brief runs no kit code or model;
// the tuning agent makes and verifies changes, then records what it did here.
import fs from "node:fs";
import path from "node:path";
import { STATE_ROOT } from "./config.mjs";
import { listDomains, domainDirs } from "./domains.mjs";
import { findKit } from "./kits.mjs";
import { report, parseSince } from "./report.mjs";

const NAME = /^[a-z][a-z0-9-]*$/;
const historyDir = () => path.join(STATE_ROOT, "improvements");
const historyFile = (kit) => path.join(historyDir(), `${kit}.jsonl`);

function checkName(kit) {
  if (!NAME.test(kit ?? "")) throw new Error("improve needs a kit or domain name");
}

export function improvementHistory(kit) {
  checkName(kit);
  try {
    return fs.readFileSync(historyFile(kit), "utf8").split("\n").filter(Boolean).flatMap((line) => {
      try { const r = JSON.parse(line); return r && ["changed", "no-change", "blocked"].includes(r.outcome) && Number.isFinite(Date.parse(r.through)) ? [r] : []; } catch { return []; }
    });
  } catch (e) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
}

function sourceOf(kit) {
  const linked = findKit(kit);
  if (linked) return fs.realpathSync(linked);
  return domainDirs().map((d) => path.join(d, kit)).find((d) => fs.existsSync(path.join(d, "domain.mjs"))) ?? null;
}

export function improvementBrief(kit, { since, through = new Date().toISOString() } = {}) {
  checkName(kit);
  const source = sourceOf(kit);
  if (!source && !fs.existsSync(path.join(STATE_ROOT, kit))) throw new Error(`no kit, domain or journal named ${kit}`);
  const history = improvementHistory(kit);
  const last = history.at(-1);
  const completed = history.filter((r) => r.outcome !== "blocked").at(-1);
  const from = since ?? (last?.outcome === "blocked" && last.since ? last.since : completed ? new Date(Date.parse(completed.through) + 1).toISOString() : "30d");
  const r = report({ kit, since: from, until: through, real: true });
  const signals = r.flagged + r.flaggedOutcomes.length + r.reviewFindings.length + r.misroutes.length;
  const activity = r.asks + r.outcomes + r.scripts.reduce((n, s) => n + s.runs, 0) + r.misroutes.length;
  return {
    kit, source, since: r.since, through: r.until,
    state: activity ? "pending" : "no-new-evidence",
    asks: r.asks, outcomes: r.outcomes, flagged: r.flagged, signals,
    previous: history.at(-1) ?? null,
    report: { ...r, flaggedAsks: r.flaggedAsks.slice(-30), flaggedOutcomes: r.flaggedOutcomes.slice(-30), reviewFindings: r.reviewFindings.slice(-30), scripts: r.scripts.slice(0, 30), misroutes: r.misroutes.slice(-30), shadows: r.shadows.slice(-10) },
    instructions: [
      `Review only ${kit}'s evidence in this brief and the journals it names. Read the kit's instructions, roles, skills and scripts before editing.`,
      "Trace each selected failure through its cells and the caller's follow-up. Pick the smallest fix supported by that evidence; a quiet journal is not a reason to rewrite instructions.",
      "Reproduce failures with synthetic offline fixtures. Run the repository's required checks. Run paid model benches only when the maintainer requested that specific run.",
      "Commit verified changes in this kit's own repository. Record changed, no-change or blocked with the evidence and checks. A blocked review remains in the next queue.",
      "Use the same kit's next real asks to check the result. Do not claim a measured model improvement from an offline test alone.",
    ],
    record: { since: r.since, through: r.until, outcome: "changed|no-change|blocked", summary: "what the evidence showed and what changed", evidence: [{ journal: "path from the report", ts: "record timestamp" }], changes: [], checks: [{ command: "the check run", result: "its observed result", ok: true }], commit: "commit sha, required for changed" },
  };
}

export function improvementQueue({ since } = {}) {
  const through = new Date().toISOString();
  const kits = listDomains().sort().map((kit) => {
    const b = improvementBrief(kit, { since, through });
    return { kit, source: b.source, since: b.since, through, state: b.state, asks: b.asks, outcomes: b.outcomes, flagged: b.flagged, signals: b.signals, previous: b.previous ? { at: b.previous.at, outcome: b.previous.outcome, summary: b.previous.summary } : null };
  });
  kits.sort((a, b) => b.signals - a.signals || b.asks - a.asks || a.kit.localeCompare(b.kit));
  return { through, kits };
}

/** Save an agent's evidence and verification; no commands or model calls are run here. */
export function recordImprovement(kit, record) {
  checkName(kit);
  if (!record || !["changed", "no-change", "blocked"].includes(record.outcome)) throw new Error("record outcome must be changed, no-change or blocked");
  const through = Date.parse(record.through);
  if (!Number.isFinite(through) || through > Date.now()) throw new Error("record through must be the past cutoff from an improvement brief");
  const history = improvementHistory(kit);
  const previous = history.filter((r) => r.outcome !== "blocked").at(-1);
  if (previous && through <= Date.parse(previous.through)) throw new Error("this review is already covered; read a fresh improvement brief");
  if (typeof record.summary !== "string" || !record.summary.trim() || record.summary.length > 2000) throw new Error("record summary must contain 1–2000 characters");
  if (!Array.isArray(record.evidence) || record.evidence.length > 100) throw new Error("record evidence must be a list of at most 100 {journal, ts} entries");
  const brief = improvementBrief(kit, { since: record.since, through: record.through });
  if (parseSince(brief.since) > through) throw new Error("record since must be before through");
  const baseline = history.at(-1)?.outcome === "blocked" ? Date.parse(history.at(-1).since) : previous ? Date.parse(previous.through) + 1 : null;
  if (baseline != null && parseSince(brief.since) > baseline) throw new Error("record since skips unreviewed evidence; use the window from a fresh brief without --since");
  if ((brief.asks || brief.outcomes || brief.signals) && !record.evidence.length) throw new Error("record the journal evidence reviewed");
  for (const e of record.evidence) {
    const file = path.resolve(String(e?.journal ?? ""));
    const t = Date.parse(e?.ts);
    const folder = [kit, "router"].find((name) => file.startsWith(path.resolve(STATE_ROOT, name) + path.sep));
    if (!folder || !file.endsWith(".jsonl") || !Number.isFinite(t) || t < parseSince(brief.since) || t > through) throw new Error("evidence must name a journal record for this kit inside the review window");
    const actual = fs.realpathSync(file);
    if (!actual.startsWith(fs.realpathSync(path.join(STATE_ROOT, folder)) + path.sep)) throw new Error("evidence must stay in this kit's journal folder");
    const found = fs.readFileSync(file, "utf8").split("\n").some((line) => {
      try {
        const r = JSON.parse(line);
        return folder === "router" ? r?.at === e.ts && [r.domain, r.routed, r.correct].includes(kit) : r?.ts === e.ts;
      } catch { return false; }
    });
    if (!found) throw new Error(`no journal record at ${e.ts}`);
  }
  const checks = record.checks ?? [];
  const changes = record.changes ?? [];
  if (!Array.isArray(checks) || checks.length > 30 || checks.some((c) => typeof c?.command !== "string" || !c.command.trim() || c.command.length > 1000 || typeof c.result !== "string" || !c.result.trim() || c.result.length > 2000 || typeof c.ok !== "boolean")) throw new Error("checks must contain command, result and ok");
  if (!Array.isArray(changes) || changes.length > 100 || changes.some((c) => typeof c !== "string" || !c || c.length > 500)) throw new Error("changes must be file paths");
  if (record.outcome === "changed" && (!changes.length || !checks.length || checks.some((c) => !c.ok) || !/^[a-f0-9]{7,40}$/.test(record.commit ?? ""))) throw new Error("changed needs changed paths, passing checks and a commit sha");
  const entry = { at: new Date().toISOString(), kit, since: brief.since, through: new Date(through).toISOString(), outcome: record.outcome, summary: record.summary, evidence: record.evidence.map(({ journal, ts }) => ({ journal, ts })), changes, checks, ...(record.commit ? { commit: record.commit } : {}) };
  fs.mkdirSync(historyDir(), { recursive: true, mode: 0o700 });
  fs.appendFileSync(historyFile(kit), JSON.stringify(entry) + "\n", { mode: 0o600 });
  return entry;
}
