// The kits site's data: every public repository with the GitHub topic ask-kit (or ask-kit-domain),
// read from its default branch: ask-kit.toml (what the kit answers, what it needs, what it can
// change), the first paragraph of its README, and how many bench questions it carries.
// Writes site/kits.json. GITHUB_TOKEN raises GitHub's rate limit; private repositories are left out.
//
//   node site/build-index.mjs [out.json]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "smol-toml";
import { listGallery } from "../src/gallery.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] ?? path.join(HERE, "kits.json");
const headers = { "user-agent": "ask-kit-site", ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) };

async function raw(repo, branch, file) {
  const res = await fetch(`https://raw.githubusercontent.com/${repo}/${branch}/${file}`, { headers, signal: AbortSignal.timeout(10_000) });
  return res.ok ? res.text() : null;
}

/** The README's first paragraph of prose: no heading, badge, image or code. */
function intro(md) {
  if (!md) return "";
  const paras = md.replace(/```[\s\S]*?```/g, "").split(/\n\s*\n/).map((p) => p.trim());
  const p = paras.find((x) => x && !/^(#|!\[|\[!\[|<|>|\||-{3})/.test(x));
  return (p ?? "").replace(/\s*\n\s*/g, " ").slice(0, 600);
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
    settings: (m?.settings ?? []).map((s) => ({ key: s.key, about: s.about ?? "", default: s.default ?? "", detect: s.detect ? [].concat(s.detect).join(" ") : "", required: !!s.required, secret: !!s.secret })),
    questions,
    install: `ask-kit kit install ${r.repo}`,
  });
  console.log(`${r.repo}: ${m ? "kit" : "domain"}, ${questions.length} bench question(s)`);
}

fs.writeFileSync(out, JSON.stringify({ built: new Date().toISOString(), kits }, null, 2) + "\n");
console.log(`${kits.length} kit(s) → ${out}`);
