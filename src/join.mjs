// What else is known about a lookup chain: the ask made before it (its journal row), whether the
// plugin's hook named a kit during it, how the work ended, and what was written about the kit elsewhere.
// The last two come from whichever enabled kit provides them (a `provides` entry), as scripts with no
// model: `chain-outcomes` ({chains: [ids]} -> {chains: [{chain, ...}]}) and `kit-findings`
// ({kit, since} -> {findings: [{id, at, text, ...}]}). With no such kit, or one that fails, a review
// says so and goes on.
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ROOT, loadConfig } from "./config.mjs";
import { findKit, listKits, readManifest } from "./kits.mjs";
import { stateRoots } from "./machines.mjs";

const SKIP = new Set(["warm", "drafts", "gallery", "index", "actions", "nudges", "improvements", "machines", "router", "kits"]);
const rowsOf = (file) => {
  try {
    return fs.readFileSync(file, "utf8").split("\n").flatMap((l) => {
      try {
        const r = l ? JSON.parse(l) : null;
        return r && typeof r === "object" && !Array.isArray(r) ? [r] : [];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
};

function askRows(from) {
  const out = new Map(); // caller session -> its ask rows
  for (const root of stateRoots()) {
    const walk = (dir, kit) => {
      let entries = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {}
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (kit || !SKIP.has(e.name)) walk(full, kit ?? e.name);
        } else if (kit && e.name.endsWith(".jsonl") && !e.name.startsWith("ask-") && fs.statSync(full).mtimeMs >= from) {
          for (const r of rowsOf(full)) if (r.type === "ask" && Date.parse(r.ts) >= from) (out.get(r.session) ?? out.set(r.session, []).get(r.session)).push({ ...r, kit, journal: full });
        }
      }
    };
    walk(root, null);
  }
  return out;
}

const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

function nudgeRows(from) {
  const out = new Map();
  for (const root of stateRoots()) for (const r of rowsOf(path.join(root, "nudges", "nudges.jsonl"))) if (r.type === "nudge" && Date.parse(r.at) >= from) (out.get(r.session) ?? out.set(r.session, []).get(r.session)).push(r);
  return out;
}

/** Each chain with `ask` (the journal row of the ask before it) and `nudged` ({at, about}), where there is one. */
export function joinLocal(chains) {
  if (!chains.length) return [];
  const from = Math.min(...chains.map((c) => Date.parse(c.ts))) - 86400_000;
  const asks = askRows(from), nudges = nudgeRows(from);
  return chains.map((c) => {
    const start = Date.parse(c.ts), end = Date.parse(c.until ?? c.ts);
    const out = { ...c };
    if (c.afterAsk) {
      const q = norm(c.askQuestion), at = Date.parse(c.askAt ?? "");
      const mine = (asks.get(c.session) ?? []).filter((r) => !q || norm(r.question).startsWith(q.slice(0, 300)) || q.startsWith(norm(r.question).slice(0, 300)));
      const near = (r) => Math.abs((Date.parse(r.startedAt) || Date.parse(r.ts) - (r.ms ?? 0)) - (at || start));
      const row = mine.sort((a, b) => near(a) - near(b))[0];
      if (row && near(row) < 600_000) out.ask = { kit: row.kit, question: String(row.question).slice(0, 300), ok: row.ok, seconds: Math.round((row.ms ?? 0) / 1000), answeredBefore: Date.parse(row.ts) <= start, journal: row.journal, ts: row.ts };
      else out.ask = { question: c.askQuestion ?? null, missing: "no journal row: a canceled ask, or a journal that was not read" };
    }
    const n = (nudges.get(c.session) ?? []).find((r) => Date.parse(r.at) >= start - 1000 && Date.parse(r.at) <= end + 120_000);
    if (n) out.nudged = { at: n.at, about: n.about };
    return out;
  });
}

/** The enabled kit that provides a capability as a script of the same name, or null. */
export function scriptProvider(capability, config = loadConfig({ required: false })) {
  for (const kit of listKits()) {
    if (!config?.domains?.[kit] || config.domains[kit].enabled === false) continue;
    try {
      if ((readManifest(findKit(kit)).provides ?? []).some((p) => p.capability === capability)) return kit;
    } catch {}
  }
  return null;
}

/** A kit script run with no model, outside this process. Returns its value; throws with the first line of what went wrong. */
export function runScript(kit, script, params, ms = 90_000) {
  return new Promise((ok, no) => {
    execFile(process.execPath, [path.join(ROOT, "bin", "ask-kit.mjs"), "run", kit, script, ...Object.entries(params).map(([k, v]) => `${k}=${JSON.stringify(v)}`)], { timeout: ms, maxBuffer: 64 << 20, env: { ...process.env, ASK_KIT_SESSION: "bench-improve" } }, (e, out, err) => {
      const text = String(out);
      const at = text.indexOf("{"), to = text.lastIndexOf("}");
      if (e || at < 0) return no(new Error((String(err).trim().split("\n")[0] || text.trim().split("\n")[0] || e?.message || "no result").slice(0, 200)));
      try {
        ok(JSON.parse(text.slice(at, to + 1)));
      } catch (x) {
        no(new Error(`its result is not JSON (${x.message.slice(0, 80)})`));
      }
    });
  });
}

/** {from: kit | null, error?, byChain: Map} of how the work each chain served ended. */
export async function outcomesOf(ids, { provider = scriptProvider("chain-outcomes"), run = runScript } = {}) {
  if (!provider || !ids.length) return { from: provider, byChain: new Map(), ...(provider ? {} : { error: "no enabled kit provides chain-outcomes" }) };
  try {
    const r = await run(provider, "chain-outcomes", { chains: ids, limit: ids.length });
    return { from: provider, byChain: new Map((r.chains ?? []).map((c) => [c.chain, c])) };
  } catch (e) {
    return { from: provider, error: e.message, byChain: new Map() };
  }
}

/** What was written about a kit outside its reviews (notes, lessons, threads), not yet cited by one. */
export async function findingsAbout(kit, since, cited, { provider = scriptProvider("kit-findings"), run = runScript } = {}) {
  if (!provider) return { from: null, error: "no enabled kit provides kit-findings", findings: [] };
  try {
    const r = await run(provider, "kit-findings", { kit, since });
    return { from: provider, findings: (r.findings ?? []).filter((f) => !cited.has(f.id)) };
  } catch (e) {
    return { from: provider, error: e.message, findings: [] };
  }
}
