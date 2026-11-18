// Where ask-kit keeps things, and the config `setup` writes.
//
//   ~/.config/ask-kit/config.json   what setup decided: backends, transcript sources, domains, clients
//   ~/.config/ask-kit/keys.env      keys pasted during setup (0600); otherwise keys stay where they were
//   ~/.local/state/ask-kit/         journals, REPL snapshots, warm sessions, the transcript index
//
// ASK_KIT_CONFIG and ASK_KIT_STATE move them (tests use both).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const HOME = os.homedir();
export const WIN = process.platform === "win32";
// Linux and macOS: XDG folders (~/.config, ~/.local/state), as most CLIs use on both.
// Windows: %APPDATA%\ask-kit and %LOCALAPPDATA%\ask-kit.
export const CONFIG_DIR =
  process.env.ASK_KIT_CONFIG ||
  (WIN ? path.join(process.env.APPDATA || path.join(HOME, "AppData", "Roaming"), "ask-kit") : path.join(process.env.XDG_CONFIG_HOME || path.join(HOME, ".config"), "ask-kit"));
export const STATE_ROOT =
  process.env.ASK_KIT_STATE ||
  (WIN ? path.join(process.env.LOCALAPPDATA || path.join(HOME, "AppData", "Local"), "ask-kit", "state") : path.join(process.env.XDG_STATE_HOME || path.join(HOME, ".local/state"), "ask-kit"));
export const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
export const KEYS_FILE = path.join(CONFIG_DIR, "keys.env");

export const expand = (p) => (typeof p === "string" ? p.replace(/^~(?=$|\/)/, HOME) : p);

export function readEnvFile(file) {
  const out = {};
  try {
    for (const line of fs.readFileSync(expand(file), "utf8").split("\n")) {
      const m = line.match(/^\s*(?:export\s+)?([A-Za-z0-9_]+)=(.*)$/);
      if (m) out[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, "");
    }
  } catch {}
  return out;
}

export function loadConfig({ required = true } = {}) {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  } catch (e) {
    if (!required) return null;
    if (e.code === "ENOENT") throw new Error(`ask-kit is not set up yet: run \`ask-kit setup\`, or ask your agent to (skill ask-kit-setup). Expected ${CONFIG_FILE}`);
    throw new Error(`${CONFIG_FILE}: ${e.message}`);
  }
}

export function saveConfig(config) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  const tmp = `${CONFIG_FILE}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(tmp, CONFIG_FILE);
}

/** Store a pasted key in keys.env (0600) and return the reference config keeps instead of the key. */
export function storeKey(name, value) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  const env = readEnvFile(KEYS_FILE);
  env[name] = value;
  fs.writeFileSync(KEYS_FILE, Object.entries(env).map(([k, v]) => `${k}=${v}`).join("\n") + "\n", { mode: 0o600 });
  return { file: KEYS_FILE, var: name };
}

/**
 * A key reference, as config holds it: {env: "NAME"}, {file: "path", var: "NAME"}, or both
 * (env wins). Config never holds a key itself.
 */
export function resolveKey(ref) {
  if (!ref) return null;
  if (ref.env && process.env[ref.env]) return process.env[ref.env];
  if (ref.file) return readEnvFile(ref.file)[ref.var || ref.env] || null;
  return null;
}

/** The session that called: the agent's own id when it passes one, else the client process. */
export function callerSession() {
  const id = ["ASK_KIT_SESSION", "CLAUDE_CODE_SESSION_ID", "CODEX_THREAD_ID", "CODEX_SESSION_ID", "COPILOT_SESSION_ID"]
    .map((k) => process.env[k]?.trim())
    .find(Boolean);
  return id || `client-${process.ppid}`;
}

export const slug = (s) => String(s).replace(/^\/+/, "").replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 120);
