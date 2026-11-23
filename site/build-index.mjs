// The kits site's data: every public repository with the GitHub topic ask-kit (or ask-kit-domain),
// read from its default branch: ask-kit.toml (what the kit answers, what it needs, what it can
// change), the first paragraph of its README, its bench questions, and what it carries: scripts
// (with each one's purpose), skills (playbooks) and roles.
// Writes site/kits.json. GITHUB_TOKEN raises GitHub's rate limit; private repositories are left out.
//
//   node site/build-index.mjs [out.json]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "smol-toml";
import { listGallery, purposeOf } from "../src/gallery.mjs";
import { publicFile as raw } from "./github.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] ?? path.join(HERE, "kits.json");
const headers = { "user-agent": "ask-kit-site", ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) };

/** The README's first paragraph of prose: no heading, badge, image or code. */
function intro(md) {
  if (!md) return "";
  const paras = md.replace(/```[\s\S]*?```/g, "").split(/\n\s*\n/).map((p) => p.trim());
  const p = paras.find((x) => x && !/^(#|!\[|\[!\[|<|>|\||-{3})/.test(x));
  return (p ?? "").replace(/\s*\n\s*/g, " ").slice(0, 600);
}

/** The files of a repository's branch. An API failure must not erase its scripts and skills. */
async function tree(repo, branch) {
  const res = await fetch(`https://api.github.com/repos/${repo}/git/trees/${branch}?recursive=1`, { headers: { ...headers, accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`${repo}: tree HTTP ${res.status}; gallery was not rebuilt`);
  const body = await res.json();
  if (!Array.isArray(body.tree) || body.truncated) throw new Error(`${repo}: incomplete file tree; gallery was not rebuilt`);
  return body.tree.filter((t) => t.type === "blob").map((t) => t.path);
}

/** The files directly in `dir` with the extension, by name: [{name, path}]. */
const inDir = (files, dir, ext) =>
  files.filter((p) => p.startsWith(`${dir}/`) && p.endsWith(ext) && !p.slice(dir.length + 1).includes("/")).sort().map((p) => ({ name: p.slice(dir.length + 1, -ext.length), path: p }));

/** What a kit carries besides its sources: scripts and skills from its folders, roles from the manifest. */
async function carries(repo, branch, m) {
  const files = await tree(repo, branch);
  const scripts = [];
  for (const f of inDir(files, typeof m.scripts === "string" ? m.scripts : "scripts", ".mjs")) scripts.push({ name: f.name, purpose: purposeOf(await raw(repo, branch, f.path)) });
  const skills = [];
  for (const f of inDir(files, typeof m.skills === "string" ? m.skills : "skills", ".md")) skills.push({ name: f.name, purpose: ((await raw(repo, branch, f.path)) ?? "").split("\n")[0].replace(/^#+\s*/, "").trim().slice(0, 300) });
  const roles = (m.roles ?? []).map((r) => ({ name: r.name, when: r.when ?? "" }));
  return { scripts, skills, roles };
}

const kits = [];
for (const r of await listGallery()) {
  if (r.private) continue;
  const branch = r.branch ?? "HEAD";
  const toml = await raw(r.repo, branch, "ask-kit.toml");
  let m = null;
  try {
    m = toml ? parse(toml) : null;
  } catch (e) {
    console.error(`${r.repo}: ask-kit.toml does not parse (${e.message}); left out`);
    continue;
  }
  // The older domain.mjs form has no manifest; it is listed with what GitHub says about it.
  const readme = await raw(r.repo, branch, "README.md");
  // The questions its bench asks: what people can ask it, in the author's own words.
  let questions = [];
  try {
    const b = JSON.parse((await raw(r.repo, branch, "bench/questions.json")) ?? "[]");
    questions = (Array.isArray(b) ? b : (b.questions ?? [])).map((x) => x.q ?? x.question).filter((q) => typeof q === "string");
  } catch {}
  kits.push({
    repo: r.repo,
    url: r.url,
    owner: r.owner,
    avatar: r.avatar,
    stars: r.stars,
    updated: r.updated,
    name: m?.name ?? r.repo.split("/")[1].replace(/^ask-kit-/, ""),
    id: m?.id ?? null,
    version: m?.version ?? null,
    form: m ? "kit" : "domain",
    says: m?.says ?? r.description,
    description: r.description,
    intro: intro(readme),
    requires: m?.requires ?? [],
    platforms: m?.platforms ?? [],
    acts: m?.acts ?? [],
    sources: (m?.sources ?? []).map((s) => s.kind),
    uses: m?.uses ?? [],
    provides: (m?.provides ?? []).map((p) => ({ capability: p.capability, covers: p.covers ?? [], reach: p.reach ?? "", priority: p.priority ?? 0 })),
    actions: (m?.actions ?? []).map((a) => ({ name: a.name, title: a.title ?? "", script: a.script, acts: !!a.acts })),
    settings: (m?.settings ?? []).map((s) => ({ key: s.key, about: s.about ?? "", default: s.default ?? "", detect: s.detect ? [].concat(s.detect).join(" ") : "", required: !!s.required, secret: !!s.secret })),
    questions,
    ...(m ? await carries(r.repo, branch, m) : { scripts: [], skills: [], roles: [] }),
    install: `ask-kit kit install ${r.repo}`,
  });
  console.log(`${r.repo}: ${m ? "kit" : "domain"}, ${questions.length} bench question(s), ${kits.at(-1).scripts.length} script(s), ${kits.at(-1).skills.length} skill(s), ${kits.at(-1).roles.length} role(s)`);
}

// The domains that ship inside ask-kit, read from their domain.mjs.
const builtins = [];
for (const name of ["sessions", "code"]) {
  const { domain: d } = await import(new URL(`../domains/${name}/domain.mjs`, import.meta.url));
  builtins.push({ name, says: d.says, provides: (d.provides ?? []).map((p) => ({ capability: p.capability, covers: p.covers ?? [], reach: p.reach ?? "", priority: p.priority ?? 0 })) });
}

fs.writeFileSync(out, JSON.stringify({ built: new Date().toISOString(), kits, builtins }, null, 2) + "\n");
console.log(`${kits.length} kit(s) → ${out}`);
