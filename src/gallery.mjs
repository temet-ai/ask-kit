// Shared domains: a domain is a public GitHub
// repository with the topic `ask-kit-domain`, holding the domain folder and a RECIPE.md. Anyone
// adds one with one line pasted into their agent ("Read <guide>, then add this domain: <repo>"),
// and the agent runs `ask-kit add`, which shows the files first and installs only with --yes.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { CONFIG_DIR, STATE_ROOT, loadConfig, saveConfig } from "./config.mjs";
import { which } from "./platform.mjs";
import { writeAgentsMd } from "./agentsmd.mjs";

export const TOPIC = "ask-kit-domain";

export async function listGallery() {
  const headers = { accept: "application/vnd.github+json", "user-agent": "ask-kit" };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(`https://api.github.com/search/repositories?q=topic:${TOPIC}&sort=stars&per_page=50`, { headers, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`GitHub search: HTTP ${res.status}`);
  const j = await res.json();
  return (j.items ?? []).map((r) => ({ repo: r.full_name, description: r.description ?? "", stars: r.stargazers_count, updated: r.pushed_at?.slice(0, 10), url: r.html_url }));
}

/** "github.com/o/r", "https://github.com/o/r(.git)", "o/r" or a local folder. */
export function parseRef(ref) {
  const s = String(ref).trim();
  if (fs.existsSync(s)) return { local: path.resolve(s), name: path.basename(path.resolve(s)) };
  const m = s.match(/^(?:https?:\/\/)?(?:www\.)?(?:github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/);
  if (!m) throw new Error(`"${ref}" is not a GitHub repository (owner/repo) or a folder`);
  return { owner: m[1], repo: m[2], url: `https://github.com/${m[1]}/${m[2]}`, name: m[2] };
}

function fetchRepo(r) {
  if (r.local) return { dir: r.local, commit: null };
  if (!which("git")) throw new Error("adding a domain from GitHub needs git on PATH");
  const dir = path.join(STATE_ROOT, "gallery", `${r.owner}-${r.repo}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  const c = spawnSync("git", ["clone", "--depth", "1", "--quiet", r.url, dir], { encoding: "utf8", timeout: 120_000 });
  if (c.status !== 0) throw new Error(`git clone ${r.url}: ${(c.stderr || "").trim().slice(0, 300)}`);
  const sha = spawnSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
  return { dir, commit: sha };
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

const listFiles = (dir, rel = "") =>
  fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap((e) =>
    e.name === ".git" || e.name === "node_modules" ? [] : e.isDirectory() ? listFiles(dir, path.join(rel, e.name)) : [{ file: path.join(rel, e.name), bytes: fs.statSync(path.join(dir, rel, e.name)).size }],
  );

/**
 * Fetch a shared domain and describe it. With yes, copy it into the user's domains folder and
 * enable it. Returns what was found, so the agent can show the user before saying yes.
 */
export async function addDomain(ref, { yes = false } = {}) {
  const r = parseRef(ref);
  const { dir, commit } = fetchRepo(r);
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
