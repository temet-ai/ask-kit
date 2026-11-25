// A client for one repository: ripgrep, file reads and writes, edits, git and any program, run
// with execFile (no shell) in the repository. Relative paths resolve against the repository root.
import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { rgPath } from "../../src/platform.mjs";

function exec(cmd, args, { cwd, maxBuffer = 32 << 20, timeoutMs = 60_000 } = {}) {
  // ripgrep: the system's, or the one bundled with ask-kit.
  const bin = cmd === "rg" ? rgPath() : cmd;
  if (!bin) return Promise.reject(new Error("ripgrep is not installed and the bundled copy is missing: reinstall ask-kit (npm install) or install rg"));
  return new Promise((resolve, reject) => {
    execFile(bin, args, { cwd, maxBuffer, timeout: timeoutMs, encoding: "utf8" }, (err, stdout, stderr) => {
      // rg and ast-grep exit 1 for "no matches", which is an answer, not a failure.
      if (err && !((cmd === "rg" || cmd === "ast-grep") && err.code === 1)) {
        reject(new Error(`${cmd} ${args.slice(0, 6).join(" ")}: ${(stderr || err.message).slice(0, 400)}`));
        return;
      }
      resolve(stdout);
    });
  });
}

// What a repository client keeps in an ask that did not ask for a change (act: true): searches,
// reads and the git commands that only read. write, edit and run throw, and say so.
export const READ_GIT = new Set(["log", "show", "diff", "blame", "status", "ls-files", "ls-tree", "rev-parse", "rev-list", "grep", "shortlog", "describe", "cat-file", "merge-base", "name-rev", "for-each-ref", "whatchanged"]);
// Options of those commands that write a file or start another program.
const GIT_WRITES = /^(--output|--open-files-in-pager|-O|--ext-diff)/;

/** The message an acting call gives in a read-only ask. */
export const offInThisAsk = (what) =>
  `${what} is off in this ask: the caller did not ask for a change (act: true), so nothing was changed. ` +
  "Answer what you can, and say that the change needs `ask` with act: true. Do not look for another way to make it.";

/** `repo` with no way to change anything: write, edit and run throw; git runs only commands that read. */
export function readOnly(repo, name = "repo") {
  return {
    ...repo,
    git(sub, ...args) {
      if (!READ_GIT.has(String(sub))) return Promise.reject(new Error(offInThisAsk(`${name}.git("${sub}")`) + ` Read-only git here: ${[...READ_GIT].join(", ")}.`));
      const bad = args.map(String).find((a) => GIT_WRITES.test(a));
      if (bad) return Promise.reject(new Error(offInThisAsk(`git ${sub} ${bad}`)));
      return repo.git(sub, ...args);
    },
    write: () => {
      throw new Error(offInThisAsk(`${name}.write`));
    },
    edit: () => {
      throw new Error(offInThisAsk(`${name}.edit`));
    },
    run: async () => {
      throw new Error(offInThisAsk(`${name}.run`));
    },
  };
}

const HIDDEN = [".claude/agents", ".claude/skills", ".claude/rules", ".claude/hooks", ".claude/commands", ".codex/skills", ".codex/agents", ".github"];

/** The top folder of the git repository that holds `dir`, or null. */
export function gitTop(dir) {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
  } catch {
    return null;
  }
}

/** The git repositories directly inside a folder, by name. */
export const reposIn = (dir) => fs.readdirSync(dir).filter((d) => fs.existsSync(path.join(dir, d, ".git"))).slice(0, 40);

/**
 * `repo.at(folder)`: git in another repository, the one that holds `folder` (searches and reads take
 * its absolute paths as they are). {root, git}, with the same git commands as `repo` has.
 */
export function withAt(repo, { push, act }) {
  return {
    ...repo,
    at(folder) {
      const dir = path.resolve(repo.root, folder);
      const top = fs.existsSync(dir) ? gitTop(fs.statSync(dir).isDirectory() ? dir : path.dirname(dir)) : null;
      if (!top) throw new Error(`repo.at: ${dir} is not in a git repository`);
      const other = makeRepo({ root: top, push });
      const { root, git } = act ? other : readOnly(other, "repo.at(folder)");
      return { root, git };
    },
  };
}

// `noteMissing`: a search or read of a path that does not exist answers with a row that says so and
// names the nearest ones, instead of throwing away every other result of its cell.
export function makeRepo({ root, push, noteMissing = false }) {
  const ROOT = fs.realpathSync(root);
  // A search aimed at a path git ignores (a dependency under node_modules, build output) reads it;
  // every other search skips ignored files.
  const aimedAtIgnored = (p) => (p ? exec("git", ["check-ignore", "-q", "--", p], { cwd: ROOT }).then(() => true, () => false) : false);
  const inside = (p = ".") => {
    const full = path.resolve(ROOT, p);
    const rel = path.relative(ROOT, full);
    return { full, rel: rel.startsWith("..") || path.isAbsolute(rel) ? full : rel || "." };
  };
  const missing = (p) => {
    if (!noteMissing || p == null) return null;
    const { full, rel } = inside(p);
    if (fs.existsSync(full)) return null;
    let parent = path.dirname(full);
    while (!fs.existsSync(parent)) parent = path.dirname(parent);
    const within = (full + path.sep).startsWith(ROOT + path.sep);
    let same = [];
    const rg = within && rgPath();
    if (rg) {
      const base = path.basename(full);
      try {
        const found = execFileSync(rg, ["--files", "--", "."], { cwd: ROOT, encoding: "utf8", maxBuffer: 32 << 20, stdio: ["ignore", "pipe", "ignore"] }).split("\n");
        for (const f of found) {
          const parts = f.replace(/^\.\//, "").split("/");
          const i = parts.lastIndexOf(base);
          if (i >= 0) same.push(parts.slice(0, i + 1).join("/"));
        }
        same = [...new Set(same)];
        // The ones that share most of the asked path's folders first.
        const asked = new Set(rel.split("/"));
        const shared = (f) => f.split("/").filter((x) => asked.has(x)).length;
        same.sort((a, b) => shared(b) - shared(a) || a.length - b.length);
      } catch {}
    }
    const held = fs.readdirSync(parent);
    const near = same.length ? `of that name: ${same.slice(0, 5).join(", ")}` : `${inside(parent).rel} holds ${held.slice(0, 20).join(", ")}${held.length > 20 ? ` and ${held.length - 20} more` : ""}`;
    return `NO SUCH PATH ${rel} (not searched; ${near})`;
  };
  // A search of the whole repository also looks in the hidden folders people keep agent and CI files
  // in; ripgrep skips hidden folders, and these are often left out of git on one machine.
  const everywhere = (p) => (noteMissing && (p == null || inside(p).rel === ".") ? [".", ...HIDDEN.filter((d) => fs.existsSync(path.join(ROOT, d)))] : [inside(p).rel]);
  const note = (kind, detail, started, size) => push({ kind, detail, ms: Date.now() - started, size });

  return {
    root: ROOT,

    /** ripgrep. Returns matches as {file, line, text}; `max` caps them (default 200). */
    async rg(pattern, o = {}) {
      const started = Date.now();
      const gone = missing(o.path);
      if (gone) return Object.assign([{ file: o.path, line: 0, text: gone }], { total: 0, complete: false, missing: gone });
      const args = ["--json", "--max-columns", "300", "--max-columns-preview"];
      if (o.fixed) args.push("-F");
      if (o.ignoreCase) args.push("-i");
      if (o.word) args.push("-w");
      if (o.context) args.push("-C", String(o.context));
      for (const g of [].concat(o.glob ?? [])) args.push("-g", g);
      for (const t of [].concat(o.type ?? [])) args.push("-t", t);
      if (o.hidden) args.push("--hidden");
      if (await aimedAtIgnored(o.path)) args.push("--no-ignore");
      // Always a path: with none, rg reads stdin (a pipe here) and waits on it.
      args.push("-e", pattern, "--", ...(o.hidden ? [inside(o.path).rel] : everywhere(o.path)));
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

    /**
     * ast-grep: structural search by code shape (`Duration::from_secs($N)`, `std::env::var($K)`,
     * `fn $NAME($$$) -> Result<$T>`). Returns {file, line, text, vars}; `max` caps them (default 200).
     */
    async sg(pattern, o = {}) {
      const started = Date.now();
      const gone = missing(o.path);
      if (gone) return Object.assign([{ file: o.path, line: 0, text: gone, vars: {} }], { total: 0, complete: false, missing: gone });
      const args = ["run", "-p", pattern, "--json=compact"];
      if (o.lang) args.push("-l", o.lang);
      for (const g of [].concat(o.glob ?? [])) args.push("--globs", g);
      args.push(inside(o.path).rel);
      let out;
      try {
        out = await exec("ast-grep", args, { cwd: ROOT });
      } catch (e) {
        throw /ENOENT/.test(e.message) ? new Error("ast-grep is not installed on this machine: use repo.rg") : e;
      }
      const all = JSON.parse(out || "[]");
      const max = o.max ?? 200;
      const hits = all.slice(0, max).map((m) => ({
        file: m.file.replace(/^\.\//, ""),
        line: m.range.start.line + 1,
        text: m.lines.length > 300 ? m.lines.slice(0, 300) + "…" : m.lines,
        vars: Object.fromEntries(Object.entries(m.metaVariables?.single ?? {}).map(([k, v]) => [k, v.text])),
      }));
      note("sg", pattern, started, all.length);
      return Object.assign(hits, { total: all.length, complete: all.length <= max });
    },

    /** Files tracked or not ignored, optionally matching a glob (rg --files). */
    async files(glob, o = {}) {
      const started = Date.now();
      const gone = missing(o.path);
      if (gone) return Object.assign([gone], { total: 0, complete: false, missing: gone });
      const args = ["--files"];
      for (const g of [].concat(glob ?? []).filter(Boolean)) args.push("-g", g);
      if (o.hidden) args.push("--hidden");
      if (await aimedAtIgnored(o.path)) args.push("--no-ignore");
      args.push("--", ...(o.hidden ? [inside(o.path).rel] : everywhere(o.path)));
      const list = [...new Set((await exec("rg", args, { cwd: ROOT })).split("\n").filter(Boolean).map((f) => f.replace(/^\.\//, "")))].sort();
      note("files", glob ?? "*", started, list.length);
      const max = o.max ?? 2000;
      return Object.assign(list.slice(0, max), { total: list.length, complete: list.length <= max });
    },

    /** Lines `from`..`to` of a file (1-based, inclusive), numbered; at most 400 lines. */
    read(file, o = {}) {
      const started = Date.now();
      const { full, rel } = inside(file);
      let gone = missing(file);
      if (!gone && noteMissing && fs.statSync(full).isDirectory()) gone = `${rel} IS A FOLDER, it holds ${fs.readdirSync(full).slice(0, 60).join(", ")}`;
      if (gone) return { file: rel, from: 0, to: 0, lines: 0, text: gone, missing: gone };
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

    /** Any git command, run in the repository. Returns stdout; throws on a non-zero exit. */
    async git(sub, ...args) {
      const started = Date.now();
      const out = await exec("git", ["--no-pager", "-c", "core.pager=cat", sub, ...args.map(String)], { cwd: ROOT }).catch((e) => {
        const held = noteMissing && /not a git repository/.test(e.message) ? reposIn(ROOT) : [];
        throw held.length ? new Error(`${ROOT} is not a git repository; it holds these: ${held.join(", ")}. Use repo.at(${JSON.stringify(held[0])}).git(...)`) : e;
      });
      note("git", `${sub} ${args.join(" ")}`.slice(0, 200), started, out.length);
      return out;
    },

    /** Write a whole file, creating its folders. */
    write(file, text) {
      const started = Date.now();
      const { full, rel } = inside(file);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, text);
      note("write", rel, started, text.length);
      return { file: rel, bytes: Buffer.byteLength(text) };
    },

    /** Replace `from` with `to` in a file: exactly one occurrence, or every one with { all: true }. */
    edit(file, from, to, o = {}) {
      const started = Date.now();
      const { full, rel } = inside(file);
      const text = fs.readFileSync(full, "utf8");
      const count = text.split(from).length - 1;
      if (!count) throw new Error(`${rel}: text to replace not found`);
      if (count > 1 && !o.all) throw new Error(`${rel}: text to replace occurs ${count} times; pass { all: true } or include more context`);
      fs.writeFileSync(full, o.all ? text.split(from).join(to) : text.replace(from, () => to));
      note("edit", rel, started, count);
      return { file: rel, replaced: o.all ? count : 1 };
    },

    /** Run any program in the repository (no shell). Returns {code, out, err}; never throws on a non-zero exit. */
    run(cmd, ...args) {
      const started = Date.now();
      return new Promise((resolve) => {
        execFile(cmd, args.map(String), { cwd: ROOT, maxBuffer: 32 << 20, timeout: 120_000, encoding: "utf8" }, (err, stdout, stderr) => {
          const r = { code: err ? (typeof err.code === "number" ? err.code : 1) : 0, out: stdout ?? "", err: (stderr || (err && !stdout ? err.message : "") || "").slice(0, 4000) };
          note("run", `${cmd} ${args.join(" ")}`.slice(0, 200), started, r.out.length);
          resolve(r);
        });
      });
    },
  };
}
