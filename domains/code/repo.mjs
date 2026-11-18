// A client for one repository: ripgrep, file reads and writes, edits, git and any program, run
// with execFile (no shell) in the repository. Relative paths resolve against the repository root.
import { execFile } from "node:child_process";
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

export function makeRepo({ root, push }) {
  const ROOT = fs.realpathSync(root);
  const inside = (p = ".") => {
    const full = path.resolve(ROOT, p);
    const rel = path.relative(ROOT, full);
    return { full, rel: rel.startsWith("..") || path.isAbsolute(rel) ? full : rel || "." };
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

    /**
     * ast-grep: structural search by code shape (`Duration::from_secs($N)`, `std::env::var($K)`,
     * `fn $NAME($$$) -> Result<$T>`). Returns {file, line, text, vars}; `max` caps them (default 200).
     */
    async sg(pattern, o = {}) {
      const started = Date.now();
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

    /** Any git command, run in the repository. Returns stdout; throws on a non-zero exit. */
    async git(sub, ...args) {
      const started = Date.now();
      const out = await exec("git", ["--no-pager", "-c", "core.pager=cat", sub, ...args.map(String)], { cwd: ROOT });
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
