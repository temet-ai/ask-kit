// The code map of one repository: every name's definitions, uses and relations (implements,
// extends), read by scan.mjs from the files ripgrep would search, and kept on disk under
// ASK_KIT_STATE/code-map so the next session in the same tree, or the next question, reuses it.
//
//   <tree>.json.gz            the map built at a git tree (HEAD^{tree}; dir-<hash> outside git)
//   checkout-<root>.json.gz   one checkout's files that differ from that tree map, and which tree it was
//   <tree>.lock               held while a map is built from nothing
//
// Each file's entry carries the git blob id of the content it was read from. Before every answer
// ensureMap lists the files as they are now (git ls-files and git status, which only read) and
// reads again only the files whose blob differs: an edit rereads that file, a commit or a checkout
// rereads the files it changed. What could not be read in the time allowed is named as stale, and
// files the map skips (over 1 MB, binary, minified) as not mapped, so a caller can search them with
// ripgrep instead.
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { STATE_ROOT, slug } from "../../src/config.mjs";
import { rgPath } from "../../src/platform.mjs";
import { NOISE, noisy } from "./lib.mjs";
import { CALLABLE, DEF_KINDS, KINDS, REL_KINDS, SCAN_VERSION, STOP, decodeUses, langOf, scanFile } from "./scan.mjs";

export const MAX_FILE_BYTES = 1 << 20;
export const MAX_FILES = 60_000;
const KEEP_MAPS = 16;
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

export const mapDir = () => path.join(STATE_ROOT, "code-map");
const treeFile = (key) => path.join(mapDir(), `${key}.json.gz`);
const checkoutFile = (root) => path.join(mapDir(), `checkout-${slug(root)}.json.gz`);
const lockFile = (key) => path.join(mapDir(), `${key}.lock`);
const sha1 = (s) => crypto.createHash("sha1").update(s).digest("hex");
/** The id git gives this content: sha1 of "blob <bytes>\0<content>". */
export const blobId = (buf) => crypto.createHash("sha1").update(`blob ${buf.length}\0`).update(buf).digest("hex");

function readGz(file) {
  try {
    const v = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString("utf8"));
    return v?.v === SCAN_VERSION ? v : null;
  } catch {
    return null;
  }
}
function writeGz(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, zlib.gzipSync(JSON.stringify(value), { level: 4 }), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

const run = (cmd, args, cwd) =>
  new Promise((resolve, reject) =>
    execFile(cmd, args, { cwd, maxBuffer: 512 << 20, encoding: "utf8" }, (err, out, stderr) => (err && !(cmd !== "git" && err.code === 1) ? reject(new Error(`${path.basename(cmd)} ${args[0]}: ${(stderr || err.message).slice(0, 300)}`)) : resolve(out ?? ""))),
  );
const git = (cwd, ...args) => run("git", ["--no-optional-locks", ...args], cwd);

/** Where root sits in git: its top folder, its path inside it, the tree at HEAD and the repository it shares objects with. Null outside git. */
async function gitState(root) {
  let top;
  try {
    top = (await git(root, "rev-parse", "--show-toplevel")).trim();
  } catch {
    return null;
  }
  if (!top) return null;
  const prefix = path.relative(fs.realpathSync(top), root).split(path.sep).join("/");
  if (prefix.startsWith("..")) return null;
  const tree = (await git(top, "rev-parse", `HEAD:${prefix}`).catch(() => EMPTY_TREE)).trim() || EMPTY_TREE;
  const common = (await git(top, "rev-parse", "--git-common-dir").catch(() => ".git")).trim();
  return { top, prefix, tree, family: path.resolve(top, common) };
}

/** Every mapped file as it is now, with its blob id: path -> { blob, dirty }. */
async function gitFiles(root, gs) {
  const spec = ["--", gs.prefix || "."];
  const strip = (p) => (gs.prefix ? p.slice(gs.prefix.length + 1) : p);
  const [ls, st] = await Promise.all([
    git(gs.top, "ls-files", "-s", "-z", ...spec),
    git(gs.top, "status", "--porcelain=v1", "-z", "--untracked-files=all", "--no-renames", "--ignore-submodules", ...spec),
  ]);
  const files = new Map();
  for (const rec of ls.split("\0")) {
    const tab = rec.indexOf("\t");
    if (tab < 0) continue;
    const [mode, blob, stage] = rec.slice(0, tab).split(" ");
    const p = strip(rec.slice(tab + 1));
    if ((mode !== "100644" && mode !== "100755") || !langOf(p) || noisy(p)) continue;
    files.set(p, { blob, dirty: stage !== "0" });
  }
  for (const rec of st.split("\0")) {
    if (rec.length < 4) continue;
    const x = rec[0], y = rec[1];
    const p = strip(rec.slice(3));
    if (!langOf(p) || noisy(p)) continue;
    if (y === "D" || (x === "D" && y === " ")) files.delete(p);
    else if ((x === "?" && y === "?") || y === "M" || y === "T" || x === "U" || y === "U" || y === "A") files.set(p, { blob: null, dirty: true });
  }
  return files;
}

/** Outside git: the files ripgrep lists, with blob ids kept by size and mtime between calls. */
async function dirFiles(root, known = {}) {
  const rg = rgPath();
  if (!rg) throw new Error("ripgrep is not installed and the bundled copy is missing");
  const out = await run(rg, ["--files", ...NOISE.flatMap((g) => ["-g", g]), "--", "."], root);
  const files = new Map();
  for (const f of out.split("\n")) {
    const p = f.replace(/^\.\//, "");
    if (!p || !langOf(p) || noisy(p)) continue;
    let s;
    try {
      s = fs.statSync(path.join(root, p));
    } catch {
      continue;
    }
    const k = known[p];
    files.set(p, k && k[0] === s.size && k[1] === s.mtimeMs ? { blob: k[2], dirty: false, stat: [s.size, s.mtimeMs] } : { blob: null, dirty: true, stat: [s.size, s.mtimeMs] });
  }
  return files;
}

/** Read one file into its map entry: { b: blob, l: language, ...scan } or { b, s: why it is not mapped }. */
export function scanPath(root, file) {
  let buf;
  try {
    buf = fs.readFileSync(path.join(root, file));
  } catch (e) {
    return { b: null, s: `unreadable: ${e.code ?? e.message}` };
  }
  const b = blobId(buf);
  if (buf.length > MAX_FILE_BYTES) return { b, s: "over 1 MB" };
  if (buf.subarray(0, 8000).includes(0)) return { b, s: "binary" };
  const text = buf.toString("utf8");
  const lang = langOf(file);
  if (text.length > 200_000 && text.split("\n").length < text.length / 1000) return { b, s: "minified" };
  return { b, l: lang, ...scanFile(text, lang) };
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// What this process holds per root: the files' signature, the tree map and checkout record it read, and the map.
const memo = new Map();

/**
 * The code map of `root`, brought up to date with the files as they are now. With build: false it
 * is null unless this checkout has a map already (an older tree's map is a base, and the files it
 * differs in are read again). Files left unread after `budgetMs` are `stale`; their old entries, if
 * any, stay in. `waitMs`: how long to wait for another process building the same map from nothing.
 */
export async function ensureMap(root, { build = true, budgetMs = Infinity, waitMs = 30_000 } = {}) {
  const t0 = Date.now();
  root = fs.realpathSync(root);
  const ckPath = checkoutFile(root);
  const held = memo.get(root);
  if (!build && !held && !fs.existsSync(ckPath)) return null;
  const gs = await gitState(root);
  const key = gs ? gs.tree : `dir-${sha1(root).slice(0, 16)}`;
  const ck = held?.ck ?? readGz(ckPath);
  const cur = gs ? await gitFiles(root, gs) : await dirFiles(root, ck?.stat);
  // Changed files are compared by content: git's blob id of what is on disk now.
  for (const [p, f] of cur) {
    if (f.blob) continue;
    try {
      f.blob = blobId(fs.readFileSync(path.join(root, p)));
    } catch {
      cur.delete(p);
    }
  }
  const sig = sha1(`${key}\n${[...cur].map(([p, f]) => `${p}:${f.blob}`).join("\n")}`);
  if (held && held.sig === sig) return { ...held.map, ms: Date.now() - t0, built: "reused", rescanned: 0 };

  let treeMap = held?.key === key ? held.treeMap : readGz(treeFile(key));
  let base = treeMap;
  let built = treeMap ? "reused" : "updated";
  let lockHeld = false;
  if (!treeMap) {
    const lock = lockFile(key);
    let other = null;
    try {
      other = JSON.parse(fs.readFileSync(lock, "utf8"));
    } catch {}
    if (other && other.pid !== process.pid && alive(other.pid) && Date.now() - other.at < 15 * 60_000) {
      // Another process (a session's warm-up) is building this map: wait for it, then use it.
      while (Date.now() - t0 < waitMs && fs.existsSync(lock)) await sleep(200);
      treeMap = base = readGz(treeFile(key));
      if (treeMap) built = "reused";
    }
    base ??= held?.treeMap ?? (ck?.key && readGz(treeFile(ck.key))) ?? (gs && latestOfFamily(gs.family)) ?? null;
    if (!base && !build) return null;
    if (!base && !ck) {
      built = "now";
      try {
        fs.mkdirSync(mapDir(), { recursive: true, mode: 0o700 });
        fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, at: Date.now(), root }), { flag: "wx", mode: 0o600 });
        lockHeld = true;
      } catch {}
    }
  } else if (!held || held.key !== key) {
    try {
      const now = new Date();
      fs.utimesSync(treeFile(key), now, now);
    } catch {}
  }
  try {
    const files = new Map();
    const stale = [];
    let rescanned = 0;
    const capped = cur.size > MAX_FILES ? cur.size - MAX_FILES : 0;
    const sources = [held?.map?.files, base?.files && new Map(Object.entries(base.files)), ck?.files && new Map(Object.entries(ck.files))].filter(Boolean);
    let n = 0;
    let yielded = Date.now();
    for (const [p, f] of cur) {
      if (++n > MAX_FILES) break;
      // Reading is synchronous: let timers and other requests in now and then.
      if (Date.now() - yielded > 50) {
        await new Promise((r) => setImmediate(r));
        yielded = Date.now();
      }
      const known = sources.map((m) => m.get(p)).find((e) => e && e.b === f.blob);
      if (known) {
        files.set(p, known);
        continue;
      }
      if (Date.now() - t0 > budgetMs) {
        stale.push(p);
        const was = sources.map((m) => m.get(p)).find(Boolean);
        if (was) files.set(p, was);
        continue;
      }
      files.set(p, scanPath(root, p));
      rescanned++;
    }
    const now = new Date().toISOString();
    const stat = gs ? undefined : Object.fromEntries([...cur].filter(([p]) => files.get(p)?.b).map(([p, f]) => [p, [...f.stat, files.get(p).b]]));
    const differs = treeMap ? [...files].filter(([p, e]) => treeMap.files[p]?.b !== e.b) : null;
    let ckNext = ck;
    const writeCk = (value) => {
      writeGz(ckPath, value);
      ckNext = value;
    };
    if (!stale.length && (!treeMap || differs.length > Math.max(200, files.size / 10))) {
      // A new tree, or a checkout far from its tree's map: the files as they are now become the tree's map.
      treeMap = { v: SCAN_VERSION, key, family: gs?.family ?? null, root, builtAt: now, ms: Date.now() - t0, files: Object.fromEntries(files) };
      writeGz(treeFile(key), treeMap);
      writeCk({ v: SCAN_VERSION, key, root, at: now, files: {}, stat });
      prune();
    } else {
      const overlay = Object.fromEntries(treeMap ? differs : [...files]);
      const same = ck && ck.key === (treeMap ? key : ck.key) && JSON.stringify(Object.keys(overlay).map((p) => [p, overlay[p].b])) === JSON.stringify(Object.keys(ck.files ?? {}).map((p) => [p, ck.files[p].b]));
      if (!same || !gs) writeCk({ v: SCAN_VERSION, key: treeMap ? key : base?.key ?? key, root, at: now, files: overlay, stat });
    }
    const skipped = {};
    for (const [p, e] of files) if (e.s) skipped[p] = e.s;
    const map = {
      root,
      key,
      tree: gs?.tree ?? null,
      builtAt: treeMap?.builtAt ?? base?.builtAt ?? now,
      built,
      // Files whose content differs from the tree's map (read again now or earlier by this checkout).
      changed: treeMap && treeMap.key === key ? [...files].filter(([p, e]) => treeMap.files[p]?.b !== e.b).length : rescanned,
      rescanned,
      stale,
      skipped,
      capped,
      files,
    };
    if (!stale.length) {
      memo.set(root, { sig, key, treeMap, ck: ckNext, map });
      if (memo.size > 4) memo.delete(memo.keys().next().value);
    }
    return { ...map, ms: Date.now() - t0 };
  } finally {
    if (lockHeld) fs.rmSync(lockFile(key), { force: true });
  }
}

// The most recently used map of the same repository (another worktree, an earlier commit): a base to update.
function latestOfFamily(family) {
  let best = null;
  try {
    for (const f of fs.readdirSync(mapDir())) {
      if (!f.endsWith(".json.gz") || f.startsWith("checkout-")) continue;
      const full = path.join(mapDir(), f);
      const t = fs.statSync(full).mtimeMs;
      if (best && best.t >= t) continue;
      const m = readGz(full);
      if (m?.family === family) best = { t, m };
    }
  } catch {}
  return best?.m ?? null;
}

function prune() {
  try {
    const maps = fs
      .readdirSync(mapDir())
      .filter((f) => f.endsWith(".json.gz"))
      .map((f) => ({ f, t: fs.statSync(path.join(mapDir(), f)).mtimeMs }));
    const trees = maps.filter((x) => !x.f.startsWith("checkout-")).sort((a, b) => b.t - a.t);
    for (const x of trees.slice(KEEP_MAPS)) fs.rmSync(path.join(mapDir(), x.f), { force: true });
    for (const x of maps.filter((x) => x.f.startsWith("checkout-") && Date.now() - x.t > 60 * 86_400_000)) fs.rmSync(path.join(mapDir(), x.f), { force: true });
  } catch {}
}

/** Whether the map can answer for this name: an identifier of 2 or more characters that is not a reserved word. */
export const mapped = (name) => /^[A-Za-z_]\w+$/.test(String(name)) && !STOP.has(name);

// ---- reading a map ----

// Indexes by name, kept with the files they were built from (a result is a copy of the map).
const INDEX = new WeakMap();
function indexOf(map) {
  if (INDEX.has(map.files)) return INDEX.get(map.files);
  const names = new Map();
  const defs = new Map();
  const rels = new Map();
  const add = (m, k, v) => {
    const a = m.get(k);
    if (a) a.push(v);
    else m.set(k, [v]);
  };
  // One string per name across files: JSON gives every file its own copy.
  const canon = new Map();
  for (const [file, e] of map.files) {
    if (!e.xn) continue;
    for (let i = 0; i < e.xn.length; i++) {
      const n = canon.get(e.xn[i]);
      if (n === undefined) canon.set(e.xn[i], e.xn[i]);
      else e.xn[i] = n;
      add(names, e.xn[i], file);
    }
    for (const d of e.d) add(defs, d[0], { name: d[0], file, line: d[1], end: d[2], kind: DEF_KINDS[d[3]], container: d[4] || null });
    for (const r of e.r) add(rels, r[2], { kind: REL_KINDS[r[0]], from: r[1], to: r[2], file, line: r[3] });
  }
  INDEX.set(map.files, { names, defs, rels });
  return INDEX.get(map.files);
}
const under = (file, p) => !p || p === "." || file === p || file.startsWith(`${String(p).replace(/\/+$/, "")}/`);
const rowsOf = (e, name) => decodeUses(e, name);

/** The names the map holds that match a glob (`*Worker`, `retry_*`), defined names first. */
export function namesLike(map, glob, max = 40) {
  const re = new RegExp(`^${String(glob).split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("\\w*")}$`);
  const { defs, names } = indexOf(map);
  const out = [...defs.keys()].filter((n) => re.test(n)).sort();
  if (out.length < max) for (const n of [...names.keys()].filter((n) => re.test(n) && !defs.has(n)).sort()) out.push(n);
  return out.slice(0, max);
}

/** A name's definitions: {name, file, line, end, kind, container}. */
export const defsOf = (map, name, { path: p } = {}) => (indexOf(map).defs.get(name) ?? []).filter((d) => under(d.file, p));

/** Every implementation or extension of a name: {kind, from, to, file, line}. */
export const relsTo = (map, name, { path: p } = {}) => (indexOf(map).rels.get(name) ?? []).filter((r) => under(r.file, p));

// The kind a line shows when a name is used on it more than one way.
const RANK = [3, 1, 0, 2, 4, 5, 6];
/** Every line a name is on, one row per line with its strongest kind: {file, line, kind}. In file order. */
export function usesOf(map, name, { path: p } = {}) {
  const out = [];
  for (const file of indexOf(map).names.get(name) ?? []) {
    if (!under(file, p)) continue;
    const row = rowsOf(map.files.get(file), name);
    if (!row) continue;
    let last = -1, best = 7;
    const flush = () => last > 0 && out.push({ file, line: last, kind: KINDS[best] });
    for (let i = 0; i < row.length; i++) {
      const line = row[i] >> 3, kind = row[i] & 7;
      if (line !== last) {
        flush();
        last = line;
        best = kind;
      } else if (RANK[kind] < RANK[best]) best = kind;
    }
    flush();
  }
  return out;
}

/** The innermost definition holding a line; with callable, the innermost function or method, else the innermost of any kind. */
export function enclosing(map, file, line) {
  const e = map.files.get(file);
  if (!e?.d) return null;
  let best = null, any = null;
  for (const d of e.d) {
    if (d[1] > line) break;
    if (d[2] < line) continue;
    const kind = DEF_KINDS[d[3]];
    const v = { name: d[0], file, line: d[1], end: d[2], kind, container: d[4] || null };
    if (!any || d[1] >= any.line) any = v;
    if (CALLABLE.has(kind) && (!best || d[1] >= best.line)) best = v;
  }
  return best ?? any;
}

/** The definitions that start inside a file's lines from..to. */
export function defsIn(map, file, from = 1, to = Infinity) {
  const e = map.files.get(file);
  return (e?.d ?? []).filter((d) => d[1] >= from && d[1] <= to).map((d) => ({ name: d[0], file, line: d[1], end: d[2], kind: DEF_KINDS[d[3]], container: d[4] || null }));
}

/** The names called inside a file's lines from..to, leaving out each definition's own line: {name, line}. */
export function callsIn(map, file, from = 1, to = Infinity) {
  const e = map.files.get(file);
  const own = new Set((e?.d ?? []).map((d) => `${d[0]}:${d[1]}`));
  const out = [];
  for (const name of e?.xn ?? [])
    for (const c of decodeUses(e, name)) {
      const line = c >> 3;
      if ((c & 7) === 1 && line >= from && line <= to && !own.has(`${name}:${line}`)) out.push({ name, line });
    }
  return out.sort((a, b) => a.line - b.line);
}

/** Go's interfaces are met by method sets: the types that define every method an interface lists. */
export function methodSetImplementations(map, iface) {
  const out = [];
  for (const d of defsOf(map, iface).filter((d) => d.kind === "interface" && langOf(d.file) === "go")) {
    const wanted = defsIn(map, d.file, d.line, d.end).filter((m) => m.kind === "method" && m.container === iface).map((m) => m.name);
    if (!wanted.length) continue;
    const byType = new Map();
    for (const name of wanted)
      for (const m of defsOf(map, name)) if (m.kind === "method" && m.container && m.container !== iface && langOf(m.file) === "go") (byType.get(m.container) ?? byType.set(m.container, new Map()).get(m.container)).set(name, m);
    for (const [type, got] of byType) if (got.size === wanted.length) out.push({ kind: "implements", from: type, to: iface, file: got.get(wanted[0]).file, line: got.get(wanted[0]).line, by: "method set" });
  }
  return out;
}

/** Files the map does not answer for: skipped (too large, binary) and stale (not read again yet). */
export const unmappedFiles = (map) => [...new Set([...Object.keys(map.skipped ?? {}), ...(map.stale ?? [])])];

/** One line on how far the map can be trusted, for the top of a result. */
export function statusLine(map) {
  const langs = {};
  for (const e of map.files.values()) if (e.l) langs[e.l] = (langs[e.l] ?? 0) + 1;
  const top = Object.entries(langs).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([l, n]) => `${l} ${n}`).join(", ");
  const when = map.built === "now" ? `built now in ${(map.ms / 1000).toFixed(1)} s` : `built ${String(map.builtAt).slice(0, 16).replace("T", " ")} UTC`;
  const parts = [`Code map: ${map.tree ? `tree ${map.tree.slice(0, 10)}` : "folder outside git"}, ${map.files.size} files (${top || "none"}), ${when}`];
  if (map.changed) parts.push(`${map.changed} file(s) changed since then, read again`);
  const out = [parts.join("; ") + "."];
  if (map.stale.length) out.push(`STALE: ${map.stale.length} changed file(s) not read again yet (${map.stale.slice(0, 5).join(", ")}${map.stale.length > 5 ? ", ..." : ""}); their rows may be out of date, and they were searched with ripgrep.`);
  const skipped = Object.entries(map.skipped ?? {});
  if (skipped.length) out.push(`PARTIAL: ${skipped.length} file(s) not mapped (${skipped.slice(0, 5).map(([p, why]) => `${p}: ${why}`).join(", ")}${skipped.length > 5 ? ", ..." : ""}); they were searched with ripgrep.`);
  if (map.capped) out.push(`PARTIAL: ${map.capped} file(s) past the first ${MAX_FILES} not mapped; narrow with path or search them with repo.rg.`);
  return out.join("\n");
}

/**
 * Lines holding any of `names` in the files the map does not cover: other kinds of file (docs,
 * config) and the map's stale or skipped files. One ripgrep search; name -> [{file, line, text}].
 */
export async function textHits(repo, map, names, { path: p, max = 400 } = {}) {
  const out = new Map(names.map((n) => [n, []]));
  if (!names.length) return out;
  const alt = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const exts = [...new Set([...map.files.keys()].map((f) => path.extname(f).toLowerCase()).filter(Boolean))];
  const globs = [...NOISE, ...exts.flatMap((e) => [`!*${e}`, `!*${e.toUpperCase()}`])];
  const extra = unmappedFiles(map).filter((f) => under(f, p));
  let hits;
  if (extra.length > 40) {
    // Many files not mapped (a map still being built): one search of everything, less what the map answers for.
    const fresh = new Set([...map.files.keys()].filter((f) => !map.files.get(f).s));
    for (const f of map.stale ?? []) fresh.delete(f);
    hits = [...(await repo.rg(`\\b(${alt})\\b`, { glob: NOISE, path: p, max: 20_000 }))].filter((h) => !fresh.has(h.file));
  } else {
    hits = [...(await repo.rg(`\\b(${alt})\\b`, { glob: globs, path: p, max: 5000 }))];
    // Stale and skipped files have mapped extensions, so they are searched by name.
    const got = await Promise.all(extra.map((f) => repo.rg(`\\b(${alt})\\b`, { path: f, max: 500 }).catch(() => [])));
    hits.push(...got.flat());
  }
  const res = names.map((n) => [n, new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`)]);
  for (const h of hits) {
    if (h.context) continue;
    for (const [n, re] of res) if (re.test(h.text) && out.get(n).length < max) out.get(n).push(h);
  }
  return out;
}
