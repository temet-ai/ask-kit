#!/usr/bin/env node
// One domain's MCP server, with two faces:
//   outer (default)        the calling agent sees one tool, `ask`
//   inner (ASK_KIT_INNER)  the investigator `ask` starts sees the REPL: `repl`, `help`, `reset`, `load`
//
// The REPL is a node:vm context holding the domain's globals, a toolkit and a library of scripts
// (reloaded when a file changes; sessions can save drafts). After every cell its variables are
// snapshotted, so a follow-up, a restart or a fork starts from what was found. Every cell is
// journaled: code, time, result size, scripts run and calls made.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import v8 from "node:v8";
import vm from "node:vm";
import { pathToFileURL } from "node:url";
import { rewriteCell } from "./core/rewrite.mjs";
import { toolkit } from "./core/toolkit.mjs";
import { loadDomain } from "./domains.mjs";
import { makeAskKit } from "./kitcall.mjs";
import { ROOT, STATE_ROOT, callerSession, loadConfig, slug } from "./config.mjs";

const CONFIG = loadConfig();
const DOMAIN_NAME = process.env.ASK_KIT_DOMAIN || "sessions";
const DOMAIN = await loadDomain(DOMAIN_NAME);
const STATE_DIR = path.join(STATE_ROOT, DOMAIN_NAME, ...(DOMAIN.stateKey ? [slug(DOMAIN.stateKey)] : []));
// A kit's scripts can come from more than one folder (the host's for its source kind, then its own; later wins).
const SCRIPTS_DIRS = DOMAIN.scriptsDirs ?? [DOMAIN.scriptsDir];
const SESSION = callerSession();
const DRAFTS_DIR = path.join(STATE_DIR, "drafts", slug(SESSION));
const INNER = process.env.ASK_KIT_INNER === "1";
// The session this investigator acts for; null for the shared warm session and for callers' own servers.
const CALLER = /^[A-Za-z0-9._:-]{1,120}$/.test(process.env.ASK_KIT_CALLER ?? "") ? process.env.ASK_KIT_CALLER : null;
// A session whose saved variables this one starts from when it has none of its own (a fork of a warm session).
const INHERIT = process.env.ASK_KIT_INHERIT?.trim() || null;
const SNAPSHOT_MAX_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_CHARS = 4_000;

fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
const journalPath = (id) => path.join(STATE_DIR, `${slug(id)}.jsonl`);
const snapshotPath = (id) => path.join(STATE_DIR, `${slug(id)}.snapshot`);

let cellCalls = [];
let cellScripts = [];
const GLOBALS = DOMAIN.makeGlobals({ push: (c) => cellCalls.push(c), config: CONFIG });

// ask.kit(name, question, { continue }): another kit's investigator answers; depth 1, journaled as a call.
const askKit = makeAskKit({ config: CONFIG, from: DOMAIN_NAME, session: CALLER ?? SESSION, push: (c) => cellCalls.push(c) });
for (const sig of ["exit"]) process.on(sig, () => void askKit.close());

// ---- script library ----

const registry = new Map(); // name -> { meta, fn, file, draft }
let librarySignature = "";

function dirStamp(dir) {
  if (!dir || !fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".mjs"))
    .sort()
    .map((f) => ({ f, full: path.join(dir, f), mtime: fs.statSync(path.join(dir, f)).mtimeMs }));
}

async function refreshScripts() {
  const lib = SCRIPTS_DIRS.flatMap(dirStamp);
  const drafts = dirStamp(DRAFTS_DIR);
  const signature = [...lib, ...drafts].map((x) => `${x.full}:${x.mtime}`).join("|");
  if (signature === librarySignature) return null;
  registry.clear();
  const loaded = [];
  const errors = [];
  for (const [list, draft] of [[lib, false], [drafts, true]]) {
    for (const x of list) {
      try {
        const mod = await import(`${pathToFileURL(x.full).href}?v=${x.mtime}`);
        if (typeof mod.default !== "function") throw new Error("no default export function");
        registry.set(path.basename(x.full, ".mjs"), { meta: mod.meta ?? {}, fn: mod.default, file: x.full, draft });
        loaded.push(x.f);
      } catch (e) {
        errors.push(`${x.f}: ${e.message}`);
      }
    }
  }
  librarySignature = signature;
  return { loaded, errors };
}

// A script run's params in the cell record, cut at 300 characters: `report` shows the values a
// question template was asked with, for writing an [[actions]] entry.
const paramsOf = (params) => {
  if (!params || typeof params !== "object" || !Object.keys(params).length) return {};
  try {
    const s = JSON.stringify(params);
    return { params: s.length > 300 ? `${s.slice(0, 299)}…` : params };
  } catch {
    return {};
  }
};

const scripts = {
  list: () =>
    [...registry.entries()].map(([name, s]) => ({ name, purpose: s.meta.purpose ?? "", params: s.meta.params ?? {}, returns: s.meta.returns ?? "", draft: s.draft })),
  show(name) {
    const s = registry.get(name);
    if (!s) throw new Error(`no script "${name}". scripts.list() names them.`);
    return fs.readFileSync(s.file, "utf8");
  },
  async run(name, params = {}) {
    const s = registry.get(name);
    if (!s) throw new Error(`no script "${name}". scripts.list() names them.`);
    const started = Date.now();
    try {
      const value = await s.fn({ ...GLOBALS, tk: toolkit }, params ?? {});
      cellScripts.push({ name, draft: s.draft, ok: true, ms: Date.now() - started, ...paramsOf(params) });
      return value;
    } catch (e) {
      cellScripts.push({ name, draft: s.draft, ok: false, ms: Date.now() - started, error: e.message, ...paramsOf(params) });
      throw e;
    }
  },
  draft(name, source) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error("draft name: lowercase letters, digits and dashes");
    fs.mkdirSync(DRAFTS_DIR, { recursive: true, mode: 0o700 });
    const file = path.join(DRAFTS_DIR, `${name}.mjs`);
    fs.writeFileSync(file, source, { mode: 0o600 });
    cellScripts.push({ name, draft: true, saved: true });
    return { name, file, note: "Saved. It loads before the next cell; run it with scripts.run(name) in a new cell." };
  },
};

// ---- the REPL context ----

let context;
let baseline;
let logs = [];
const fmt = (args) => args.map((a) => (typeof a === "string" ? a : safeJson(a, 2000))).join(" ");

function newContext() {
  logs = [];
  const sink = (level) => (...args) => logs.push(level === "log" ? fmt(args) : `[${level}] ${fmt(args)}`);
  context = vm.createContext({
    ...GLOBALS,
    scripts,
    ask: { kit: askKit },
    tk: toolkit,
    ...toolkit,
    console: { log: sink("log"), info: sink("info"), warn: sink("warn"), error: sink("error") },
  });
  baseline = new Set(Object.getOwnPropertyNames(vm.runInContext("globalThis", context)));
}

const userNames = () => Object.getOwnPropertyNames(vm.runInContext("globalThis", context)).filter((n) => !baseline.has(n));

// ---- results ----

function replacer() {
  const seen = new WeakSet();
  return (_k, v) => {
    if (typeof v === "bigint") return `${v}n`;
    if (typeof v === "function") return `[Function ${v.name || "anonymous"}]`;
    if (v === undefined) return null;
    const tag = Object.prototype.toString.call(v);
    if (tag === "[object Map]") return { "[Map]": [...v.entries()] };
    if (tag === "[object Set]") return { "[Set]": [...v.values()] };
    if (v && typeof v === "object") {
      if (seen.has(v)) return "[Circular]";
      seen.add(v);
    }
    return v;
  };
}

function safeJson(value, max) {
  if (typeof value === "string") return value.length > max ? value.slice(0, max) + `\n… [clipped: ${max} of ${value.length} chars]` : value;
  let text;
  try {
    text = value === undefined ? "undefined" : JSON.stringify(value, replacer(), 1);
  } catch (e) {
    text = `[unserializable: ${e.message}]`;
  }
  if (text === undefined) text = String(value);
  if (text.length > max) {
    let outline = "";
    try {
      outline = JSON.stringify(toolkit.shape(value, 3));
    } catch {}
    return (
      text.slice(0, max) +
      `\n… [clipped: ${max} of ${text.length} chars. Shape of the whole value: ${outline.slice(0, 600)}. ` +
      "Keep it in a variable and return only the fields you need.]"
    );
  }
  return text;
}

// ---- snapshot and restore ----

const describeValue = (v) => (typeof v === "function" ? "function" : Array.isArray(v) ? `array(${v.length})` : v === null ? "null" : typeof v);

function snapshot() {
  const g = vm.runInContext("globalThis", context);
  const data = {};
  const fns = {};
  const dropped = [];
  let bytes = 0;
  for (const name of userNames()) {
    const v = g[name];
    if (typeof v === "function") {
      fns[name] = v.toString();
      continue;
    }
    try {
      const buf = v8.serialize(v);
      if (bytes + buf.length > SNAPSHOT_MAX_BYTES) {
        dropped.push(`${name} (snapshot over ${SNAPSHOT_MAX_BYTES >> 20} MB)`);
        continue;
      }
      bytes += buf.length;
      data[name] = buf;
    } catch (e) {
      dropped.push(`${name} (${e.message.split("\n")[0]})`);
    }
  }
  // The snapshot belongs to the session `ask` acted for; only that caller's REPLs may restore it.
  const record = v8.serialize({ session: SESSION, caller: CALLER, savedAt: new Date().toISOString(), data, fns });
  const tmp = snapshotPath(SESSION) + `.tmp-${process.pid}`;
  fs.writeFileSync(tmp, record, { mode: 0o600 });
  fs.renameSync(tmp, snapshotPath(SESSION));
  return { vars: Object.keys(data).length, fns: Object.keys(fns).length, bytes, dropped };
}

// A REPL restores a snapshot only when it is its own, or when it was made for the same caller.
// `neutral` also admits a snapshot made for no caller: the shared warm session, and nothing else.
function mayRestore(id, record, { neutral = false } = {}) {
  const owner = record.caller ?? null;
  if (owner !== null) return owner === CALLER;
  return id === SESSION || neutral;
}

function restoreFrom(id, opts = {}) {
  const file = snapshotPath(id);
  if (!fs.existsSync(file)) return null;
  const record = v8.deserialize(fs.readFileSync(file));
  if (!mayRestore(id, record, opts)) return { from: id, refused: "that REPL belongs to another session's ask", restored: [], failed: [] };
  const g = vm.runInContext("globalThis", context);
  const restored = [];
  const failed = [];
  for (const [name, buf] of Object.entries(record.data ?? {})) {
    try {
      g[name] = v8.deserialize(buf);
      restored.push(name);
    } catch (e) {
      failed.push(`${name} (${e.message})`);
    }
  }
  for (const [name, src] of Object.entries(record.fns ?? {})) {
    try {
      vm.runInContext(`globalThis[${JSON.stringify(name)}] = (${src});`, context);
      restored.push(`${name}()`);
    } catch (e) {
      failed.push(`${name}() (${e.message.split("\n")[0]})`);
    }
  }
  return { from: id, savedAt: record.savedAt, restored, failed };
}

// ---- cells ----

let queue = Promise.resolve();
let startupNote = null;
let restoreInfo = null;
let lastFailedCode = null;
// Cells seen in this REPL, keyed by their code with the names they declare blanked out, so the
// same search sent again under a new variable name (g6, g7, ...) is caught.
const seenCells = new Map();

function cellKey(code, declared) {
  let k = code;
  for (const name of declared) k = k.replace(new RegExp(`\\b${name.replace(/[$]/g, "\\$")}\\b`, "g"), "_");
  return k.replace(/\s+/g, " ").trim();
}

const journal = (entry) => fs.appendFileSync(journalPath(SESSION), JSON.stringify(entry) + "\n", { mode: 0o600 });

async function runCell(code, maxChars, timeoutSeconds) {
  const libChange = await refreshScripts();
  cellCalls = [];
  cellScripts = [];
  logs = [];
  DOMAIN.beforeCell?.(GLOBALS);
  const started = Date.now();
  let ok = true;
  let value;
  let errorText = null;
  let declared = [];
  try {
    const rewritten = rewriteCell(code);
    declared = rewritten.declared;
    // vm's timeout covers the synchronous part only (up to the first await). A loop that never yields
    // would block this process, so the race below could never fire; vm stops it and the context stays usable.
    let promise;
    try {
      promise = vm.runInContext(rewritten.script, context, { filename: "cell.js", timeout: timeoutSeconds * 1000 });
    } catch (e) {
      if (e?.code === "ERR_SCRIPT_EXECUTION_TIMEOUT") throw new Error(`cell timed out after ${timeoutSeconds}s of synchronous work (a loop that never ends, or one that never yields). The REPL is still usable; fix the loop, or do the work in smaller steps.`);
      throw e;
    }
    let timer;
    value = await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`cell timed out after ${timeoutSeconds}s`)), timeoutSeconds * 1000);
      }),
    ]).finally(() => clearTimeout(timer));
  } catch (e) {
    ok = false;
    errorText = (e && e.stack ? String(e.stack) : String(e)).split("\n").slice(0, 8).join("\n");
    // A model that guessed a result's shape gets "reading 'map' of undefined" and tends to resend
    // the same cell. Show what the values it set actually look like, and say when it is a repeat.
    const g = vm.runInContext("globalThis", context);
    const shapes = declared.filter((n) => g[n] !== undefined && typeof g[n] !== "function").map((n) => `  ${n}: ${safeJson(toolkit.shape(g[n], 2), 400)}`);
    if (shapes.length) errorText += `\nWhat this cell's values look like:\n${shapes.join("\n")}`;
    if (code.trim() === lastFailedCode) errorText += "\nThis is the same cell as the last one, which failed the same way. Change it.";
  }
  lastFailedCode = ok ? null : code.trim();
  const ms = Date.now() - started;
  let snap;
  try {
    snap = snapshot();
  } catch (e) {
    snap = { error: e.message };
  }

  const parts = [];
  if (startupNote) {
    parts.push(startupNote);
    startupNote = null;
  }
  if (libChange?.errors.length) parts.push(`[scripts that failed to load: ${libChange.errors.join("; ")}]`);
  if (logs.length) parts.push(`console:\n${logs.join("\n").slice(0, 4000)}`);
  const resultText = ok ? safeJson(value, maxChars) : `Error: ${errorText}`;
  parts.push(resultText);
  const key = cellKey(code, declared);
  const seen = seenCells.get(key);
  let repeat;
  if (seen) {
    seen.n++;
    repeat = seen.n;
    parts.push(
      seen.result === resultText
        ? `[This cell is one you already ran (${seen.n} times now, apart from variable names) and it returned the same result. ` +
            "Running it again finds nothing new: search for something different, read what you found, or answer with what you have.]"
        : `[You ran this cell before, apart from variable names (${seen.n} times now). Use the earlier variables rather than running it again.]`,
    );
    seen.result = resultText;
  } else seenCells.set(key, { n: 1, result: resultText });
  if (snap?.dropped?.length) parts.push(`[not kept across restarts: ${snap.dropped.join(", ")}]`);
  parts.push(`[${ms} ms, ${cellCalls.length} call${cellCalls.length === 1 ? "" : "s"}]`);

  journal({
    ts: new Date().toISOString(),
    session: SESSION,
    ok,
    ms,
    code,
    declared,
    resultChars: resultText.length,
    repeat,
    error: errorText,
    scripts: cellScripts,
    calls: cellCalls,
    snapshot: snap,
    restored: restoreInfo,
  });
  restoreInfo = null;
  return { text: parts.join("\n\n"), isError: !ok };
}

function helpText() {
  const g = vm.runInContext("globalThis", context);
  const list = scripts
    .list()
    .map((s) => {
      const params = Object.entries(s.params).map(([k, v]) => `${k}: ${v}`).join("; ");
      const ex = registry.get(s.name)?.meta.example;
      return `- ${s.name}${s.draft ? " (draft)" : ""}: ${s.purpose}\n    params: ${params || "none"}\n    returns: ${s.returns}${ex ? `\n    e.g. ${ex}` : ""}`;
    })
    .join("\n");
  return {
    library: [
      "Scripts (scripts.run(name, params); scripts.show(name) for the source; scripts.draft(name, source) saves a variant for this session):",
      list,
      "",
      "Other kits: `await ask.kit(name, question, { continue })` asks another enabled kit's investigator and returns its answer text (with its footer). " +
        "One level only: a kit started this way cannot call ask.kit. An unknown or unavailable name lists the kits that can run. Each call is journaled with the target kit.",
      "",
      "Typed API:",
      fs.readFileSync(DOMAIN.apiDoc, "utf8"),
    ].join("\n"),
    variables: "Variables: " + (userNames().map((n) => `${n}: ${describeValue(g[n])}`).join(", ") || "none"),
  };
}

// ---- MCP surface ----

const server = new McpServer(
  { name: `ask-${DOMAIN.name}`, version: "0.1.0" },
  { instructions: INNER ? DOMAIN.replInstructions : DOMAIN.serverInstructions },
);

// A calling agent gets `ask` and nothing else. The investigator gets the REPL tools and no `ask`.
const replTool = INNER ? server.registerTool.bind(server) : () => {};

replTool(
  "repl",
  {
    description:
      "Run JavaScript in this session's persistent REPL. Top-level await works. Top-level const/let/var/function/class become session globals that later cells see. " +
      "The last expression's value is returned (strings as-is, other values as JSON), clipped to maxChars with the whole value's shape. " +
      "Globals: `scripts` (run/list/show/draft ready-made investigations), the domain's own globals, and toolkit helpers (shape, pick, table, top, groupBy, countBy, sumBy, since). " +
      "Every character returned stays in the conversation, so return the answer, not the data: keep data in variables. Call `help` for the scripts and the typed API.",
    inputSchema: {
      code: z.string().describe("JavaScript to run"),
      maxChars: z.number().int().min(200).max(100_000).optional().describe(`Clip the result at this many characters (default ${DEFAULT_MAX_CHARS})`),
      timeoutSeconds: z.number().int().min(1).max(600).optional().describe("Default 120"),
    },
  },
  async ({ code, maxChars, timeoutSeconds }) => {
    const run = queue.then(() => runCell(code, maxChars ?? DEFAULT_MAX_CHARS, timeoutSeconds ?? 120));
    queue = run.catch(() => {});
    const { text, isError } = await run;
    return { content: [{ type: "text", text }], isError };
  },
);

replTool("help", { description: "The ready-made scripts with their parameters and results, the typed API of every REPL global, and this session's variables." }, async () => {
  await refreshScripts();
  const h = helpText();
  return { content: [{ type: "text", text: [h.library, "", h.variables].join("\n") }] };
});

replTool("reset", { description: "Clear this session's REPL variables and its snapshot. Drafts and the journal are kept." }, async () => {
  newContext();
  fs.rmSync(snapshotPath(SESSION), { force: true });
  return { content: [{ type: "text", text: "REPL cleared." }] };
});

replTool(
  "load",
  { description: "Copy the saved REPL variables of an earlier investigation for the same asking session into this one.", inputSchema: { sessionId: z.string() } },
  async ({ sessionId }) => {
    const r = restoreFrom(sessionId);
    if (!r) return { content: [{ type: "text", text: `No saved REPL for session ${sessionId}.` }], isError: true };
    if (r.refused) return { content: [{ type: "text", text: `Not loaded: ${r.refused}.` }], isError: true };
    snapshot();
    return { content: [{ type: "text", text: JSON.stringify(r, null, 1) }] };
  },
);

// ---- start ----

if (!INNER) {
  const { registerAsk } = await import("./ask.mjs");
  registerAsk(server, {
    z,
    config: CONFIG,
    domainName: DOMAIN_NAME,
    domain: DOMAIN,
    STATE_DIR,
    SESSION,
    helpText: async () => {
      await refreshScripts();
      return helpText().library;
    },
    fingerprintFiles: () => [
      path.join(ROOT, "src", "server.mjs"),
      path.join(ROOT, "src", "core", "toolkit.mjs"),
      DOMAIN.apiDoc,
      DOMAIN.instructions,
      ...(DOMAIN.fingerprintFiles?.() ?? []),
      ...SCRIPTS_DIRS.flatMap(dirStamp).map((x) => x.full),
    ],
    keep: (entry) => journal({ ts: new Date().toISOString(), session: SESSION, type: "ask", ...entry, answer: undefined, answerChars: entry.answer?.length }),
  });
}

newContext();
await refreshScripts();
try {
  let r = restoreFrom(SESSION);
  if (!r && INHERIT) r = restoreFrom(INHERIT, { neutral: true });
  if (r?.refused) startupNote = `[did not restore ${r.from}: ${r.refused}]`;
  else if (r) {
    restoreInfo = { from: r.from, savedAt: r.savedAt, names: r.restored };
    startupNote = `[restored ${r.restored.length} name(s)${r.from !== SESSION ? ` from ${r.from}` : ""} saved ${r.savedAt}: ${r.restored.join(", ")}${r.failed.length ? `; could not restore: ${r.failed.join(", ")}` : ""}]`;
  }
} catch (e) {
  startupNote = `[could not restore the saved REPL: ${e.message}]`;
}
await server.connect(new StdioServerTransport());
