// What differs between Linux, macOS and Windows, in one place: finding a program on PATH,
// starting one (Windows CLIs installed by npm are .cmd shims, which need a shell), and ripgrep
// (the system's if there is one, else the copy @vscode/ripgrep downloaded at install).
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const WIN = process.platform === "win32";
const require = createRequire(import.meta.url);

/** The full path of `bin` on PATH, or null. */
export function which(bin) {
  if (path.isAbsolute(bin)) return fs.existsSync(bin) ? bin : null;
  const exts = WIN ? (process.env.PATHEXT || ".EXE;.CMD;.BAT;.COM").split(";").map((e) => e.toLowerCase()) : [""];
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of WIN ? ["", ...exts] : exts) {
      const full = path.join(dir, bin + ext);
      try {
        const st = fs.statSync(full);
        if (st.isFile() && (WIN ? ext !== "" || /\.(exe|cmd|bat|com)$/i.test(full) : st.mode & 0o111)) return full;
      } catch {}
    }
  }
  return null;
}

// cmd.exe quoting for one argument: wrap in quotes, double inner quotes, escape cmd metacharacters.
const winQuote = (a) => (/^[\w.\/:=@-]+$/.test(a) ? a : `"${String(a).replace(/"/g, '""')}"`);

/**
 * spawn() that also runs Windows .cmd/.bat shims (claude, codex, copilot from npm). Same options
 * as spawn; resolves the program on PATH first.
 */
export function spawnCli(bin, args, opts = {}) {
  const full = which(bin) ?? bin;
  if (WIN && /\.(cmd|bat)$/i.test(full)) {
    return spawn(`"${full}" ${args.map(winQuote).join(" ")}`, [], { ...opts, shell: true, windowsVerbatimArguments: true });
  }
  return spawn(full, args, opts);
}

/** Run a program to completion: {code, out, err, timedOut?}. Never rejects. */
export function runCli(bin, args, { cwd, env, timeoutMs = 60_000, signal } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawnCli(bin, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      resolve({ code: -1, out: "", err: e.message });
      return;
    }
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    let timedOut = false;
    const kill = () => child.kill("SIGTERM");
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, timeoutMs);
    signal?.addEventListener("abort", kill, { once: true });
    child.on("error", (e) => resolve({ code: -1, out, err: String(e.message) }));
    child.on("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", kill);
      resolve({ code, out, err, ...(timedOut ? { timedOut } : {}) });
    });
  });
}

let rg;
/** ripgrep: on PATH, else the binary @vscode/ripgrep installed with ask-kit. */
export function rgPath() {
  if (rg !== undefined) return rg;
  rg = which("rg");
  if (!rg) {
    try {
      rg = require("@vscode/ripgrep").rgPath;
    } catch {
      rg = null;
    }
  }
  return rg;
}
