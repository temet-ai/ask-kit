// Warm-ups: work a domain or a kit declares to run with no model when a session starts, so the
// first ask finds it done. The code domain's builds the code map (domains/code/map.mjs). A kit
// declares one in ask-kit.toml:
//
//   [warm]
//   script = "index"           one of the kit's scripts, run with no model in the session's folder
//   params = { days = 7 }      its params
//   notice = "the index is ready"   one line for the session once it has run (optional)
//   prime = "..."              the first prompt of the kit's warm investigator session (optional)
//
// `ask-kit warm [folder]` runs every warm-up in the foreground. The Claude Code plugin's
// SessionStart hook runs `ask-kit plugin warm` with async: true: it starts `ask-kit warm` as a
// detached process (which outlives a `claude -p` session), waits for it, and prints at most one
// line, which Claude Code hands the session on its next turn. Nothing else reaches the session.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT, STATE_ROOT, loadConfig, slug } from "./config.mjs";

export const warmDir = () => path.join(STATE_ROOT, "warmups");
const BIN = path.join(ROOT, "bin", "ask-kit.mjs");
// How long the hook waits for the warm-ups, and how long one warm-up may run before it is stopped.
const WAIT_MS = 15 * 60_000;
const RUN_MS = 10 * 60_000;

/** What a warm-up declaration must hold; problems as text (src/kits.mjs readManifest uses it). */
export function checkWarm(w) {
  if (w == null) return [];
  if (typeof w !== "object" || Array.isArray(w)) return ["[warm]: a table with script, params, notice and prime"];
  const problems = [];
  if (w.script == null && w.prime == null) problems.push("[warm]: script (a script run with no model when a session starts), prime, or both");
  if (w.script != null && !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(String(w.script))) problems.push("warm.script: the name of one of the kit's scripts");
  if (w.params != null && (typeof w.params !== "object" || Array.isArray(w.params))) problems.push("warm.params: a table of the script's params");
  for (const k of ["notice", "prime"]) if (w[k] != null && typeof w[k] !== "string") problems.push(`warm.${k}: text`);
  return problems;
}

/** The enabled domains and kits that declare a warm-up script: [{ name, script, params, notice }]. */
export async function warmups(config = loadConfig({ required: false })) {
  const { findKit, readManifest } = await import("./kits.mjs");
  const { domainDirs } = await import("./domains.mjs");
  const out = [];
  for (const [name, d] of Object.entries(config?.domains ?? {})) {
    if (!d || typeof d !== "object" || d.enabled === false) continue;
    let w = null;
    try {
      const kit = findKit(name);
      if (kit) w = readManifest(kit).warm ?? null;
      else {
        // A domain module says it in `warm`; the code domain's builds the map.
        const file = domainDirs().map((dir) => path.join(dir, name, "domain.mjs")).find((f) => fs.existsSync(f));
        if (file) w = (await import(pathToFileURL(file).href)).domain?.warm ?? null;
      }
    } catch {
      continue;
    }
    if (w?.script) out.push({ name, script: w.script, params: w.params ?? {}, notice: w.notice ?? null });
  }
  return out;
}

/** Run one warm-up's script with no model; { name, ok, ms, notice?, result?, error? }. */
export async function runWarmup(w, config) {
  const started = Date.now();
  try {
    const { loadDomain } = await import("./domains.mjs");
    const { toolkit } = await import("./core/toolkit.mjs");
    const d = await loadDomain(w.name);
    if (d.unavailable) return { name: w.name, ok: false, ms: Date.now() - started, error: `cannot run here: ${d.unavailable}` };
    const dirs = d.scriptsDirs ?? [d.scriptsDir];
    const file = [...dirs].reverse().map((dir) => path.join(dir, `${w.script}.mjs`)).find((f) => fs.existsSync(f));
    if (!file) return { name: w.name, ok: false, ms: Date.now() - started, error: `no script ${w.script} in ${dirs.join(", ")}` };
    const mod = await import(pathToFileURL(file).href);
    const globals = d.makeGlobals({ push: () => {}, config, act: false });
    let timer;
    const value = await Promise.race([
      mod.default({ ...globals, tk: toolkit }, w.params ?? {}),
      new Promise((_, reject) => (timer = setTimeout(() => reject(new Error(`did not finish in ${RUN_MS / 60_000} minutes`)), RUN_MS))),
    ]).finally(() => clearTimeout(timer));
    const notice = typeof value?.notice === "string" ? value.notice : w.notice;
    return { name: w.name, ok: true, ms: Date.now() - started, ...(notice ? { notice } : {}), result: typeof value === "string" ? value.slice(0, 2000) : value };
  } catch (e) {
    return { name: w.name, ok: false, ms: Date.now() - started, error: String(e?.message ?? e).slice(0, 2000) };
  }
}

/**
 * Every warm-up for `folder`, one after another, in this process. The code domain reads its
 * repository from ASK_KIT_CODE_ROOT, so it is set to `folder` before any domain loads. Each result
 * is kept in STATE_ROOT/warmups/<name>-<folder>.json.
 */
export async function runWarmups(folder, { config = loadConfig({ required: false }), only } = {}) {
  process.env.ASK_KIT_CODE_ROOT = folder;
  const list = (await warmups(config)).filter((w) => !only || only.includes(w.name));
  const results = [];
  for (const w of list) {
    const r = await runWarmup(w, config);
    results.push(r);
    try {
      fs.mkdirSync(warmDir(), { recursive: true, mode: 0o700 });
      fs.writeFileSync(path.join(warmDir(), `${slug(w.name)}-${slug(folder)}.json`), JSON.stringify({ ...r, folder, at: new Date().toISOString() }) + "\n", { mode: 0o600 });
    } catch {}
  }
  return results;
}

// The hook input Claude Code sends on stdin, or {} when there is none.
async function hookInput(timeoutMs = 2000) {
  if (process.stdin.isTTY) return {};
  return await new Promise((resolve) => {
    let text = "";
    const done = () => {
      try {
        resolve(JSON.parse(text || "{}"));
      } catch {
        resolve({});
      }
    };
    const t = setTimeout(done, timeoutMs);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (text += c));
    process.stdin.on("end", () => {
      clearTimeout(t);
      done();
    });
    process.stdin.on("error", () => {
      clearTimeout(t);
      done();
    });
  });
}

// Variables a child must not carry: they would make it write into the caller's REPL state (as childEnv in src/ask.mjs).
const CALLER_VARS = ["ASK_KIT_SESSION", "CLAUDE_CODE_SESSION_ID", "CODEX_THREAD_ID", "CODEX_SESSION_ID", "COPILOT_SESSION_ID", "ASK_KIT_INNER", "ASK_KIT_CALLER", "ASK_KIT_INHERIT", "ASK_KIT_ACT"];

/**
 * The plugin's async SessionStart hook. In a git repository, with ask-kit set up and at least one
 * warm-up declared, it starts `ask-kit warm <repo> --out <file>` detached, waits for it, and prints
 * one line of hook JSON naming what is ready. It prints nothing otherwise, and never fails.
 */
export async function pluginWarmHook({ waitMs = WAIT_MS } = {}) {
  try {
    const input = await hookInput();
    const config = loadConfig({ required: false });
    if (!config) return;
    const { gitTop } = await import("../domains/code/repo.mjs");
    const root = gitTop(input.cwd || process.cwd());
    if (!root || root === path.parse(root).root) return;
    if (!(await warmups(config)).length) return;
    fs.mkdirSync(warmDir(), { recursive: true, mode: 0o700 });
    const out = path.join(warmDir(), `run-${process.pid}-${Date.now()}.json`);
    const env = { ...process.env };
    for (const k of CALLER_VARS) delete env[k];
    const child = spawn(process.execPath, [BIN, "warm", root, "--out", out], { cwd: root, env, detached: true, stdio: "ignore", windowsHide: true });
    const exited = await new Promise((resolve) => {
      const t = setTimeout(() => resolve(false), waitMs);
      child.on("exit", () => {
        clearTimeout(t);
        resolve(true);
      });
      child.on("error", () => {
        clearTimeout(t);
        resolve(false);
      });
    });
    if (!exited) {
      child.unref();
      return;
    }
    let results = [];
    try {
      results = JSON.parse(fs.readFileSync(out, "utf8"));
    } catch {}
    fs.rmSync(out, { force: true });
    const notices = results.filter((r) => r.ok && r.notice).map((r) => r.notice);
    if (!notices.length) return;
    const text = `ask-kit: ${notices.join("; ")}.`;
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: text } }) + "\n");
  } catch {}
}
