// Capabilities: what a kit or domain provides, so that two that answer the same kind of question
// (mike and the built-in sessions reader both hold Claude Code history) are ranked instead of
// both offered. docs/design/composition.md, section 1.
//
// A provider is one [[provides]] entry of a kit's ask-kit.toml (a built-in domain's `provides` in
// its domain.mjs): `capability` (a name, e.g. "session-history"), `covers` (what it holds of it,
// e.g. which agents' sessions; left out, everything), `reach` (e.g. "this-machine"), `priority`
// (higher wins). `domains.<name>.priority` in the config pins a domain's priority for all it
// provides. Two providers of one capability whose covers overlap at the same priority are a tie,
// which `ask-kit doctor` and `ask-kit kit install` report as an error naming both.
import { findKit, readManifest } from "./kits.mjs";

const NAME = /^[a-z][a-z0-9-]*$/;
// The key in an ask result's _meta saying the provider held nothing for the question (src/ask.mjs).
export const NO_DATA_META = "ask-kit/noData";

// The agents a question can name, as `covers` spells them.
export const AGENT_WORDS = {
  "claude-code": /\bclaude[ -]?code\b/i,
  codex: /\bcodex\b/i,
  "copilot-cli": /\bcopilot\b/i,
  opencode: /\bopen ?code\b/i,
  "gemini-cli": /\bgemini\b/i,
};

/** The agents a question names: its scope. Empty when it names none. */
export const scopeOf = (question) => Object.entries(AGENT_WORDS).filter(([, re]) => re.test(String(question ?? ""))).map(([k]) => k);

/** Problems with a manifest's [[provides]], for readManifest. */
export function checkProvides(provides) {
  const problems = [];
  if (provides == null) return problems;
  if (!Array.isArray(provides)) return ["[[provides]]: a list of { capability, covers, reach, priority }"];
  for (const [i, p] of provides.entries()) {
    if (!NAME.test(p.capability ?? "")) problems.push(`provides[${i}].capability: lowercase letters, digits and dashes, e.g. "session-history"`);
    if (p.covers != null && !(Array.isArray(p.covers) && p.covers.every((c) => typeof c === "string" && c))) problems.push(`provides[${i}].covers: a list of what it holds, e.g. ["claude-code", "codex"]`);
    if (p.reach != null && typeof p.reach !== "string") problems.push(`provides[${i}].reach: a word, e.g. "this-machine" or "all-machines"`);
    if (p.priority != null && !Number.isFinite(p.priority)) problems.push(`provides[${i}].priority: a number; higher wins`);
  }
  return problems;
}

/** Every provider among `names`, with the priority the config pins. */
export function providersOf(names, provides, config) {
  const out = [];
  for (const name of names) {
    const pin = config?.domains?.[name]?.priority;
    for (const p of provides(name) ?? []) {
      out.push({ domain: name, capability: p.capability, covers: p.covers?.length ? [...p.covers] : null, reach: p.reach ?? null, priority: Number.isFinite(pin) ? pin : (p.priority ?? 0), pinned: Number.isFinite(pin) });
    }
  }
  return out;
}

const overlaps = (a, b) => !a || !b || a.some((x) => b.includes(x));
const covering = (p, scope) => !scope.length || !p.covers || scope.every((s) => p.covers.includes(s));

/** Ties: same capability, overlapping covers, same priority, different domains. */
export function tiesOf(providers) {
  const out = [];
  for (let i = 0; i < providers.length; i++)
    for (let j = i + 1; j < providers.length; j++) {
      const a = providers[i];
      const b = providers[j];
      if (a.domain !== b.domain && a.capability === b.capability && a.priority === b.priority && overlaps(a.covers, b.covers))
        out.push({ capability: a.capability, priority: a.priority, domains: [a.domain, b.domain], message: `${a.domain} and ${b.domain} both provide ${a.capability}${a.covers && b.covers ? ` for ${a.covers.filter((x) => b.covers.includes(x)).join(", ")}` : ""} at priority ${a.priority}: set domains.<one of them>.priority in ask-kit's config to choose` });
    }
  return out;
}

/** The providers of a capability that hold the scope, best first (priority, then config order). */
export function ranked(providers, capability, scope = []) {
  return providers
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.capability === capability && covering(p, scope))
    .sort((a, b) => b.p.priority - a.p.priority || a.i - b.i)
    .map(({ p }) => p.domain)
    .filter((d, i, all) => all.indexOf(d) === i);
}

/**
 * Per capability: the winner of a question that names no agent, and per cover the winner of a
 * question about it. A provider that wins neither is hidden: it adds nothing to any ask.
 */
export function winnersOf(providers) {
  const caps = {};
  for (const c of new Set(providers.map((p) => p.capability))) {
    const own = providers.filter((p) => p.capability === c);
    const top = ranked(providers, c)[0];
    const byCover = {};
    for (const x of new Set(own.flatMap((p) => p.covers ?? []))) byCover[x] = ranked(providers, c, [x])[0];
    caps[c] = { top, byCover, providers: [...new Set(own.map((p) => p.domain))] };
  }
  const winning = new Set(Object.values(caps).flatMap((c) => [c.top, ...Object.values(c.byCover)]));
  const hidden = [...new Set(providers.map((p) => p.domain))].filter((d) => !winning.has(d));
  return { caps, hidden };
}

/** One line per capability with more than one provider: its winner, and who answers which covers. */
export function capabilityLines(caps, visible) {
  const lines = [];
  for (const [c, w] of Object.entries(caps)) {
    if (w.providers.filter((d) => visible.includes(d)).length < 2) continue;
    const others = {};
    for (const [x, d] of Object.entries(w.byCover)) if (d !== w.top && visible.includes(d)) (others[d] ??= []).push(x);
    lines.push(`${c}: ${w.top}${Object.entries(others).map(([d, xs]) => `; for ${xs.join(", ")}: ${d}`).join("")}`);
  }
  return lines;
}

/** A kit's or domain's [[provides]] without building it: the manifest, else the domain module. */
export async function providesOfName(name) {
  const dir = findKit(name);
  if (dir) return readManifest(dir).provides ?? [];
  const { loadDomain } = await import("./domains.mjs");
  return (await loadDomain(name)).provides ?? [];
}
