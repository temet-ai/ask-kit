// `ask-kit kit update`: brings each linked kit that is a git checkout to its upstream, fast-forward
// only, and installs its packages when they changed. A checkout with changes, its own commits or no
// upstream is left alone and named. With --machines, each machine in the config does the same.
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { CONFIG_DIR } from "./config.mjs";
import { findKit, listKits, readManifest } from "./kits.mjs";
import { machinesOf, runThere } from "./machines.mjs";

const run = (cmd, args, cwd) =>
  new Promise((ok) => execFile(cmd, args, { cwd, timeout: 180_000 }, (e, out, err) => ok({ ok: !e, out: String(out).trim(), err: (String(err).trim().split("\n").at(-1) || e?.message || "").slice(0, 200) })));

export async function updateKit(name) {
  const dir = fs.realpathSync(findKit(name));
  const git = (...a) => run("git", a, dir);
  const row = (state, more = {}) => ({ kit: name, version: readManifest(dir).version ?? null, state, ...more });
  if (!(await git("rev-parse", "--show-toplevel")).ok || !fs.existsSync(`${dir}/.git`)) return row("not a checkout");
  const fetched = await git("fetch", "-q");
  if (!fetched.ok) return row("not fetched", { why: fetched.err });
  const counts = await git("rev-list", "--left-right", "--count", "HEAD...@{u}");
  if (!counts.ok) return row("no upstream");
  const [ahead, behind] = counts.out.split(/\s+/).map(Number);
  if (ahead && behind) return row("diverged", { ahead, behind });
  if (!behind) return row(ahead ? "unpushed" : "current", ahead ? { ahead } : {});
  const from = readManifest(dir).version ?? null;
  const before = (await git("rev-parse", "HEAD")).out;
  const merged = await git("merge", "-q", "--ff-only", "@{u}");
  if (!merged.ok) return row("has changes", { behind, why: merged.err });
  const packages = (await git("diff", "--name-only", before, "HEAD", "--", "package.json", "package-lock.json")).out;
  if (packages && fs.existsSync(`${dir}/package.json`)) {
    const npm = await run("npm", ["install", "--no-audit", "--no-fund", "--no-save"], dir);
    if (!npm.ok) return row("updated, packages not installed", { from, why: npm.err });
  }
  return row("updated", { from, commits: behind });
}

export async function updateKits() {
  const out = [];
  for (const k of listKits()) {
    if (findKit(k)?.startsWith(path.join(CONFIG_DIR, "kits") + path.sep)) out.push(await updateKit(k).catch((e) => ({ kit: k, state: "failed", why: e.message.slice(0, 200) })));
  }
  return out;
}

export async function updateMachines(config) {
  return Promise.all(
    machinesOf(config).map(async (m) => {
      try {
        return { host: m.host, kits: JSON.parse(String(await runThere(m, "kit update --json", 600_000))) };
      } catch (e) {
        return { host: m.host, error: /JSON/.test(e.message) ? "its ask-kit is older than 0.8.0" : e.message };
      }
    }),
  );
}
