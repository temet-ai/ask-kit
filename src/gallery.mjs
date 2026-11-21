// Shared domains: a domain is a public GitHub
// repository with the topic `ask-kit-domain`, holding the domain folder and a RECIPE.md. Anyone
// adds one with one line pasted into their agent ("Read <guide>, then add this domain: <repo>"),
// and the agent runs `ask-kit add`, which shows the files first and installs only with --yes.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { CONFIG_DIR, ROOT, STATE_ROOT, loadConfig, saveConfig } from "./config.mjs";
import { which } from "./platform.mjs";
import { writeAgentsMd } from "./agentsmd.mjs";
import { MANIFEST, findKit, readManifest, unavailable } from "./kits.mjs";
import { providersOf, providesOfName, tiesOf } from "./capabilities.mjs";

// Kits carry the topic `ask-kit`; `ask-kit-domain` (the older domain.mjs form) is still listed.
export const TOPIC = "ask-kit";
export const TOPICS = ["ask-kit", "ask-kit-domain"];

export async function listGallery() {
  const headers = { accept: "application/vnd.github+json", "user-agent": "ask-kit" };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const seen = new Map();
  // Every page: GitHub search returns at most 100 a page and 1000 in all.
  for (const t of TOPICS) for (let page = 1; page <= 10; page++) {
    const res = await fetch(`https://api.github.com/search/repositories?q=topic:${t}&sort=stars&per_page=100&page=${page}`, { headers, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`GitHub search: HTTP ${res.status}`);
    const j = await res.json();
    if (!j.items?.length) break;
    for (const r of j.items) if (r.full_name !== "temet-ai/ask-kit" && !seen.has(r.full_name)) seen.set(r.full_name, { repo: r.full_name, description: r.description ?? "", stars: r.stargazers_count, updated: r.pushed_at?.slice(0, 10), url: r.html_url, private: !!r.private, owner: r.owner?.login, avatar: r.owner?.avatar_url, branch: r.default_branch });
    if (j.items.length < 100) break;
  }
  return [...seen.values()].sort((a, b) => b.stars - a.stars);
}

/**
 * "github.com/o/r", "https://github.com/o/r(.git)", "o/r", a folder in a repository ("o/r/kits/notes",
 * "https://github.com/o/r/tree/<branch>/kits/notes"), or a local folder. `ref` pins a branch or tag.
 */
export function parseRef(ref, { ref: pin } = {}) {
  const s = String(ref).trim();
  if (fs.existsSync(s)) return { local: path.resolve(s), name: path.basename(path.resolve(s)) };
  const tree = s.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)\/tree\/([^/]+)(?:\/(.+?))?\/?$/);
  const m = tree ?? s.match(/^(?:https?:\/\/)?(?:www\.)?(?:github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?((?:\/[\w.-]+)*)\/?$/);
  if (!m) throw new Error(`"${ref}" is not a GitHub repository (owner/repo, owner/repo/folder) or a folder`);
  const subdir = (tree ? m[4] : m[3]?.replace(/^\//, "")) || null;
  if (subdir && subdir.split("/").some((x) => x === ".." || x === ".")) throw new Error(`"${ref}": a folder in the repository cannot hold . or ..`);
  const branch = pin ?? (tree ? m[3] : null);
  return { owner: m[1], repo: m[2], url: `https://github.com/${m[1]}/${m[2]}`, name: subdir ? path.basename(subdir) : m[2], ...(subdir ? { subdir } : {}), ...(branch ? { ref: branch } : {}) };
}

export function fetchRepo(r) {
  if (r.local) return { dir: r.local, commit: null };
  if (!which("git")) throw new Error("adding a kit from GitHub needs git on PATH");
  const dir = path.join(STATE_ROOT, "gallery", `${r.owner}-${r.repo}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  const c = spawnSync("git", ["clone", "--depth", "1", "--quiet", ...(r.ref ? ["--branch", r.ref] : []), r.url, dir], { encoding: "utf8", timeout: 120_000 });
  if (c.status !== 0) throw new Error(`git clone ${r.url}${r.ref ? ` (${r.ref})` : ""}: ${(c.stderr || "").trim().slice(0, 300)}`);
  const sha = spawnSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
  if (!r.subdir) return { dir, commit: sha };
  const sub = path.join(dir, r.subdir);
  if (!fs.existsSync(sub) || !fs.statSync(sub).isDirectory()) throw new Error(`${r.url} has no folder ${r.subdir}${r.ref ? ` on ${r.ref}` : ""}`);
  return { dir: sub, commit: sha };
}

/** Folders holding a domain.mjs: the repo root, or one level down (domains/<n>/ or <n>/). */
function findDomains(dir, fallbackName) {
  const out = [];
  if (fs.existsSync(path.join(dir, "domain.mjs"))) out.push({ name: fallbackName, dir });
  for (const base of [dir, path.join(dir, "domains")]) {
    if (!fs.existsSync(base)) continue;
    for (const d of fs.readdirSync(base, { withFileTypes: true })) {
      if (d.isDirectory() && !d.name.startsWith(".") && fs.existsSync(path.join(base, d.name, "domain.mjs"))) out.push({ name: d.name, dir: path.join(base, d.name) });
    }
  }
  return out;
}

/** Folders holding an ask-kit.toml: the repo root, or one level down (kits/<n>/ or <n>/). A pack holds several. */
export function findKits(dir) {
  const out = [];
  if (fs.existsSync(path.join(dir, MANIFEST))) out.push(dir);
  for (const base of [dir, path.join(dir, "kits")]) {
    if (!fs.existsSync(base)) continue;
    for (const d of fs.readdirSync(base, { withFileTypes: true })) {
      if (d.isDirectory() && !d.name.startsWith(".") && fs.existsSync(path.join(base, d.name, MANIFEST))) out.push(path.join(base, d.name));
    }
  }
  return out;
}

// The preview shows what a kit reaches, which of its calls change things, and what it runs at
// install: it is code that runs as the user, with no sandbox.
async function addKits(r, dir, commit, kitDirsFound, { yes, only, full = false, as } = {}) {
  let kits = kitDirsFound.map((d) => ({ dir: d, m: readManifest(d) }));
  if (only?.length) {
    const missing = only.filter((n) => !kits.some((k) => k.m.name === n));
    if (missing.length) throw new Error(`${r.url ?? dir} has no kit ${missing.join(", ")}; it has: ${kits.map((k) => k.m.name).join(", ")}`);
    kits = kits.filter((k) => only.includes(k.m.name));
  }
  // --as: one copy of one kit under another name, with its own settings and state.
  if (as) {
    if (kits.length !== 1) throw new Error(`--as installs one kit under another name; ${r.url ?? dir} holds ${kits.length}: pick one with --only`);
    if (!/^[a-z][a-z0-9-]*$/.test(as)) throw new Error("--as: lowercase letters, digits and dashes, starting with a letter");
    kits[0].original = kits[0].m.name;
    kits[0].m = { ...kits[0].m, name: as };
  }
  const configNow = loadConfig({ required: false }) ?? {};
  const { evaluate } = await import("./commons.mjs");
  const out = {
    source: r.url ?? dir,
    commit,
    kits: kits.map(({ dir: d, m, original }) => {
      // Whether it can run here, as far as is known without running it (detect settings wait for first use).
      const settings = Object.fromEntries((m.settings ?? []).map((s) => [s.key, process.env[s.key] ?? configNow.domains?.[m.name]?.settings?.[s.key] ?? (s.detect ? undefined : s.default)]).filter(([, v]) => v != null));
      const why = unavailable(m, settings, { lazy: true });
      const files = listFiles(d);
      const code = m.sources.filter((s) => s.kind === "module").map((s) => s.module);
      // Mesh: the jobs this kit writes for itself that lib already does (docs/design/mesh.md).
      let repeats = [];
      try {
        repeats = (evaluate([{ name: m.name, dir: d }]).byKit[m.name]?.use ?? []).map((u) => `${u.job} (${u.where[0]}; lib has ${u.lib})`);
      } catch {}
      const clash = installedClash(m, original);
      return {
        name: m.name,
        ...(original ? { copyOf: original } : {}),
        version: m.version ?? null,
        says: m.says,
        reaches: m.sources.map((s) => `${s.kind} ${s.name}${s.path ? `: ${s.path}` : ""}${s.command ? `: ${[].concat(s.command).join(" ")}` : ""}${s.module ? `: ${s.module}` : ""}`),
        changes: m.acts ?? [],
        runsAtInstall: (m.build ?? []).map((b) => [].concat(b.command).join(" ")),
        needs: [...[].concat(m.requires ?? []).map((x) => `${x} on PATH`), ...(m.settings ?? []).filter((s) => s.required).map((s) => `${s.key}${s.about ? ` (${s.about})` : ""}`), ...(m.min_ask_kit ? [`ask-kit ${m.min_ask_kit}+`] : [])],
        runsHere: why ? `no: ${why}` : "yes",
        ...(clash ? { clash } : {}),
        ...(repeats.length ? { repeats } : {}),
        readFirst: code.map((f) => path.join(d, f)),
        files: `${files.length} files, ${size(files.reduce((s, f) => s + f.bytes, 0))}`,
        ...(full
          ? {
              settings: (m.settings ?? []).map((s) => ({ key: s.key, ...(s.about ? { about: s.about } : {}), ...(s.required ? { required: true } : {}), ...(s.secret ? { secret: true } : {}), ...(s.default != null ? { default: s.default } : {}), ...(s.detect ? { detect: [].concat(s.detect).join(" ") } : {}) })),
              fileList: files,
              modules: Object.fromEntries(code.map((f) => [f, fs.readFileSync(path.join(d, f), "utf8").slice(0, 4000)])),
            }
          : {}),
      };
    }),
    installed: [],
  };
  // A kit that provides a capability an enabled domain provides, for the same covers at the same
  // priority, ties with it: the router could not choose, so the install stops until a pin settles it.
  const config = loadConfig({ required: !!yes }) ?? {};
  const names = kits.map(({ m }) => m.name);
  const installedNames = Object.entries(config.domains ?? {}).filter(([n, d]) => d.enabled !== false && !names.includes(n)).map(([n]) => n);
  const provides = {};
  for (const n of installedNames) provides[n] = await providesOfName(n).catch(() => []);
  for (const { m } of kits) provides[m.name] = m.provides ?? [];
  const ties = tiesOf(providersOf([...installedNames, ...names], (n) => provides[n], config)).filter((t) => t.domains.some((d) => names.includes(d)));
  if (ties.length) out.ties = ties.map((t) => t.message);
  // Questions other kits' benches hold that this kit's patterns or actions would take with no model.
  out.claims = await claimsOf(kits.map((k) => k.m), installedNames);
  if (!yes) {
    out.next =
      "Read each kit's readFirst files, then run ask-kit kit mesh <the same source> to see how it fits with the installed kits, then tell the user what it reaches, what it changes (only when asked), what it runs at install, whether it can run here, and what the mesh asks them to decide." +
      (out.kits.some((k) => k.clash) ? " A clash means a different kit already has the name: install this one with --as <other name>, or remove the other first." : "") +
      (out.kits.some((k) => k.repeats) ? " repeats: code it carries that ask-kit's shared library already has; worth telling its author." : "") +
      (out.claims.length ? " Also say which questions of installed kits it would take (claims)." : "") +
      (kits.length > 1 ? ` To install only some: --only ${kits.map((k) => k.m.name).slice(0, 2).join(",")}.` : "") +
      " On their yes, run the same command with --yes.";
    return out;
  }
  if (ties.length) throw new Error(`not installed: ${ties.map((t) => t.message).join("; ")}`);
  const clashes = out.kits.filter((k) => k.clash);
  if (clashes.length) throw new Error(`not installed: ${clashes.map((k) => `${k.name}: ${k.clash}`).join("; ")}`);
  const tooOld = out.kits.filter((k) => /needs ask-kit/.test(k.runsHere));
  if (tooOld.length) throw new Error(`not installed: ${tooOld.map((k) => `${k.name} ${k.runsHere.replace(/^no: /, "")}`).join("; ")}`);
  for (const { dir: d, m, original } of kits) {
    const dest = path.join(CONFIG_DIR, "kits", m.name);
    fs.rmSync(dest, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.cpSync(d, dest, { recursive: true, filter: (p) => !p.includes(`${path.sep}.git`) });
    if (original) renameManifest(path.join(dest, MANIFEST), m.name);
    for (const b of m.build ?? []) {
      const [bin, ...args] = [].concat(b.command);
      const res = spawnSync(bin, args, { cwd: dest, encoding: "utf8", timeout: 600_000 });
      if (res.status !== 0) throw new Error(`${m.name}: build \`${[bin, ...args].join(" ")}\` failed: ${(res.stderr || res.stdout || "").trim().slice(0, 400)}`);
    }
    // Where it came from, so `kit update` can fetch it again: the repository and the kit's folder in it.
    const rel = r.local ? null : path.relative(fetchRoot(r), d).split(path.sep).join("/");
    const from = r.local ? d : `${r.owner}/${r.repo}${rel ? `/${rel}` : ""}`;
    config.domains = { ...(config.domains ?? {}), [m.name]: { ...(config.domains?.[m.name] ?? {}), enabled: true, from, ...(r.ref ? { ref: r.ref } : {}), ...(commit ? { commit } : {}), version: m.version ?? null, ...(original ? { copyOf: original } : {}) } };
    out.installed.push({ name: m.name, dir: dest });
  }
  saveConfig(config);
  writeAgentsMd();
  out.next = `\`ask\` lists the new kit${out.installed.length > 1 ? "s" : ""} on its next call, with no restart. Prove it: ask-kit kit test ${out.installed[0].name}`;
  return out;
}

// A different kit already installed under this name: one with another id, or a linked folder.
function installedClash(m, original) {
  const own = path.join(CONFIG_DIR, "kits", m.name);
  let st;
  try {
    st = fs.lstatSync(own);
  } catch {
    return null;
  }
  if (st.isSymbolicLink()) return `${m.name} is linked from ${fs.readlinkSync(own)}; remove the link first (ask-kit kit remove ${m.name})`;
  let theirs;
  try {
    theirs = readManifest(own);
  } catch {
    return null;
  }
  const config = loadConfig({ required: false }) ?? {};
  const theirsIs = config.domains?.[m.name]?.copyOf ?? theirs.name;
  const sameKit = (theirs.id && m.id ? theirs.id === m.id : true) && theirsIs === (original ?? m.name);
  return sameKit ? null : `a different kit (${theirs.id ?? theirs.name}, from ${config.domains?.[m.name]?.from ?? "unknown"}) is installed as ${m.name}`;
}

// The kit's top-level name in its manifest, for a copy installed under another name.
function renameManifest(file, name) {
  const text = fs.readFileSync(file, "utf8");
  const i = text.search(/^\[/m);
  const head = i < 0 ? text : text.slice(0, i);
  fs.writeFileSync(file, head.replace(/^name\s*=\s*"[^"]*"/m, `name = "${name}"`) + (i < 0 ? "" : text.slice(i)));
}

const size = (b) => (b >= 1 << 20 ? `${(b / (1 << 20)).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`);

const fetchRoot = (r) => path.join(STATE_ROOT, "gallery", `${r.owner}-${r.repo}`);

// Bench questions of installed kits that a new kit's patterns or enabled-by-default actions would
// answer, with no router model asked. Those are the routes an install changes for certain.
async function claimsOf(manifests, installedNames) {
  const { compileActions, matchAction } = await import("./actions.mjs");
  const out = [];
  for (const n of installedNames) {
    const dir = findKit(n);
    if (!dir) continue;
    let questions = [];
    try {
      const m = readManifest(dir);
      const file = path.join(dir, m.bench ?? path.join("bench", "questions.json"));
      questions = (JSON.parse(fs.readFileSync(file, "utf8")).questions ?? []).filter((q) => q.q).map((q) => q.q);
    } catch {
      continue;
    }
    for (const m of manifests) {
      const patterns = (m.patterns ?? []).map((p) => new RegExp(p, "i"));
      const actions = compileActions(m).filter((a) => !a.acts);
      for (const q of questions) {
        const by = patterns.some((re) => re.test(q)) ? "pattern" : matchAction(actions, q) ? "action" : null;
        if (by) out.push({ kit: m.name, from: n, question: q.slice(0, 200), by });
      }
    }
  }
  return out.slice(0, 20);
}

/**
 * Remove an installed or linked kit: its folder (a link is unlinked, the folder it points at is
 * left alone), its config entry and aliases. With purge, also its journals, generated files,
 * action log and the data it kept. Without yes, only says what it would do.
 */
export function removeKit(name, { yes = false, purge = false } = {}) {
  if (!/^[a-z][a-z0-9-]*$/.test(name ?? "")) throw new Error("kit remove needs a kit's name");
  const own = path.join(CONFIG_DIR, "kits", name);
  const ownDomain = path.join(CONFIG_DIR, "domains", name);
  const builtIn = [path.join(ROOT, "kits", name), path.join(ROOT, "domains", name)].find((d) => fs.existsSync(d));
  let kind = null;
  try {
    kind = fs.lstatSync(own).isSymbolicLink() ? "link" : "copy";
  } catch {}
  if (!kind && fs.existsSync(ownDomain)) kind = "domain";
  const config = loadConfig({ required: false }) ?? {};
  if (!kind && !config.domains?.[name]) {
    if (builtIn) throw new Error(`${name} is built into ask-kit and cannot be removed; turn it off with: ask-kit kit disable ${name}`);
    throw new Error(`no installed kit ${name}; ask-kit kit list shows them`);
  }
  const state = [path.join(STATE_ROOT, name), path.join(STATE_ROOT, "kits", name), path.join(STATE_ROOT, "kit-data", name), path.join(STATE_ROOT, "actions", `${name}.jsonl`), path.join(STATE_ROOT, "actions", `${name}.json`)].filter((p) => fs.existsSync(p));
  const aliases = Object.entries(config.aliases ?? {}).filter(([, d]) => d === name).map(([a]) => a);
  const out = {
    name,
    ...(kind === "link" ? { unlink: own, keeps: fs.readlinkSync(own) } : kind === "copy" ? { delete: own } : kind === "domain" ? { delete: ownDomain } : {}),
    config: config.domains?.[name] ? `domains.${name}${aliases.length ? ` and the aliases ${aliases.join(", ")}` : ""}` : null,
    ...(purge ? { deleteState: state } : state.length ? { keepsState: state } : {}),
    ...(builtIn ? { note: `a built-in ${name} stays and is used again once this one is gone` } : {}),
    removed: false,
  };
  if (!yes) {
    out.next = `Tell the user what goes${purge ? "" : " (journals and the kit's data are kept; --purge deletes them too)"}, and on their yes run the same command with --yes.`;
    return out;
  }
  if (kind === "link") fs.unlinkSync(own);
  else if (kind === "copy") fs.rmSync(own, { recursive: true, force: true });
  else if (kind === "domain") fs.rmSync(ownDomain, { recursive: true, force: true });
  if (config.domains?.[name] || aliases.length) {
    const { [name]: _, ...rest } = config.domains ?? {};
    config.domains = rest;
    if (aliases.length) config.aliases = Object.fromEntries(Object.entries(config.aliases).filter(([a]) => !aliases.includes(a)));
    saveConfig(config);
  }
  if (purge) for (const p of state) fs.rmSync(p, { recursive: true, force: true });
  writeAgentsMd();
  out.removed = true;
  out.next = "`ask` stops offering it on its next call.";
  return out;
}

// What differs between an installed kit and a fetched copy: files, and the manifest fields a person
// consented to at install (what it reaches, what it changes, what it runs, what it needs).
function changesBetween(installed, fresh, as = null) {
  const files = (d) => Object.fromEntries(listFiles(d).map((f) => [f.file, fs.readFileSync(path.join(d, f.file))]));
  const a = files(installed);
  const b = files(fresh);
  // A copy's manifest carries its own name: compare the fetched one under that name.
  if (as && b[MANIFEST]) {
    const text = b[MANIFEST].toString("utf8");
    const i = text.search(/^\[/m);
    const head = i < 0 ? text : text.slice(0, i);
    b[MANIFEST] = Buffer.from(head.replace(/^name\s*=\s*"[^"]*"/m, `name = "${as}"`) + (i < 0 ? "" : text.slice(i)));
  }
  const added = Object.keys(b).filter((f) => !(f in a));
  const removed = Object.keys(a).filter((f) => !(f in b));
  const changed = Object.keys(b).filter((f) => f in a && !a[f].equals(b[f]));
  const ma = readManifest(installed);
  const mb = { ...readManifest(fresh), ...(as ? { name: as } : {}) };
  const show = (m) => ({
    sources: (m.sources ?? []).map((s) => `${s.kind}:${s.name}${s.command ? ` ${[].concat(s.command).join(" ")}` : ""}${s.path ? ` ${s.path}` : ""}`),
    acts: m.acts ?? [],
    build: (m.build ?? []).map((x) => [].concat(x.command).join(" ")),
    requires: [].concat(m.requires ?? []),
    settings: (m.settings ?? []).map((s) => `${s.key}${s.required ? " (required)" : ""}${s.secret ? " (secret)" : ""}`),
  });
  const sa = show(ma);
  const sb = show(mb);
  const consent = {};
  for (const k of Object.keys(sb)) {
    const plus = sb[k].filter((x) => !sa[k].includes(x));
    const minus = sa[k].filter((x) => !sb[k].includes(x));
    if (plus.length || minus.length) consent[k] = { ...(plus.length ? { added: plus } : {}), ...(minus.length ? { removed: minus } : {}) };
  }
  return { from: ma.version ?? null, to: mb.version ?? null, added, removed, changed, consent };
}

/**
 * Fetch an installed kit again from where it came from and say what changed; with yes, replace it,
 * keeping its settings. A linked kit is live already; a kit with no recorded source cannot update.
 * Without a name: every installed kit that came from somewhere.
 */
export async function updateKit(name, { yes = false } = {}) {
  const config = loadConfig({ required: false }) ?? {};
  const names = name ? [name] : Object.keys(config.domains ?? {}).filter((n) => config.domains[n].from && fs.existsSync(path.join(CONFIG_DIR, "kits", n)));
  const out = [];
  for (const n of names) {
    const own = path.join(CONFIG_DIR, "kits", n);
    const entry = config.domains?.[n];
    if (!fs.existsSync(own)) {
      out.push({ name: n, skipped: "not an installed kit" });
      continue;
    }
    if (fs.lstatSync(own).isSymbolicLink()) {
      out.push({ name: n, skipped: `linked from ${fs.readlinkSync(own)}: its changes load on the next question already` });
      continue;
    }
    if (!entry?.from) {
      out.push({ name: n, skipped: "installed before ask-kit recorded where kits come from; install it again once" });
      continue;
    }
    const r = parseRef(entry.from, { ref: entry.ref });
    let fetched;
    try {
      fetched = fetchRepo(r);
    } catch (e) {
      out.push({ name: n, error: e.message });
      continue;
    }
    // A copy installed with --as is fetched by its original name; a kit renamed upstream, by its id.
    const want = entry.copyOf ?? n;
    const id = (() => {
      try {
        return readManifest(own).id;
      } catch {
        return null;
      }
    })();
    const found = findKits(fetched.dir);
    const fresh = found.find((d) => readManifest(d).name === want) ?? (id ? found.find((d) => readManifest(d).id === id) : null);
    if (!fresh) {
      out.push({ name: n, error: `${entry.from} no longer holds a kit named ${n}` });
      continue;
    }
    const diff = changesBetween(own, fresh, entry.copyOf ? n : null);
    const same = !diff.added.length && !diff.removed.length && !diff.changed.length;
    const row = { name: n, source: entry.from, ...(entry.commit && fetched.commit ? { commits: `${entry.commit.slice(0, 7)} -> ${fetched.commit.slice(0, 7)}` } : {}), upToDate: same, ...(same ? {} : diff) };
    if (!same && yes) {
      if (diff.consent.build || diff.consent.sources || diff.consent.acts) row.note = "it now reaches, changes or runs something new (consent): the user saw this in the preview";
      const res = await addKits(r, fetched.dir, fetched.commit, [fresh], { yes: true, ...(entry.copyOf ? { as: n } : {}) });
      row.updated = !!res.installed.length;
    }
    out.push(row);
  }
  const pending = out.filter((r) => r.upToDate === false && !r.updated);
  return {
    kits: out,
    next: pending.length
      ? `Tell the user what changed in ${pending.map((r) => r.name).join(", ")}, above all under consent (what it reaches, changes, runs or needs that it did not before), and on their yes run the same command with --yes.`
      : out.some((r) => r.updated)
        ? "Updated. `ask` uses the new version on its next call."
        : "Nothing to update.",
  };
}

const listFiles = (dir, rel = "") =>
  fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap((e) =>
    e.name === ".git" || e.name === "node_modules" ? [] : e.isDirectory() ? listFiles(dir, path.join(rel, e.name)) : [{ file: path.join(rel, e.name), bytes: fs.statSync(path.join(dir, rel, e.name)).size }],
  );

/**
 * Fetch a shared domain and describe it. With yes, copy it into the user's domains folder and
 * enable it. Returns what was found, so the agent can show the user before saying yes.
 */
export async function addDomain(ref, { yes = false, only, ref: pin, full = false, as } = {}) {
  const r = parseRef(ref, { ref: pin });
  const { dir, commit } = fetchRepo(r);
  const kits = findKits(dir);
  if (kits.length) return addKits(r, dir, commit, kits, { yes, only, full, as });
  const found = findDomains(dir, r.name.replace(/^ask-kit-/, "").toLowerCase().replace(/[^a-z0-9-]/g, "-"));
  if (!found.length) throw new Error(`${r.url ?? dir} holds no domain.mjs (at its root, in <name>/ or in domains/<name>/)`);
  const recipeFile = ["RECIPE.md", "README.md"].map((f) => path.join(dir, f)).find((f) => fs.existsSync(f));
  const out = {
    source: r.url ?? dir,
    commit,
    recipe: recipeFile ? fs.readFileSync(recipeFile, "utf8").slice(0, 3000) : null,
    domains: found.map((f) => ({ name: f.name, files: listFiles(f.dir), domainMjs: fs.readFileSync(path.join(f.dir, "domain.mjs"), "utf8").slice(0, 4000) })),
    installed: [],
  };
  if (!yes) {
    out.next = "Read domain.mjs and the scripts, tell the user what they read and run, and on their yes run the same command with --yes.";
    return out;
  }
  const config = loadConfig();
  for (const f of found) {
    if (!/^[a-z][a-z0-9-]*$/.test(f.name)) throw new Error(`domain folder "${f.name}" is not a valid name (lowercase letters, digits, dashes)`);
    const dest = path.join(CONFIG_DIR, "domains", f.name);
    fs.rmSync(dest, { recursive: true, force: true });
    fs.cpSync(f.dir, dest, { recursive: true, filter: (p) => !p.includes(`${path.sep}.git`) });
    config.domains = { ...(config.domains ?? {}), [f.name]: { ...(config.domains?.[f.name] ?? {}), enabled: true, from: out.source, ...(commit ? { commit } : {}) } };
    out.installed.push({ name: f.name, dir: dest });
  }
  saveConfig(config);
  writeAgentsMd();
  out.next = `Restart the agents so \`ask\` lists the new domain, then try: ask-kit ask --domain ${out.installed[0].name} "<a question it should answer>"`;
  return out;
}
