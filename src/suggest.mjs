// ask-kit kit suggest: which kits not installed here would have answered what this machine's agents
// dug for by hand, ranked by what that digging cost. It reads the transcripts the way `ask-kit
// gaps` does, with a catalogue of kits added to its rules: each catalogue kit's `replaces` (the
// commands it answers for) and its name (gaps names web pages "web", SQLite files "sqlite") put a
// lookup chain down to it. A catalogue is a pack (a folder or owner/repo[/folder] holding kits) or,
// without one, the kits of the gallery.
import fs from "node:fs";
import path from "node:path";
import { parse as parseToml } from "smol-toml";
import { loadConfig } from "./config.mjs";
import { fetchRepo, findKits, listGallery, parseRef } from "./gallery.mjs";
import { kitRules, report, scan } from "./gaps.mjs";
import { readManifest, unavailable } from "./kits.mjs";

/** Kits of a pack: [{m, install}] where `install` is what `kit install` takes for it. */
function fromPack(ref, pin) {
  const r = parseRef(ref, { ref: pin });
  const { dir } = fetchRepo(r);
  const root = r.local ? null : path.join(dir, ...(r.subdir ? r.subdir.split("/").map(() => "..") : []));
  return findKits(dir).map((d) => {
    const m = readManifest(d);
    const rel = root ? path.relative(root, d).split(path.sep).join("/") : null;
    return { m, install: r.local ? d : `${r.owner}/${r.repo}${rel ? `/${rel}` : ""}`, ...(r.ref ? { ref: r.ref } : {}) };
  });
}

/** Kits of the gallery: each repository's root manifest, read from GitHub without cloning. */
async function fromGallery(max = 40) {
  const repos = (await listGallery()).slice(0, max);
  const out = [];
  await Promise.all(
    repos.map(async (g) => {
      try {
        const res = await fetch(`https://raw.githubusercontent.com/${g.repo}/${g.branch ?? "main"}/ask-kit.toml`, { signal: AbortSignal.timeout(10_000) });
        if (!res.ok) return;
        const m = parseToml(await res.text());
        if (m.name && m.says) out.push({ m, install: g.repo });
      } catch {}
    }),
  );
  return out;
}

export async function suggest({ from, ref, since = "30d", catalogue } = {}) {
  const config = loadConfig({ required: false }) ?? {};
  const kits = catalogue ?? (from ? fromPack(from, ref) : await fromGallery());
  if (!kits.length) throw new Error(from ? `${from} holds no kits` : "the gallery could not be read (no network?): pass --from <folder or owner/repo[/folder]> with kits in it");
  const rules = kitRules(config, { catalogue: kits.map((k) => k.m) });
  const sc = await scan({ since, rules });
  const r = report(sc);
  const byName = new Map(kits.map((k) => [k.m.name, k]));
  const rows = [];
  for (const k of kits) {
    if (rules.installed.has(k.m.name)) continue;
    const demand = r.noKit.find((x) => x.source === k.m.name);
    const why = unavailable(k.m, {}, { lazy: true });
    rows.push({
      kit: k.m.name,
      says: k.m.says,
      install: k.install,
      ...(k.ref ? { ref: k.ref } : {}),
      runsHere: !why || /^needs [A-Z_]+ \(|: set it in the environment/.test(why),
      ...(why ? { needs: why } : {}),
      chains: demand?.chains ?? 0,
      sessions: demand?.sessions ?? 0,
      tokens: demand?.tokens ?? 0,
      usd: demand?.usd ?? 0,
      examples: (demand?.examples ?? []).map((e) => e.prompt.slice(0, 160)),
      ...(k.m.replaces ? { replaces: k.m.replaces } : {}),
    });
  }
  rows.sort((a, b) => Number(b.runsHere) - Number(a.runsHere) || b.sessions * b.tokens - a.sessions * a.tokens || a.kit.localeCompare(b.kit));
  const worth = rows.filter((x) => x.runsHere && x.chains > 0);
  // Installed kits the agents still went around: worth a look before adding more.
  const bypassed = r.skipped.filter((x) => byName.has(x.kit) || x.kit !== "code").map((x) => ({ kit: x.kit, chains: x.chains, sessions: x.sessions, tokens: x.tokens, examples: x.examples.map((e) => e.prompt.slice(0, 160)) }));
  const cmd = (list) => {
    const groups = new Map();
    for (const x of list) {
      const k = byName.get(x.kit);
      const base = k.install.split("/").length > 2 && !path.isAbsolute(k.install) ? k.install.split("/").slice(0, -1).join("/") : k.install;
      const key = `${path.isAbsolute(k.install) ? path.dirname(k.install) : base}|${k.ref ?? ""}`;
      groups.set(key, [...(groups.get(key) ?? []), x.kit]);
    }
    return [...groups].map(([key, names]) => {
      const [src, pin] = key.split("|");
      const one = names.length === 1 && !path.isAbsolute(byName.get(names[0]).install) ? byName.get(names[0]).install : src;
      return `ask-kit kit install ${one}${names.length > 1 || one === src ? ` --only ${names.join(",")}` : ""}${pin ? ` --ref ${pin}` : ""}`;
    });
  };
  return {
    since: r.since,
    scanned: r.scanned,
    suggest: rows,
    ...(bypassed.length ? { bypassed } : {}),
    next: worth.length
      ? `Show the user the kits with evidence (what their agents dug for by hand that the kit answers), then: ${cmd(worth).join("; ")}. Each install shows a preview first.`
      : rows.some((x) => x.runsHere)
        ? "No digging in this window that a catalogue kit would have answered. The kits that can run here are listed with no evidence; suggest one only for what the user says they do."
        : "None of the catalogue's kits can run on this machine.",
  };
}

export function formatSuggest(s) {
  const tok = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));
  const lines = [`Since ${s.since.slice(0, 10)}: ${s.scanned.sessions} sessions scanned.`, ""];
  for (const x of s.suggest) {
    const evidence = x.chains ? `${x.chains} lookup chains by hand in ${x.sessions} sessions, ${tok(x.tokens)} tokens${x.usd ? `, $${x.usd}` : ""}` : "no digging found that it would answer";
    lines.push(`${x.runsHere ? "●" : "○"} ${x.kit.padEnd(16)} ${evidence}${x.needs ? `  (${x.runsHere ? "" : "cannot run here: "}${x.needs})` : ""}`);
    for (const e of x.examples) lines.push(`    "${e}"`);
  }
  if (s.bypassed?.length) {
    lines.push("", "Installed, but agents dug by hand anyway:");
    for (const b of s.bypassed) lines.push(`  ${b.kit}: ${b.chains} chains in ${b.sessions} sessions`);
  }
  lines.push("", s.next);
  return lines.join("\n");
}
