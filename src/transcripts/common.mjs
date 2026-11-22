// Shared by the transcript adapters: one normalised event shape, a cached index of session files,
// and a fast text pre-filter so a search parses only the files that can match.
//
// Every adapter turns its agent's own format into events:
//   { i, ts, role, text, tool?, toolId?, input?, ok?, model? }
//   role: "user" (what the person typed), "assistant" (the agent's text), "tool_call", "tool_result",
//         "system" (instructions and context the agent injected, not typed by the person)
// `i` is the event's position in the session, the citation an answer uses.
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { rgPath } from "../platform.mjs";
import { STATE_ROOT } from "../config.mjs";

export const clip = (s, n = 400) => (s == null ? "" : String(s).length > n ? String(s).slice(0, n) + "…" : String(s));

/** Text from whatever a tool result or message content holds: a string, blocks, or an object. */
export function textOf(x) {
  if (x == null) return "";
  if (typeof x === "string") return x;
  if (Array.isArray(x)) return x.map(textOf).filter(Boolean).join("\n");
  if (typeof x === "object") {
    if (typeof x.text === "string") return x.text;
    if (x.content != null) return textOf(x.content);
    if (typeof x.output === "string") return x.output;
    return JSON.stringify(x);
  }
  return String(x);
}

/** Files under `dir` whose name matches `re`, at most `depth` folders down. */
export function walk(dir, re, depth = 6, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (depth > 0) walk(full, re, depth - 1, out);
    } else if (re.test(e.name)) out.push(full);
  }
  return out;
}

export function readLines(file) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  return text.split("\n");
}

export function parseLines(file) {
  const rows = [];
  for (const line of readLines(file)) {
    if (!line) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {}
  }
  return rows;
}

/** The first `bytes` of a file, cut back to whole lines. */
export function head(file, bytes = 256 * 1024) {
  let fd;
  try {
    fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(bytes);
    const n = fs.readSync(fd, buf, 0, bytes, 0);
    const text = buf.subarray(0, n).toString("utf8");
    return n === bytes ? text.slice(0, text.lastIndexOf("\n") + 1) : text;
  } catch {
    return "";
  } finally {
    if (fd != null) fs.closeSync(fd);
  }
}

/**
 * Session metadata for a list of files, read once per file version and kept in
 * STATE_ROOT/index/<source>.json. `readMeta(file)` reads one file's metadata.
 */
export function indexed(source, files, readMeta) {
  const dir = path.join(STATE_ROOT, "index");
  const file = path.join(dir, `${source}.json`);
  let cache = {};
  try {
    cache = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {}
  const next = {};
  let changed = false;
  const out = [];
  for (const f of files) {
    let st;
    try {
      st = fs.statSync(f);
    } catch {
      continue;
    }
    const hit = cache[f];
    let meta;
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) meta = hit.meta;
    else {
      changed = true;
      try {
        meta = readMeta(f);
      } catch {
        meta = null;
      }
    }
    next[f] = { mtimeMs: st.mtimeMs, size: st.size, meta };
    if (meta) out.push({ source, file: f, size: st.size, updatedAt: new Date(st.mtimeMs).toISOString(), ...meta });
  }
  if (changed || Object.keys(cache).length !== Object.keys(next).length) {
    try {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      fs.writeFileSync(`${file}.tmp-${process.pid}`, JSON.stringify(next));
      fs.renameSync(`${file}.tmp-${process.pid}`, file);
    } catch {}
  }
  return out;
}

/**
 * The needles with the one least likely to be common first. A cheap rule: the longest wins. Long
 * words ("prefilter", "ankh-morpork") appear in fewer files than short ones ("the", "fix", "test"),
 * and a word with a digit, dot, dash, slash or underscore (an id, a flag, a file name) is rarer
 * than a plain word of the same length, so it counts as two characters longer. Ties keep the
 * caller's order. No corpus statistics: deciding how to read the files must not read them.
 */
export function rarestFirst(needles) {
  const weight = (w) => w.length + (/[\d._\-/]/.test(w) ? 2 : 0);
  return [...needles].sort((a, b) => weight(b) - weight(a));
}

/**
 * A literal that every match of `re` must contain, or null: the longest plain run of characters in
 * the pattern outside groups, classes and alternations, at least 3 long. A character before `*`,
 * `?` or `{` may be absent, so it is dropped from its run. Lower-cased, because the pre-filter is
 * case-insensitive whatever the flags say.
 */
export function literalOf(re) {
  const src = re.source;
  const runs = [];
  let run = "";
  const end = () => {
    if (run) runs.push(run);
    run = "";
  };
  const skipClass = (i) => {
    // i is on "[": return the index of its closing "]".
    i++;
    if (src[i] === "^") i++;
    if (src[i] === "]") i++;
    while (i < src.length && src[i] !== "]") i += src[i] === "\\" ? 2 : 1;
    return i;
  };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "\\") {
      const n = src[i + 1];
      i++;
      // An escaped punctuation mark is itself; \d \w \b \n \u... are not literals.
      if (n && /[^A-Za-z0-9]/.test(n)) run += n;
      else end();
    } else if (c === "[") {
      end();
      i = skipClass(i);
    } else if (c === "(") {
      // The group may be optional or repeated: skip it whole.
      end();
      let depth = 1;
      i++;
      while (i < src.length && depth) {
        if (src[i] === "\\") i++;
        else if (src[i] === "[") i = skipClass(i);
        else if (src[i] === "(") depth++;
        else if (src[i] === ")") depth--;
        i++;
      }
      i--;
    } else if (c === "*" || c === "?" || c === "{") {
      run = run.slice(0, -1);
      end();
      if (c === "{") while (i < src.length && src[i] !== "}") i++;
    } else if (c === "|") return null; // top-level alternation: no single literal is required
    else if (c === "+" || /[.^$)]/.test(c)) end();
    else run += c;
  }
  end();
  const best = runs.sort((a, b) => b.length - a.length)[0];
  return best && best.length >= 3 ? best.toLowerCase() : null;
}

/**
 * Does one raw line of the file hold every word of `needles` (case-insensitive)? An event is one
 * line in every JSONL store, so a file without such a line cannot match. Cheap: no JSON parsing.
 */
export function fileMayMatch(file, needles) {
  if (!needles.length) return true;
  needles = rarestFirst(needles);
  let text;
  try {
    text = fs.readFileSync(file, "utf8").toLowerCase();
  } catch {
    return false;
  }
  // JSON escapes quotes, backslashes and newlines inside strings; look for the escaped form.
  const forms = needles.map((n) => JSON.stringify(n).slice(1, -1));
  const first = forms[0];
  let at = text.indexOf(first);
  while (at !== -1) {
    const start = text.lastIndexOf("\n", at) + 1;
    let end = text.indexOf("\n", at);
    if (end === -1) end = text.length;
    const line = text.slice(start, end);
    if (forms.every((f) => line.includes(f))) return true;
    at = text.indexOf(first, end);
  }
  return false;
}

/**
 * `fileMayMatch` over many files at once: the subset of `files` that may hold a matching line.
 * One ripgrep (`-l -i -F`) lists the files holding the rarest word (`rarestFirst`; the Set gets
 * `.needle` and `.listed`, the word and how many files ripgrep named, for tests and the journal); with more words each listed
 * file is then checked by `fileMayMatch`, so the result equals the JS prefilter's. File paths go
 * as arguments in batches under the Windows command-line limit, never through a shell. Without
 * ripgrep (or with ASK_KIT_NO_RG=1, or if a batch fails) the JS prefilter runs on those files.
 */
export async function filesMayMatch(files, needles) {
  if (!needles.length) return new Set(files);
  const rg = process.env.ASK_KIT_NO_RG ? null : rgPath();
  const out = new Set();
  const viaJs = (list) => {
    for (const f of list) if (fileMayMatch(f, needles)) out.add(f);
  };
  if (!rg) {
    viaJs(files);
    return out;
  }
  // The same escaped form fileMayMatch looks for.
  needles = rarestFirst(needles);
  const forms = needles.map((n) => JSON.stringify(n).slice(1, -1));
  out.needle = needles[0];
  out.listed = 0;
  const batchesOf = (list) => {
    const batches = [];
    let cur = [];
    let len = 0;
    for (const f of list) {
      if (cur.length && len + f.length + 3 > 24_000) {
        batches.push(cur);
        cur = [];
        len = 0;
      }
      cur.push(f);
      len += f.length + 3;
    }
    if (cur.length) batches.push(cur);
    return batches;
  };
  // The files of `batch` holding `form`, or null when ripgrep failed on it.
  const holding = (form, batch) =>
    new Promise((resolve) => {
      execFile(rg, ["-l", "-i", "-F", "-a", "--no-config", "--no-messages", "--null", "-e", form, "--", ...batch], { maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, stdout) => {
        // exit 1 is "no file matched"; anything else is a failure for this batch.
        if (err && err.code !== 1) return resolve(null);
        const known = new Set(batch);
        resolve(String(stdout).split("\0").filter((f) => f && known.has(f)));
      });
    });
  // Ripgrep narrows by one word after another, rarest first, so the line check below (which reads
  // each file whole) runs only on files that hold every word somewhere.
  let left = [];
  for (const batch of batchesOf(files)) {
    const listed = await holding(forms[0], batch);
    if (listed === null) viaJs(batch);
    else {
      out.listed += listed.length;
      left.push(...listed);
    }
  }
  for (const form of forms.slice(1)) {
    const next = [];
    for (const batch of batchesOf(left)) next.push(...((await holding(form, batch)) ?? batch));
    left = next;
  }
  if (needles.length === 1) {
    for (const f of left) out.add(f);
    return out;
  }
  // Every word on one line, in any order: one ripgrep regex over the three rarest words (six
  // orders). With more words this keeps a few files too many, which the event check then drops.
  const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const orders = (list) => (list.length < 2 ? [list] : list.flatMap((w, i) => orders([...list.slice(0, i), ...list.slice(i + 1)]).map((rest) => [w, ...rest])));
  const sameLine = orders(forms.slice(0, 3).map(esc)).map((o) => o.join(".*")).join("|");
  for (const batch of batchesOf(left)) {
    const listed = await new Promise((resolve) => {
      execFile(rg, ["-l", "-i", "-a", "--no-config", "--no-messages", "--null", "-e", sameLine, "--", ...batch], { maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, stdout) => {
        if (err && err.code !== 1) return resolve(null);
        const known = new Set(batch);
        resolve(String(stdout).split("\0").filter((f) => f && known.has(f)));
      });
    });
    if (listed === null) viaJs(batch);
    else for (const f of listed) out.add(f);
  }
  return out;
}

/** A user-visible title from a first prompt. */
export const titleOf = (s) => clip(String(s ?? "").replace(/\s+/g, " ").trim(), 120);
