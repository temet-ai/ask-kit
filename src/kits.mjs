// Kits: a folder with an `ask-kit.toml` manifest that points at sources (a folder, a CLI, a JS
// module) and says what it answers. The host turns the manifest into the same domain object the
// server, ask loop and router already use, so a kit needs no domain.mjs and, for a folder or a CLI,
// no code at all. docs/design/kits.md is the design; this is its first step (folder, cli, module).
//
// Where kits live: ~/.config/ask-kit/kits/<name>/ (yours, installed or linked) and kits/<name>/ in
// this package (built in). A kit's folder name is its name.
import { execFileSync } from "node:child_process";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parse as parseToml } from "smol-toml";
import { CONFIG_DIR, ROOT, STATE_ROOT, expand, slug } from "./config.mjs";
import { makeRepo } from "../domains/code/repo.mjs";
import { which } from "./platform.mjs";

export const MANIFEST = "ask-kit.toml";
const NAME = /^[a-z][a-z0-9-]*$/;
const SOURCE_KINDS = ["folder", "cli", "module", "mcp"];

export const kitDirs = () => [path.join(CONFIG_DIR, "kits"), path.join(ROOT, "kits")];

export function listKits() {
  const out = [];
  for (const base of kitDirs()) {
    try {
      for (const d of fs.readdirSync(base)) if (NAME.test(d) && fs.existsSync(path.join(base, d, MANIFEST)) && !out.includes(d)) out.push(d);
    } catch {}
  }
  return out;
}

export function findKit(name) {
  for (const base of kitDirs()) {
    const dir = path.join(base, name);
    if (fs.existsSync(path.join(dir, MANIFEST))) return dir;
  }
  return null;
}

/** Parse and check a manifest. Throws with every problem found, so an author fixes them in one go. */
export function readManifest(dir) {
  const file = path.join(dir, MANIFEST);
  let m;
  try {
    m = parseToml(fs.readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`${file}: ${e.message}`);
  }
  const problems = [];
  if (!NAME.test(m.name ?? "")) problems.push("name: lowercase letters, digits and dashes, starting with a letter");
  if (!m.says) problems.push("says: one line saying what the kit answers (the router reads it)");
  const sources = m.sources ?? [];
  if (!sources.length) problems.push("[[sources]]: at least one");
  for (const [i, s] of sources.entries()) {
    if (!SOURCE_KINDS.includes(s.kind)) problems.push(`sources[${i}].kind: one of ${SOURCE_KINDS.join(", ")} (got ${s.kind})`);
    if (!/^[A-Za-z_$][\w$]*$/.test(s.name ?? "")) problems.push(`sources[${i}].name: a JavaScript identifier, the global the investigator calls`);
    if (s.kind === "folder" && !s.path) problems.push(`sources[${i}].path: the folder`);
    if (s.kind === "cli" && !(Array.isArray(s.command) ? s.command.length : s.command)) problems.push(`sources[${i}].command: the program, e.g. ["gh"]`);
    if (s.kind === "module" && !s.module) problems.push(`sources[${i}].module: a .mjs file in the kit exporting make(ctx)`);
    if (s.kind === "mcp" && !(Array.isArray(s.command) ? s.command.length : s.command)) problems.push(`sources[${i}].command: the MCP server to start, e.g. ["mike-mcp"]`);
  }
  if (problems.length) throw new Error(`${file}:\n- ${problems.join("\n- ")}`);
  return m;
}

// ---- settings: values a kit needs (a repository, a URL, a folder) ----
//
// [[settings]] key, default, detect (a command run in the caller's directory whose stdout is the
// value), secret (never shown to the model). Resolved: the environment, then config.domains.<kit>.settings,
// then detect, then default. The investigator's server starts in another directory, so resolved
// values travel to it in its environment.
function resolveSettings(m, config, cwd = process.cwd()) {
  const out = {};
  const own = config?.domains?.[m.name]?.settings ?? {};
  for (const s of m.settings ?? []) {
    let v = process.env[s.key] ?? own[s.key];
    if (v == null && s.detect) {
      try {
        const [bin, ...args] = [].concat(s.detect);
        v = execFileSync(bin, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 15_000 }).trim() || undefined;
      } catch {}
    }
    v ??= s.default;
    if (v != null) out[s.key] = expand(String(v));
  }
  return out;
}

const fill = (s, settings) => String(s).replace(/\$\{([A-Z0-9_]+)\}/g, (_, k) => settings[k] ?? process.env[k] ?? "");

// ---- sources ----

// A CLI as a function: gh("pr", "list") -> {code, out, err}. No shell; never throws on a non-zero exit.
function makeCli(src, settings, push) {
  const [bin, ...prefix] = [].concat(src.command).map((x) => fill(x, settings));
  const refuse = [].concat(src.refuse ?? []).map((r) => (typeof r === "string" ? { args: r, why: "the kit refuses it" } : r));
  const timeoutMs = (src.timeout_seconds ?? 120) * 1000;
  const env = { ...process.env, PAGER: "cat", GH_PAGER: "", NO_COLOR: "1", SYSTEMD_PAGER: "", ...Object.fromEntries(Object.entries(src.env ?? {}).map(([k, v]) => [k, fill(v, settings)])) };
  const call = (...args) => {
    const a = [...prefix, ...args.map(String)];
    const line = a.join(" ");
    for (const r of refuse) if (line.includes(r.args)) return Promise.reject(new Error(`not allowed: ${src.name} ${r.args}: ${r.why}`));
    const started = Date.now();
    return new Promise((resolve) => {
      execFile(bin, a, { cwd: src.cwd ? fill(src.cwd, settings) : process.cwd(), env, timeout: timeoutMs, maxBuffer: 64 << 20, encoding: "utf8" }, (err, stdout, stderr) => {
        const r = err?.code === "ENOENT"
          ? { code: 127, out: "", err: `${bin} is not installed or not on PATH` }
          : { code: err ? (typeof err.code === "number" ? err.code : 1) : 0, out: stdout ?? "", err: stderr ?? "", ...(err?.killed ? { timedOut: true } : {}) };
        push({ kind: src.name, detail: `${bin} ${line}`.slice(0, 200), ms: Date.now() - started, code: r.code, size: r.out.length });
        resolve(r);
      });
    });
  };
  const fn = (...args) => call(...args);
  // stdout parsed as JSON; throws with the program's error when it failed.
  fn.json = async (...args) => {
    const r = await call(...args);
    if (r.code !== 0) throw new Error(`${bin} ${args.slice(0, 4).join(" ")}: ${(r.err || r.out).trim().slice(0, 600)}`);
    const t = r.out.trim();
    if (!t) return null;
    try {
      return JSON.parse(t);
    } catch {
      return t.split("\n").filter(Boolean).map((l) => JSON.parse(l)); // JSON lines (docker --format json)
    }
  };
  // stdout as text; throws on a non-zero exit.
  fn.text = async (...args) => {
    const r = await call(...args);
    if (r.code !== 0) throw new Error(`${bin} ${args.slice(0, 4).join(" ")}: ${(r.err || r.out).trim().slice(0, 600)}`);
    return r.out;
  };
  fn.help = async (...sub) => (await call(...sub, "--help")).out || (await call("help", ...sub)).out;
  return fn;
}

// A folder source's `exclude` globs (rg style: "*token*", "gcloud/**") are left out of every
// search and listing, and reading or writing a file they match is refused: a folder such as
// ~/.config holds credentials, and what the investigator reads goes to a model.
function excluding(repo, exclude, kitName) {
  const globs = [].concat(exclude ?? []);
  if (!globs.length) return repo;
  const neg = globs.map((g) => `!${g}`);
  const hidden = (file) => {
    const rel = path.relative(repo.root, path.resolve(repo.root, file)).split(path.sep).join("/");
    const parts = rel.split("/");
    return globs.some((g) => {
      const bare = g.replace(/\/\*\*$/, "");
      return path.matchesGlob(rel, g) || (!bare.includes("/") && parts.some((p) => path.matchesGlob(p, bare))) || (bare.includes("/") && (rel === bare || rel.startsWith(`${bare}/`)));
    });
  };
  const guard = (file) => {
    if (hidden(file)) throw new Error(`not allowed: ${file} is excluded by the ${kitName} kit (it may hold credentials)`);
  };
  return {
    ...repo,
    rg: (p, o = {}) => repo.rg(p, { ...o, glob: [...[].concat(o.glob ?? []), ...neg] }),
    sg: (p, o = {}) => repo.sg(p, { ...o, glob: [...[].concat(o.glob ?? []), ...neg] }),
    files: async (glob, o = {}) => {
      const list = await repo.files(glob, o);
      const kept = list.filter((f) => !hidden(f));
      return Object.assign(kept, { total: kept.length + (list.total - list.length), complete: list.complete });
    },
    read: (file, o) => (guard(file), repo.read(file, o)),
    write: (file, text) => (guard(file), repo.write(file, text)),
    edit: (file, from, to, o) => (guard(file), repo.edit(file, from, to, o)),
    run: async (cmd, ...args) => {
      for (const a of args) if (!String(a).startsWith("-")) guard(String(a));
      return repo.run(cmd, ...args);
    },
    excluded: globs,
  };
}

// ---- mcp: an MCP server's tools as functions: mike.get_fleet({ fleet }) ----
//
// The tool list is read once and cached (a day, or until the manifest changes), so routing and the
// API need no server; the server starts on the first call and stays for the REPL's life. Tools the
// manifest's `allow` leaves out are not reachable. `caller_args` names, per tool, the argument that
// says who acts (a sender, an author): it is set to the calling session's id, so an action the
// investigator takes is the caller's. `caller_env` passes that id to the server's environment.
async function mcpTools(src, settings, outDir, manifestFile) {
  const cache = path.join(outDir, `mcp-${src.name}.json`);
  try {
    const c = JSON.parse(fs.readFileSync(cache, "utf8"));
    if (Date.now() - c.at < 86400_000 && c.manifest === fs.statSync(manifestFile).mtimeMs) return c.tools;
  } catch {}
  const client = await mcpConnect(src, settings, null);
  try {
    const tools = (await client.listTools()).tools.map((t) => ({ name: t.name, description: t.description ?? "", inputSchema: t.inputSchema ?? {} }));
    fs.writeFileSync(cache, JSON.stringify({ at: Date.now(), manifest: fs.statSync(manifestFile).mtimeMs, tools }));
    return tools;
  } finally {
    await client.close().catch(() => {});
  }
}

async function mcpConnect(src, settings, caller) {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
  const [bin, ...args] = [].concat(src.command).map((x) => fill(x, settings));
  const env = { ...process.env, ...Object.fromEntries(Object.entries(src.env ?? {}).map(([k, v]) => [k, fill(v, settings)])) };
  if (src.caller_env) {
    delete env[src.caller_env];
    if (caller) env[src.caller_env] = caller;
  }
  const c = new Client({ name: "ask-kit", version: "0" });
  await c.connect(new StdioClientTransport({ command: bin, args, env, stderr: "ignore" }));
  return c;
}

const UUIDISH = /^[A-Za-z0-9._:-]{8,120}$/;

function makeMcpGlobal(src, tools, settings, push) {
  const allowed = src.allow ? tools.filter((t) => src.allow.includes(t.name)) : tools;
  const callerArgs = src.caller_args ?? {};
  const caller = process.env.ASK_KIT_CALLER && UUIDISH.test(process.env.ASK_KIT_CALLER) ? process.env.ASK_KIT_CALLER : null;
  let client = null;
  const connect = () => (client ??= mcpConnect(src, settings, caller));
  const parse = (t) => {
    try {
      return JSON.parse(t);
    } catch {
      return t;
    }
  };
  const call = async (name, args = {}) => {
    const tool = allowed.find((t) => t.name === name);
    if (!tool) throw new Error(`${src.name} has no tool "${name}" this kit may use; ${src.name}.tools() lists them`);
    const field = callerArgs[name];
    if (field) {
      if (!caller) throw new Error(`${name} acts as the calling session, and this ask has no calling session id; nothing was done`);
      args = { ...args, [field]: caller };
    }
    const started = Date.now();
    const out = await (await connect()).callTool({ name, arguments: args });
    const text = (out.content ?? []).map((c) => c.text ?? "").join("\n");
    push({ kind: src.name, detail: `${name} ${JSON.stringify(args)}`.slice(0, 200), ms: Date.now() - started, code: out.isError ? 1 : 0, size: text.length });
    if (out.isError) throw new Error(`${name}: ${text.slice(0, 600)}`);
    return parse(text);
  };
  const g = { call, tools: () => allowed.map((t) => ({ name: t.name, description: t.description.split("\n")[0].slice(0, 200) })), caller };
  for (const t of allowed) if (/^[A-Za-z_$][\w$]*$/.test(t.name)) g[t.name] = (args) => call(t.name, args);
  return g;
}

const tsType = (s) => {
  if (!s || typeof s !== "object") return "any";
  if (s.enum) return s.enum.map((v) => JSON.stringify(v)).join(" | ");
  const t = [].concat(s.type ?? []);
  if (t.includes("array")) return `${tsType(s.items)}[]`;
  if (t.includes("object")) return "Record<string, any>";
  if (t.includes("integer") || t.includes("number")) return "number";
  if (t.includes("string")) return "string";
  if (t.includes("boolean")) return "boolean";
  return "any";
};

function mcpApi(src, tools) {
  const allowed = src.allow ? tools.filter((t) => src.allow.includes(t.name)) : tools;
  const callerArgs = src.caller_args ?? {};
  const lines = [
    `// ${src.name}: the MCP server \`${[].concat(src.command).join(" ")}\`${src.about ? ` (${src.about})` : ""}. Each tool is a function taking one`,
    `// object of arguments and returning its parsed result; it throws on a tool error. ${src.name}.call(name, args) does the same.`,
    `declare const ${src.name}: {`,
    `  caller: string | null; // the calling session's id: tools that act are done in its name`,
    `  tools(): { name: string; description: string }[];`,
    `  call(name: string, args?: Record<string, any>): Promise<any>;`,
  ];
  for (const t of allowed) {
    const props = t.inputSchema?.properties ?? {};
    const req = new Set(t.inputSchema?.required ?? []);
    const params = Object.entries(props)
      .filter(([k]) => k !== callerArgs[t.name])
      .map(([k, s]) => `${k}${req.has(k) ? "" : "?"}: ${tsType(s)}`)
      .join("; ");
    lines.push(`  // ${t.description.replace(/\s+/g, " ").slice(0, 400)}${callerArgs[t.name] ? ` (${callerArgs[t.name]} is set to the caller)` : ""}`);
    for (const [k, s] of Object.entries(props)) if (s.description && k !== callerArgs[t.name]) lines.push(`  //   ${k}: ${s.description.replace(/\s+/g, " ").slice(0, 160)}`);
    lines.push(`  ${t.name}(args${params ? "" : "?"}: { ${params} }): Promise<any>;`);
  }
  lines.push("};");
  return lines.join("\n");
}

async function makeSources(m, dir, settings, mcp = {}) {
  const modules = {};
  for (const s of m.sources) if (s.kind === "module") modules[s.name] = await import(pathToFileURL(path.join(dir, s.module)).href);
  return ({ push, config }) => {
    const g = {};
    for (const s of m.sources) {
      if (s.kind === "folder") g[s.name] = excluding(makeRepo({ root: expand(fill(s.path, settings)), push }), s.exclude, m.name);
      else if (s.kind === "cli") g[s.name] = makeCli(s, settings, push);
      else if (s.kind === "mcp") g[s.name] = makeMcpGlobal(s, mcp[s.name], settings, push);
      else g[s.name] = modules[s.name].make({ push, config, settings, kitDir: dir, cwd: process.cwd(), options: s });
    }
    // A `secret = true` setting (a database URL, a token) reaches the sources above and the
    // investigator's server through its environment; once the sources hold it, it leaves this
    // process's environment, so code the model writes cannot read it there.
    for (const s of m.settings ?? []) if (s.secret) delete process.env[s.key];
    // Built-in folder scripts reach the first folder source as `folder`.
    const firstFolder = m.sources.find((s) => s.kind === "folder");
    if (firstFolder && !("folder" in g)) g.folder = g[firstFolder.name];
    return g;
  };
}

// ---- what the investigator reads: api.d.ts and instructions, generated when the kit has none ----

const TOOLKIT = fs.readFileSync(path.join(ROOT, "kits", "_host", "toolkit.d.ts"), "utf8");
const FOLDER_API = fs.readFileSync(path.join(ROOT, "kits", "_host", "folder.d.ts"), "utf8");

function cliHelp(src, settings) {
  const [bin, ...prefix] = [].concat(src.command).map((x) => fill(x, settings));
  try {
    const r = execFileSync(bin, [...prefix, "--help"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 10_000 });
    return r.slice(0, 6000);
  } catch (e) {
    return String(e.stdout || e.stderr || `${bin} --help failed`).slice(0, 6000);
  }
}

function writeApi(m, dir, settings, outDir, mcp = {}) {
  const parts = [`// The REPL's globals for the ${m.name} kit. \`help\` returns this file.\n`];
  for (const s of m.sources) {
    if (s.kind === "folder") {
      parts.push(`// ${s.name}: the folder ${expand(fill(s.path, settings))}${s.about ? ` (${s.about})` : ""}. Paths are relative to it.`);
      parts.push(FOLDER_API.replace(/__NAME__/g, s.name));
    } else if (s.kind === "cli") {
      const cmd = [].concat(s.command).join(" ");
      parts.push(
        `// ${s.name}: the \`${cmd}\` command${s.about ? ` (${s.about})` : ""}. No shell: pass each argument separately.\n` +
          `// ${s.name}(...args) never throws on a non-zero exit; .json and .text throw with the program's error.\n` +
          (s.refuse ? `// Refused: ${[].concat(s.refuse).map((r) => (typeof r === "string" ? r : `${r.args} (${r.why})`)).join("; ")}.\n` : "") +
          `declare const ${s.name}: {\n  (...args: string[]): Promise<{ code: number; out: string; err: string; timedOut?: true }>;\n` +
          `  json(...args: string[]): Promise<any>; // stdout parsed as JSON (or JSON lines, as an array)\n` +
          `  text(...args: string[]): Promise<string>;\n  help(...sub: string[]): Promise<string>; // \`--help\` of a subcommand\n};\n` +
          `/* \`${cmd} --help\`:\n${cliHelp(s, settings).replace(/\*\//g, "* /")}\n*/`,
      );
    } else if (s.kind === "mcp") {
      parts.push(mcpApi(s, mcp[s.name]));
    } else {
      const api = s.api ? path.join(dir, s.api) : null;
      parts.push(api && fs.existsSync(api) ? fs.readFileSync(api, "utf8") : `declare const ${s.name}: any; // ${s.about ?? s.module}`);
    }
  }
  if (m.sources.some((s) => s.kind === "folder") && !m.sources.some((s) => s.name === "folder")) parts.push(`declare const folder: typeof ${m.sources.find((s) => s.kind === "folder").name}; // the same object, for the built-in folder scripts`);
  parts.push(TOOLKIT);
  const file = path.join(outDir, "api.d.ts");
  fs.writeFileSync(file, parts.join("\n"));
  return file;
}

function writeInstructions(m, outDir) {
  const kinds = new Set(m.sources.map((s) => s.kind));
  const lines = [
    `You are an investigator for ${m.says}. Another coding-agent session sends you one question or`,
    "request about it. You answer it through your REPL; when asked to change something, do it and",
    "say what you changed.",
    "",
    "How to work:",
    "",
    "- Start from a ready-made script (`scripts.run`) when one fits.",
    kinds.has("folder") && "- In a folder, search for two or three distinctive words, not a sentence, then read the lines that decide the answer before you state it: a hit is a lead, not proof.",
    kinds.has("folder") && "- When the question names a file, folder or program, look in the one with exactly that name first; similar names (`app` and `app-cli`) are different things. When two fit, say which you read.",
    kinds.has("cli") && "- Ask a command for JSON where it offers it (`--json`, `--format json`, `-o json`) and keep only the fields you need. When unsure of a subcommand, `.help(sub)` shows it.",
    "- Keep results in variables and return only what answers the question from each cell, a few hundred characters.",
    "- When a cell fails, read the error and change the cell. Never send the same cell twice.",
    "- If the sources do not answer the question, say what you looked at and what is missing. Never guess a name, a value or a result.",
    "- A question in several parts gets every part answered.",
    "",
    "The answer:",
    "",
    `- Short and direct: the answer first, then a few lines of support.`,
    `- Every fact names its evidence${m.cite ? ` as ${m.cite}` : kinds.has("folder") ? " as `path:line`" : ": the command and the line of its output, or an id"}.`,
    "- No preamble, no restating the question, no offer of further help.",
  ].filter(Boolean);
  const file = path.join(outDir, "instructions.md");
  fs.writeFileSync(file, lines.join("\n") + "\n");
  return file;
}

async function scriptExamples(dirs) {
  const out = [];
  for (const d of dirs) {
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d).filter((f) => f.endsWith(".mjs")).sort()) {
      try {
        const { meta } = await import(pathToFileURL(path.join(d, f)).href);
        if (meta?.example) out.push(`- ${String(meta.purpose ?? "").split(/[.:]/)[0]}: \`${meta.example}\``);
      } catch {}
    }
  }
  return out;
}

/**
 * Whether a kit can run on this machine: every program in `requires` is on PATH, every setting
 * marked `required` has a value, and every folder source exists. Returns null when it can, else why not.
 * The router offers only kits that can run, so a machine lists what it can answer.
 */
export function unavailable(m, settings) {
  const missing = [].concat(m.requires ?? []).filter((p) => !which(p));
  if (missing.length) return `needs ${missing.join(", ")} on PATH`;
  const unset = (m.settings ?? []).filter((s) => s.required && !settings[s.key]).map((s) => s.key);
  if (unset.length) return `needs ${unset.join(", ")} (environment, or domains.${m.name}.settings in ask-kit's config)`;
  for (const s of m.sources) if (s.kind === "folder" && !fs.existsSync(expand(fill(s.path, settings)))) return `its folder ${fill(s.path, settings)} does not exist`;
  return null;
}

/** The kit at `dir` as a domain object (the contract in src/domains.mjs). */
export async function kitDomain(dir, { config } = {}) {
  const m = readManifest(dir);
  // ${KIT_DIR} in a manifest is the kit's own folder (data a [[build]] step downloaded, say).
  const settings = { ...Object.fromEntries(Object.entries(resolveSettings(m, config)).map(([k, v]) => [k, v.replace(/\$\{KIT_DIR\}/g, dir)])), KIT_DIR: dir };
  const outDir = path.join(STATE_ROOT, "kits", m.name, slug(fill(m.state_key ?? "", settings) || "default"));
  fs.mkdirSync(outDir, { recursive: true, mode: 0o700 });
  // A kit that cannot run here is described, not built: no MCP server is started, no folder read.
  const why = unavailable(m, settings);
  if (why) return { name: m.name, kit: true, manifest: m, dir, says: m.says, unavailable: why, keywords: [], patterns: [] };
  const mcp = {};
  for (const s of m.sources) if (s.kind === "mcp") mcp[s.name] = await mcpTools(s, settings, outDir, path.join(dir, MANIFEST));
  const make = await makeSources(m, dir, settings, mcp);
  const own = path.join(dir, m.scripts ?? "scripts");
  const hostScripts = m.sources.some((s) => s.kind === "folder") && m.folder_scripts !== false ? [path.join(ROOT, "kits", "_host", "folder-scripts")] : [];
  const scriptsDirs = [...hostScripts, own];
  const apiDoc = writeApi(m, dir, settings, outDir, mcp);
  const instructions = m.instructions ? path.join(dir, m.instructions) : writeInstructions(m, outDir);
  const examples = await scriptExamples(scriptsDirs);
  const cite = m.cite ?? (m.sources.some((s) => s.kind === "folder") ? "`path:line`" : "the command and its output line, or an id");
  return {
    name: m.name,
    kit: true,
    unavailable: null,
    manifest: m,
    dir,
    says: m.says,
    keywords: m.keywords ?? [],
    routeHint: m.route_hint ?? null,
    patterns: (m.patterns ?? []).map((p) => new RegExp(p, "i")),
    acts: m.acts ?? [],
    bench: m.bench ? path.join(dir, m.bench) : fs.existsSync(path.join(dir, "bench", "questions.json")) ? path.join(dir, "bench", "questions.json") : null,
    stateKey: m.state_key ? fill(m.state_key, settings) : undefined,
    childEnv: () => settings,
    scriptsDir: own,
    scriptsDirs,
    apiDoc,
    instructions,
    makeGlobals: make,
    prime:
      `Get ready to answer questions about ${m.says}. Call the \`help\` tool, then run one repl cell: ` +
      "`scripts.list().length`. Then reply with the single word: ready",
    answerRules: `\n\nAnswer first, short; cite every fact as ${cite}, and say what you looked for and did not find. When you changed something, say what.`,
    openWith: examples.length ? `Open with a script when one fits:\n${examples.join("\n")}\nReturn only what you need from each cell.\n\n` : "Return only what you need from each cell.\n\n",
    askDescription:
      m.ask_description ??
      `Ask about ${m.says}, in plain words, and get a short answer with its evidence. A cheap model does the digging outside your context` +
      (m.acts?.length ? `, and acts when you ask (${m.acts.join(", ")}).` : "."),
    serverInstructions: `\`ask\` answers questions about ${m.says}. Call it before a run of lookups whose purpose is to answer a question.`,
    replInstructions: `A JavaScript REPL for ${m.says} (${m.sources.map((s) => `\`${s.name}\``).join(", ")}), with ready-made scripts. Variables persist. Call \`help\` once.`,
    fingerprintFiles: () => [path.join(dir, MANIFEST), ...m.sources.filter((s) => s.kind === "module").flatMap((s) => [path.join(dir, s.module), ...(s.api ? [path.join(dir, s.api)] : [])])],
    defaultBackend: m.backend,
  };
}

/** A new kit folder from a source: folder:<path> or cli:<command>. Writes only the manifest. */
export function newKit(name, from, { dir } = {}) {
  if (!NAME.test(name)) throw new Error(`"${name}": lowercase letters, digits and dashes, starting with a letter`);
  const [kind, ...rest] = String(from ?? "").split(":");
  const target = rest.join(":");
  if (!["folder", "cli"].includes(kind) || !target) throw new Error("--from folder:<path> or cli:<command>");
  const out = dir ?? path.join(CONFIG_DIR, "kits", name);
  if (fs.existsSync(path.join(out, MANIFEST))) throw new Error(`${out} already has ${MANIFEST}`);
  fs.mkdirSync(out, { recursive: true });
  const id = target.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase() || "src";
  const src =
    kind === "folder"
      ? `[[sources]]\nkind = "folder"\nname = "${/^[a-z_]\w*$/.test(name.replace(/-/g, "_")) ? name.replace(/-/g, "_") : "files"}"\npath = "${target}"\n`
      : `[[sources]]\nkind = "cli"\nname = "${id.split("_")[0]}"\ncommand = ${JSON.stringify(target.split(/\s+/))}\n`;
  fs.writeFileSync(
    path.join(out, MANIFEST),
    `name = "${name}"\nversion = "0.1.0"\nsays = "TODO: what this kit answers, in the words people use"\n\n${src}`,
  );
  return { dir: out, manifest: path.join(out, MANIFEST), next: `Write the says line, then: ask-kit kit test ${name}` };
}
