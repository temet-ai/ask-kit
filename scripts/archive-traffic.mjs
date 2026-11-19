#!/usr/bin/env node
// Keeps GitHub's traffic numbers past their 14-day window: node scripts/archive-traffic.mjs <dir>
// Reads views, clones, referrers, paths and stars for GITHUB_REPOSITORY (default
// temet-ai/ask-kit) with TRAFFIC_TOKEN (a token that may read the repository's traffic) and
// merges them into <dir>: views.json and clones.json keyed by day (a later run replaces a day,
// since GitHub revises the last one), referrers.jsonl and paths.jsonl one 14-day snapshot per
// run, and stars.jsonl one line per run.
import fs from "node:fs";
import path from "node:path";

const dir = process.argv[2];
const repo = process.env.GITHUB_REPOSITORY || "temet-ai/ask-kit";
const token = process.env.TRAFFIC_TOKEN;
if (!dir || !token) {
  console.error("usage: TRAFFIC_TOKEN=... node scripts/archive-traffic.mjs <dir>");
  process.exit(2);
}

async function get(p) {
  const r = await fetch(`https://api.github.com/repos/${repo}${p}`, { headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "user-agent": "ask-kit-traffic" } });
  if (!r.ok) throw new Error(`${p}: ${r.status} ${await r.text()}`);
  return r.json();
}

function mergeDays(file, days) {
  const at = path.join(dir, file);
  const kept = fs.existsSync(at) ? JSON.parse(fs.readFileSync(at, "utf8")) : {};
  for (const d of days) kept[d.timestamp.slice(0, 10)] = { count: d.count, uniques: d.uniques };
  const sorted = Object.fromEntries(Object.entries(kept).sort(([a], [b]) => a.localeCompare(b)));
  fs.writeFileSync(at, JSON.stringify(sorted, null, 1) + "\n");
}

const append = (file, row) => fs.appendFileSync(path.join(dir, file), JSON.stringify(row) + "\n");

fs.mkdirSync(dir, { recursive: true });
const on = new Date().toISOString().slice(0, 10);
const [views, clones, referrers, paths, meta] = await Promise.all([get("/traffic/views"), get("/traffic/clones"), get("/traffic/popular/referrers"), get("/traffic/popular/paths"), get("")]);
mergeDays("views.json", views.views);
mergeDays("clones.json", clones.clones);
append("referrers.jsonl", { on, referrers });
append("paths.jsonl", { on, paths: paths.map(({ path: p, count, uniques }) => ({ path: p, count, uniques })) });
append("stars.jsonl", { on, stars: meta.stargazers_count, forks: meta.forks_count, watchers: meta.subscribers_count });
console.log(`${on}: ${meta.stargazers_count} stars, ${views.count} views and ${clones.count} clones in the last 14 days, ${referrers.length} referrers`);
