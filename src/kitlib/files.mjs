// Files for kits: which paths hold credentials (never read, never listed by name: what a kit reads
// goes to a model), walking a folder with a skip list, a cap and a time budget, and sizes and ages
// as text. From the kits' own copies (ask-kit kit commons, 2026-11-21): the dotfiles kit's exclude
// list and the systemd kit's SECRET_FILE for credentials; data, sqlite, logs and deps for walking;
// data, logs, procs and tests for sizes and ages.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// A file name that holds credentials: known files, key and keystore extensions, histories.
const SECRET_NAME = /^(\.env(\..*)?|.*\.env|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?|.*\.(pem|key|p12|pfx|jks|keystore|kdbx|gpg|asc)|\.netrc|_netrc|\.npmrc|\.pypirc|\.pgpass|\.git-credentials|\.htpasswd|auth\.json|hosts\.yml|known_hosts|authorized_keys|cookies?(\.sqlite)?|login data|.*\.keychain(-db)?|\.?(bash|zsh|sh|python|psql|mysql|sqlite|node_repl|irb|lesshst)_history|fish_history|history\.db)$/i;
// A credential word as a whole part of the name (api-token.txt, client_secret.json, credentials),
// unless it is source code or documentation about one (token.js, secrets.md, tokenizer.py).
const SECRET_WORD = /(^|[._-])(tokens?|secrets?|credentials?|passwords?|passwd|apikeys?|api[._-]keys?)([._-]|$)/i;
const CODE_OR_DOC = /\.(m?[jt]sx?|cjs|py|rb|go|rs|java|kt|swift|c|cc|cpp|h|hpp|cs|php|scala|ex|exs|md|mdx|rst|html?|adoc)$/i;
// Folders whose contents are credentials or private stores.
const SECRET_DIR = /^(\.ssh|\.gnupg|\.aws|\.azure|\.kube|\.docker|\.password-store|1password|\.op|keychains|gcloud|\.config\/gcloud|gh|glab-cli|op|rclone)$/i;

/** Whether a path names a file that holds credentials, or sits in a folder that does. */
export function isSecretPath(p) {
  const parts = String(p).split(/[\\/]+/).filter(Boolean);
  if (!parts.length) return false;
  const name = parts.at(-1);
  if (SECRET_NAME.test(name) || (SECRET_WORD.test(name) && !CODE_OR_DOC.test(name))) return true;
  return parts.slice(0, -1).some((d) => SECRET_DIR.test(d));
}

export const SKIP_DIRS = new Set(["node_modules", ".git", ".hg", ".svn", ".cache", ".venv", "venv", "__pycache__", "target", "dist", "build", ".next", ".turbo", ".gradle", ".idea", ".vscode", "vendor", "Library", ".Trash", "proc", "sys", "dev"]);

/**
 * Files under a folder, breadth first. o.match (a function or regex on the relative path), o.depth
 * (default 6), o.max (default 2000), o.ms (time budget, default 5000), o.skip (more folder names),
 * o.dirs (list folders too), o.hidden (enter hidden folders). Credential files are counted, never
 * listed. Returns {files: [{path, rel, size, mtime}], secretsSkipped, cut?} where cut says why it stopped early.
 */
export function walk(dir, o = {}) {
  const root = path.resolve(dir);
  const skip = new Set([...SKIP_DIRS, ...[].concat(o.skip ?? [])]);
  const match = typeof o.match === "function" ? o.match : o.match instanceof RegExp ? (r) => o.match.test(r) : () => true;
  const max = o.max ?? 2000;
  const until = Date.now() + (o.ms ?? 5000);
  const files = [];
  let secretsSkipped = 0;
  let cut = null;
  const queue = [[root, 0]];
  while (queue.length) {
    const [d, depth] = queue.shift();
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (Date.now() > until) {
        cut = `stopped after ${o.ms ?? 5000} ms`;
        break;
      }
      const full = path.join(d, e.name);
      const rel = path.relative(root, full).split(path.sep).join("/");
      if (isSecretPath(rel)) {
        secretsSkipped++;
        continue;
      }
      if (e.isDirectory()) {
        if (skip.has(e.name) || (!o.hidden && e.name.startsWith("."))) continue;
        if (o.dirs && match(rel + "/")) files.push({ path: full, rel: rel + "/", dir: true });
        if (depth + 1 < (o.depth ?? 6)) queue.push([full, depth + 1]);
        continue;
      }
      if (!e.isFile() || !match(rel)) continue;
      let st;
      try {
        st = fs.statSync(full);
      } catch {
        continue;
      }
      files.push({ path: full, rel, size: st.size, mtime: st.mtime.toISOString() });
      if (files.length >= max) {
        cut = `stopped at ${max} files`;
        break;
      }
    }
    if (cut) break;
  }
  return { files, secretsSkipped, ...(cut ? { cut } : {}) };
}

/** 1536 -> "1.5 KB", 1.4e9 -> "1.3 GB". */
export function size(bytes) {
  const b = Number(bytes);
  if (!Number.isFinite(b)) return null;
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = Math.abs(b);
  while (v >= 1024 && i < units.length - 1) (v /= 1024), i++;
  return `${b < 0 ? "-" : ""}${i === 0 ? v : v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

/** How long ago a time was, as text: "40s ago", "12 min ago", "3.5 h ago", "6 days ago". `now` for tests. */
export function age(when, now = Date.now()) {
  const t = when instanceof Date ? when.getTime() : typeof when === "number" ? when : Date.parse(when);
  if (!Number.isFinite(t)) return null;
  const s = Math.round((now - t) / 1000);
  const a = Math.abs(s);
  const txt = a < 90 ? `${a}s` : a < 5400 ? `${Math.round(a / 60)} min` : a < 129_600 ? `${(a / 3600).toFixed(1)} h` : `${Math.round(a / 86_400)} days`;
  return s >= 0 ? `${txt} ago` : `in ${txt}`;
}

/** A path from the caller: ~ is the home folder, a relative path is relative to `base`. */
export const resolvePath = (p, base) => path.resolve(base ?? process.cwd(), String(p).replace(/^~(?=$|[\\/])/, os.homedir()));
