// A read-only client for one repository: ripgrep, file reads and a short list of git commands.
// Commands run with execFile (no shell), paths stay inside the repository, and nothing writes.
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { rgPath } from "../../src/platform.mjs";

const GIT_ALLOWED = new Set(["log", "show", "blame", "diff", "ls-files", "grep", "rev-parse", "status", "shortlog", "branch", "tag"]);
// Options that would make a read-only git command write, run a program or read outside the repo.
const GIT_DENIED = /^(--output|--ext-diff|--textconv|-c$|--exec|--upload-pack|--git-dir|--work-tree|-C$|--config|-O|--open-files-in-pager)/;

function exec(cmd, args, { cwd, maxBuffer = 32 << 20, timeoutMs = 60_000 } = {}) {
  // ripgrep: the system's, or the one bundled with ask-kit.
  const bin = cmd === "rg" ? rgPath() : cmd;
  if (!bin) return Promise.reject(new Error("ripgrep is not installed and the bundled copy is missing: reinstall ask-kit (npm install) or install rg"));
  return new Promise((resolve, reject) => {
    execFile(bin, args, { cwd, maxBuffer, timeout: timeoutMs, encoding: "utf8" }, (err, stdout, stderr) => {
      // rg exits 1 for "no matches", which is an answer, not a failure.
      if (err && !(cmd === "rg" && err.code === 1)) {
        reject(new Error(`${cmd} ${args.slice(0, 6).join(" ")}: ${(stderr || err.message).slice(0, 400)}`));
        return;
      }
      resolve(stdout);
    });
  });
}

export function makeRepo({ root, push }) {
  const ROOT = fs.realpathSync(root);
  const inside = (p = ".") => {
    const full = path.resolve(ROOT, p);
    const rel = path.relative(ROOT, full);
    if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error(`${p} is outside the repository (${ROOT})`);
    return { full, rel: rel || "." };
  };
  const note = (kind, detail, started, size) => push({ kind, detail, ms: Date.now() - started, size });

  return {
    root: ROOT,

    /** ripgrep. Returns matches as {file, line, text}; `max` caps them (default 200). */
    async rg(pattern, o = {}) {
      const started = Date.now();
      const args = ["--json", "--max-columns", "300", "--max-columns-preview"];
      if (o.fixed) args.push("-F");
      if (o.ignoreCase) args.push("-i");
      if (o.word) args.push("-w");
      if (o.context) args.push("-C", String(o.context));
      for (const g of [].concat(o.glob ?? [])) args.push("-g", g);
      for (const t of [].concat(o.type ?? [])) args.push("-t", t);
      if (o.hidden) args.push("--hidden");
      // Always a path: with none, rg reads stdin (a pipe here) and waits on it.
      args.push("-e", pattern, "--", inside(o.path).rel);
      const out = await exec("rg", args, { cwd: ROOT });
      const max = o.max ?? 200;
      const hits = [];
      let total = 0;
      for (const line of out.split("\n")) {
        if (!line) continue;
        const ev = JSON.parse(line);
        if (ev.type !== "match" && ev.type !== "context") continue;
        if (ev.type === "match") total++;
        if (hits.length >= max) continue;
        hits.push({
          file: ev.data.path.text.replace(/^\.\//, ""),
          line: ev.data.line_number,
          text: (ev.data.lines.text ?? "").replace(/\n$/, ""),
          ...(ev.type === "context" ? { context: true } : {}),
        });
      }
      note("rg", pattern, started, total);
      return Object.assign(hits, { total, complete: total <= max });
    },

    /** Files tracked or not ignored, optionally matching a glob (rg --files). */
    async files(glob, o = {}) {
      const started = Date.now();
      const args = ["--files"];
      if (glob) args.push("-g", glob);
      if (o.hidden) args.push("--hidden");
      args.push("--", inside(o.path).rel);
      const list = (await exec("rg", args, { cwd: ROOT })).split("\n").filter(Boolean).map((f) => f.replace(/^\.\//, "")).sort();
      note("files", glob ?? "*", started, list.length);
      const max = o.max ?? 2000;
      return Object.assign(list.slice(0, max), { total: list.length, complete: list.length <= max });
    },

    /** Lines `from`..`to` of a file (1-based, inclusive), numbered; at most 400 lines. */
    read(file, o = {}) {
      const started = Date.now();
      const { full, rel } = inside(file);
      const lines = fs.readFileSync(full, "utf8").split("\n");
      const from = Math.max(1, o.from ?? 1);
      const to = Math.min(lines.length, o.to ?? from + 399, from + 399);
      const text = lines
        .slice(from - 1, to)
        .map((l, i) => `${from + i}\t${l}`)
        .join("\n");
      note("read", `${rel}:${from}-${to}`, started, to - from + 1);
      return { file: rel, from, to, lines: lines.length, text };
    },

    /** A read-only git command: one of log, show, blame, diff, ls-files, grep, rev-parse, status, shortlog, branch, tag. */
    async git(sub, ...args) {
      const started = Date.now();
      if (!GIT_ALLOWED.has(sub)) throw new Error(`git ${sub} is not allowed here; allowed: ${[...GIT_ALLOWED].join(", ")}`);
      const bad = args.find((a) => GIT_DENIED.test(String(a)));
      if (bad) throw new Error(`git option ${bad} is not allowed here`);
      const out = await exec("git", ["--no-pager", "-c", "core.pager=cat", sub, ...args.map(String)], { cwd: ROOT });
      note("git", `${sub} ${args.join(" ")}`.slice(0, 200), started, out.length);
      return out;
    },
  };
}
