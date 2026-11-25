// The plugin's PostToolUse hook: counts the lookups an agent makes in a row (each one inside a Bash
// call counts) and, at the third that an enabled domain or kit could have answered, adds one line
// naming it to the agent's context. It never blocks a call and never fails: a bad input or an
// unwritable state folder means no line and exit 0. No network, no model, no `detect` command.
import fs from "node:fs";
import path from "node:path";
import { HOME, STATE_ROOT, loadConfig } from "./config.mjs";
import { providersOf, winnersOf } from "./capabilities.mjs";
import { indexDomain } from "./domains.mjs";
import { findKit } from "./kits.mjs";
import { stateRoots } from "./machines.mjs";
import { FITS, GENERIC, PROGRAMS, classify, kitRules, lookupsOf, pathsOf, shapeOf, targetOf } from "./gaps.mjs";

export const NUDGE_AFTER = 3;
const dir = () => path.join(STATE_ROOT, "nudges");
const slug = (s) => String(s ?? "").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "none";

// ---- which enabled domain or kit answers a lookup ----

// What gaps calls a source, as the kits that answer about it.
const TARGETS = { ssh: ["ops", "systemd"], systemd: ["systemd", "ops"], "local http": ["net", "ops", "systemd"], web: ["web", "net"] };
// What a file is, from its name or place, as the kits that answer about it.
const FILES = [
  [/\/\.claude\/projects\/[^/]+\/memory\/|\/\.claude\/rules\/|\/(CLAUDE|CLAUDE\.local|AGENTS)\.md$/, ["rules"]],
  [/\/\.claude\/projects\/|\/\.codex\/sessions\/|\/\.gemini\/tmp\/|\/opencode\/storage\//, ["sessions"]],
  [/\/\.claude\/(settings(\.local)?\.json$|hooks(\/|$)|plugins(\/|$))|\/\.mcp\.json$|\/\.claude\.json$/, ["claude-setup"]],
  [/\/\.claude\/(skills|agents)(\/|$)/, ["skills"]],
  [/\.(sqlite3?|db3?)(-wal|-shm)?$/i, ["sqlite"]],
  [/\.log(\.\d+)?(\.gz)?$|\.log\.[\w-]+$|^\/var\/log(\/|$)/i, ["logs"]],
  [/\.(csv|tsv|parquet|xlsx|jsonl|ndjson)(\.gz)?$/i, ["data"]],
  [/\.(pdf|docx?|pptx?|odt)$/i, ["files"]],
  [/\/node_modules\/|\/\.cargo\/registry\/|\/site-packages\//, ["deps"]],
  [/\/Cargo\.(toml|lock)$|\/(clippy|rustfmt)\.toml$/, ["rust"]],
  [/\/(tests?|__tests__|specs?|test-results|coverage)\/|[._-](test|spec)\.\w+$|\/test_\w+\.py$|\/(jest|vitest|playwright)\.config\.\w+$|\/junit[\w.-]*\.xml$/, ["tests"]],
];
const SCRATCH = /\/tool-results\/|\/\.cache\/tmp\/|\/scratchpad\//;

/** What naming needs: the domains the router would offer, and where each program and folder goes. Null before setup. */
export async function destinations(config = loadConfig({ required: false })) {
  const on = {};
  for (const n of Object.entries(config?.domains ?? {}).filter(([, d]) => d.enabled !== false).map(([n]) => n)) {
    try {
      // The code domain runs git when loaded, and naming it needs nothing from its module.
      const d = n === "code" && !findKit(n) ? {} : await indexDomain(n, config);
      if (!d.unavailable) on[n] = d;
    } catch {}
  }
  for (const n of winnersOf(providersOf(Object.keys(on), (n) => on[n].provides, config)).hidden) delete on[n];
  if (!Object.keys(on).length) return null;
  const first = (names) => (names ?? []).find((n) => Object.hasOwn(on, n)) ?? null;
  const owners = {};
  for (const [n, d] of Object.entries(on)) for (const p of [].concat(d.manifest?.requires ?? [])) (owners[p] ??= []).push(n);
  // File types a manifest names in its keywords ("\\.clk\\b"), as extension -> the kits naming it.
  const types = {};
  for (const [n, d] of Object.entries(on)) for (const k of d.keywords ?? []) if (/^\\\.[\w?]+(\\b)?$/.test(k)) (types[n] ??= []).push(new RegExp(`(?:${k})$`, "i"));
  const byType = (p) => {
    const ext = path.extname(p);
    const fit = ext ? Object.keys(types).filter((n) => types[n].some((re) => re.test(ext))) : [];
    return fit.length === 1 ? fit[0] : null;
  };
  const rules = kitRules(config);
  const programs = {};
  for (const p of new Set([...Object.keys(rules.programs), ...Object.keys(PROGRAMS), ...Object.keys(FITS)])) {
    if (GENERIC.has(p) && !FITS[p]) continue;
    // A program whose kit is not enabled is "none": a lookup ask cannot answer.
    const cli = owners[p] ? null : rules.programs[p];
    programs[p] = first(FITS[p] ?? [PROGRAMS[p], p, cli]) ?? (owners[p]?.length === 1 && !GENERIC.has(p) ? owners[p][0] : "none");
  }
  if (programs.git !== "git") programs.git = "code"; // gaps reads this as "go by the paths"
  const folders = rules.folders.filter(([d, n]) => path.isAbsolute(d) && d.length > 1 && d !== HOME && on[n]);
  return { first, byType, rules: { ...rules, programs, folders } };
}

function repoOf(from) {
  for (let d = from; d && path.isAbsolute(d) && d !== HOME && d !== path.dirname(d); d = path.dirname(d)) if (fs.existsSync(path.join(d, ".git"))) return d;
  return null;
}
const within = (p, d) => p === d || p.startsWith(d + "/");

/** Where a path's question goes: a kit's folder, then what the file is, then code in a repository, else files. */
function aboutPath(p, to, repo) {
  const inRepo = repo && within(p, repo);
  if (!inRepo && SCRATCH.test(p)) return null;
  const folder = to.rules.folders.find(([d]) => within(p, d) && (!inRepo || d.length >= repo.length));
  // A path inside the repository is judged by its place there, not by where the checkout lies.
  const name = inRepo ? p.slice(repo.length) || "/" : p;
  const kind = FILES.find(([re]) => re.test(name))?.[1];
  if (folder && kind?.[0] !== "rules") return folder[1];
  const fit = to.first(kind) ?? to.byType(p);
  if (fit) return fit;
  if (inRepo) return to.first(["code"]);
  if (kind?.[0] === "sessions") return null; // transcripts, and nothing enabled reads them
  const t = targetOf({ tool: "Read", arg: p, fam: null, paths: [p] }, to.rules, repo);
  // Outside this repository: another repository's code, else a file on the machine (gaps has no source for /tmp).
  if (!t || t.startsWith("files:")) return to.first([repoOf(p) ? "code" : "files"]);
  return to.first(TARGETS[t] ?? [t]);
}

/** Relative data and log files whose long or numbered extensions pathsOf does not take. */
const dataFiles = (tool, text, at) =>
  tool !== "Bash" || !at ? [] : [...text.matchAll(/(?:^|[\s"'=])([\w.@-]+(?:\/[\w.@-]+)*\.(?:sqlite3?|db3|parquet|ndjson|log\.\d+|log(?:\.\d+)?\.gz))(?=$|[\s"';|&)])/g)].map((m) => path.join(at, m[1]));

const home = (p) => (p === "~" || p.startsWith("~/") ? path.join(HOME, p.slice(2)) : p);

/** Absolute and home paths of one part (~, ~/Downloads, /etc), which pathsOf does not take. Only the first command of a pipeline, without a search's pattern. */
const topPaths = (tool, text) =>
  tool !== "Bash"
    ? []
    : [...text.split("|")[0].replace(/^(rg|grep|egrep)((?:\s+-\S+)*)\s+("[^"]*"|'[^']*'|\S+)/, "$1$2").matchAll(/(?:^|[\s"'=])(~|(?:~)?\/[\w.@+-]+)\/?(?=$|[\s"';&)])/g)]
        .map((m) => home(m[1]))
        .concat(/^(ls|find|fd|du|tree)\b.*\s\/(\s|$)/.test(text.split("|")[0]) ? ["/"] : []);

/** Most frequent; a tie goes to the latest. */
const most = (xs) => {
  const n = {};
  for (const x of xs) n[x] = (n[x] ?? 0) + 1;
  return xs.findLast((x) => n[x] === Math.max(...Object.values(n))) ?? null;
};

/** The enabled domain or kit that answers one lookup ({arg, fam, dir?} of lookupsOf), or null. */
export function aboutFor(tool, l, to, cwd = null) {
  const at = !l.dir ? cwd : /^~(\/|$)/.test(l.dir) ? home(l.dir) : path.isAbsolute(l.dir) ? l.dir : cwd ? path.join(cwd, l.dir) : null;
  if (/^mcp__(mike|tether)__.*(inbox|heartbeat|wait_for)/.test(tool)) return null; // mail, not a question
  const repo = repoOf(at);
  const shape = shapeOf(tool, l.arg);
  // git grep, ls-files and a file at a commit are reading the code, not its history.
  if (l.fam === "git" && /^git (grep|ls-files|ls-tree|cat-file|show <ref>)/.test(shape)) return to.first(["code", "git"]);
  const t = targetOf({ tool, arg: l.arg, fam: null, paths: [] }, to.rules, repo);
  // A program run inside a container is also the docker kit's, when its own kit is not enabled.
  if (t) return to.first(TARGETS[t] ?? [t]) ?? (/^\s*(docker|podman)\s/.test(l.arg) ? to.first(["docker"]) : null);
  if (l.fam === "git") return to.first(["code"]);
  // The pattern of a search is not a path: quoted text goes, unless it is an absolute path.
  const text = tool === "Bash" ? l.arg.replace(/(["'])(?![~/][^\s"']*\1)(?:\\.|(?!\1).)*\1/gs, (q) => (/^(rg|grep|egrep|sed|awk)\b/.test(l.arg) ? "''" : q)) : l.arg;
  const paths = [...new Set([...pathsOf(tool, text, at), ...dataFiles(tool, text, at), ...topPaths(tool, text)])];
  if (paths.length) return most(paths.map((p) => aboutPath(p, to, repo)).filter(Boolean));
  if (l.fam === "machine") return to.first(["ops", "systemd"]);
  return repo ? to.first(["code"]) : at ? aboutPath(at, to, null) : to.first(["code"]);
}

/** The line: what the lookups were, and the call that replaces them. */
export function nudgeLine(about, kinds) {
  const n = Object.values(kinds).reduce((a, b) => a + b, 0);
  const what = Object.entries(kinds).map(([k, c]) => (c > 1 ? `${k} x${c}` : k)).join(", ");
  return `ask-kit: that is ${n} lookups in a row (${what}). One call answers the question behind them outside your context, with its evidence: ask({ about: "${about}", question: "<the whole question these lookups were for>" }). Add continue: true to follow up.`;
}

export const subagentRule = () =>
  "If you have the `ask` tool (ask-kit), call it before a run of searches whose purpose is to answer a question: about: \"code\" for this repository's code and history, about: \"sessions\" for what earlier agent sessions did or decided, or another name its `about` lists. It returns a short answer with its evidence; continue: true sends a follow-up to the same investigator. Read files yourself when you are about to edit them.";

/** The text a call is classified on: the command for Bash, where it looked for the rest. */
const argOf = (tool, i) =>
  String((/^(Grep|Glob|LS)$/.test(tool) ? (i?.path ?? (tool === "Glob" && /^[~/]/.test(i?.pattern ?? "") ? i.pattern.replace(/\/[^/]*[*?{[].*$/, "") : "")) : (i?.command ?? i?.file_path ?? i?.notebook_path ?? i?.path ?? i?.url ?? i?.query ?? i?.pattern)) ?? "");

const counts = (o) => Object.fromEntries(Object.entries(o && typeof o === "object" ? o : {}).filter(([, n]) => Number.isInteger(n) && n > 0));

/**
 * One PostToolUse input. Returns the line to add, or null. The counter is per session and per
 * agent, so a subagent's chain is its own. It holds the kinds of lookup and where each would go,
 * never a command or a path.
 */
export async function onToolUse(input, { now = new Date() } = {}) {
  const tool = input?.tool_name;
  if (!tool || !input.session_id) return null;
  const arg = argOf(tool, input.tool_input);
  const c = classify(tool, arg);
  const file = path.join(dir(), `${slug(input.session_id)}${input.agent_id ? `.${slug(input.agent_id)}` : ""}.json`);
  let s = { n: 0, nudged: false, to: {}, kinds: {} };
  try {
    const j = JSON.parse(fs.readFileSync(file, "utf8"));
    if (Number.isInteger(j.n) && j.n >= 0) s = { n: j.n, nudged: !!j.nudged, to: counts(j.to), kinds: counts(j.kinds) };
  } catch {}
  let about = null;
  let fam = null;
  if (c.k === "ask" || c.k === "write" || c.k === "act") s = { n: 0, nudged: false, to: {}, kinds: {} };
  else if (c.k === "look") {
    if (s.nudged) return null; // said once for this chain
    const looks = lookupsOf(tool, arg);
    const to = looks.length ? await destinations() : null;
    if (!to) return null;
    let last = null;
    for (const l of looks) {
      const a = aboutFor(tool, l, to, input.cwd ?? null);
      if (!a) continue; // a lookup ask cannot answer neither counts nor breaks the chain
      const kind = shapeOf(tool, l.arg);
      s.n += 1;
      s.to[a] = (s.to[a] ?? 0) + 1;
      s.kinds[kind] = (s.kinds[kind] ?? 0) + 1;
      last = a;
      fam = l.fam;
    }
    if (!last) return null;
    if (s.n >= NUDGE_AFTER) {
      s.nudged = true;
      // The whole chain chooses; a tie goes to the latest lookup's.
      const top = Math.max(...Object.values(s.to));
      const best = Object.keys(s.to).filter((a) => s.to[a] === top && to.first([a]));
      about = best.includes(last) ? last : (best.at(-1) ?? last);
    }
  } else return null;
  fs.mkdirSync(dir(), { recursive: true, mode: 0o700 });
  fs.writeFileSync(`${file}.${process.pid}.tmp`, JSON.stringify({ ...s, at: now.toISOString() }), { mode: 0o600 });
  fs.renameSync(`${file}.${process.pid}.tmp`, file);
  if (!about) return null;
  fs.appendFileSync(path.join(dir(), "nudges.jsonl"), JSON.stringify({ at: now.toISOString(), type: "nudge", session: input.session_id, agent: input.agent_type ?? null, about, fam, lookups: s.n }) + "\n", { mode: 0o600 });
  return nudgeLine(about, s.kinds);
}

/** Counters of sessions not touched for a week are removed. */
export function prune(now = Date.now()) {
  try {
    for (const f of fs.readdirSync(dir())) if (f.endsWith(".json") && now - fs.statSync(path.join(dir(), f)).mtimeMs > 7 * 86400_000) fs.rmSync(path.join(dir(), f), { force: true });
  } catch {}
}

/** Nudges logged since a time: {count, sessions, first, by}. */
export function nudgesSince(sinceMs) {
  const rows = stateRoots().flatMap((root) => {
    try {
      return fs.readFileSync(path.join(root, "nudges", "nudges.jsonl"), "utf8").split("\n").flatMap((l) => {
        try {
          const r = JSON.parse(l);
          return r?.type === "nudge" && Date.parse(r.at) >= sinceMs ? [r] : [];
        } catch {
          return [];
        }
      });
    } catch {
      return [];
    }
  }).sort((a, b) => a.at.localeCompare(b.at));
  const by = {};
  for (const r of rows) by[r.about] = (by[r.about] ?? 0) + 1;
  return { count: rows.length, sessions: new Set(rows.map((r) => r.session)).size, first: rows[0]?.at ?? null, by };
}

const readStdin = () => {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
};

/** `ask-kit plugin tool`: the hook. Always exits 0. */
export async function runToolHook(raw = readStdin()) {
  try {
    const line = await onToolUse(JSON.parse(raw));
    if (line) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: line } }) + "\n");
    else if (Math.random() < 0.02) prune();
  } catch {}
  process.exit(0);
}

/** `ask-kit plugin subagent`: SubagentStart adds the short rule to the subagent's context. */
export function runSubagentHook() {
  try {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "SubagentStart", additionalContext: subagentRule() } }) + "\n");
  } catch {}
  process.exit(0);
}
