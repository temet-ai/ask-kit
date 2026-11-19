// ask-kit gaps: where agents dig by hand instead of calling `ask`, and which kit would have
// answered. Reads this machine's transcripts through the adapters in src/transcripts/.
//
// A chain is a run of 3 or more consecutive lookup tool uses (reading files, git, gh, MCP reads,
// web, logs, service state) inside one user turn. It ends at a write, an action, an `ask` call, a
// subagent or the end of the turn. A to-answer chain is one with nothing edited after it in its
// turn. The rules (classify, shapeOf, pathsOf, areaOf, buildChains) are mike-ask's src/corpus.mjs,
// adapted to every agent's tool names. Each chain is put down to the kit whose sources it touched:
// a `requires` program, a folder source, an MCP server.
//
// Cost is the model calls that made a chain's lookups, in tokens (input, cache and output) where
// the transcript records usage, and the characters of the tool results divided by 4 where it does
// not. Results per session are cached in STATE_ROOT/index/gaps.json by file version.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ADAPTERS, listSessions } from "./transcripts/index.mjs";
import { HOME, STATE_ROOT, expand, loadConfig } from "./config.mjs";
import { findKit, listKits, readManifest } from "./kits.mjs";

// Part of the cache key: raise it when a rule changes what a cached session would hold.
const VERSION = 4;

// $ per million tokens: input, cache write, cache read, output. Claude list prices as mike-ask's
// corpus.mjs has them; other models get no price.
const PRICE = [
  [/fable-5-2|mythos-5-2/, 8, 16, 0.2, 40],
  [/fable|mythos/, 10, 20, 1.0, 50],
  [/opus-5-5/, 4, 8, 0.2, 20],
  [/opus/, 5, 10, 0.5, 25],
  [/sonnet-5-5/, 2, 4, 0.1, 10],
  [/sonnet-5/, 2, 4, 0.2, 10],
  [/sonnet/, 3, 6, 0.3, 15],
  [/haiku-5-5/, 0.1, 0.2, 0.01, 0.5],
  [/haiku/, 1, 2, 0.1, 5],
];
const usdOf = (model, t) => {
  const p = PRICE.find(([re]) => re.test(model ?? ""));
  return p ? (t.input * p[1] + t.cacheWrite * p[2] + t.cacheRead * p[3] + t.output * p[4]) / 1e6 : null;
};

// ---- one tool call, in Claude Code's terms ----

// Other agents' tool names mapped to Claude Code's. null: neither a lookup nor an action.
const CANON = {
  view: "Read", read: "Read", read_file: "Read", read_many_files: "Read", view_image: "Read",
  grep: "Grep", rg: "Grep", search_file_content: "Grep", glob: "Glob", list_directory: "LS", list: "LS", ls: "LS",
  bash: "Bash", shell: "Bash", local_shell: "Bash", exec_command: "Bash", run_shell_command: "Bash", powershell: "Bash",
  edit: "Edit", create: "Write", write: "Write", write_file: "Write", replace: "Edit", apply_patch: "Edit", patch: "Edit", multiedit: "MultiEdit",
  web_fetch: "WebFetch", webfetch: "WebFetch", web__run: "WebFetch", web_search: "WebSearch", google_web_search: "WebSearch", websearch: "WebSearch",
  task: "Agent", spawn_agent: "Agent", read_bash: "BashOutput",
  skill: null, todowrite: null, todoread: null, update_plan: null, report_intent: null, task_complete: null, sql: null, session_store_sql: null,
  wait: null, wait_agent: null, list_agents: null, sleep: null, js: null, write_stdin: null, clock__curr_time: null, stop_bash: null,
  send_message: "Act", followup_task: "Act", write_bash: "Act", ask_user: "AskUserQuestion", request_user_input_async: "AskUserQuestion",
};

const shellText = (c) => (Array.isArray(c) ? (/^(ba|z)?sh$|^bash$/.test(path.basename(c[0] ?? "")) && /^-l?c$/.test(c[1] ?? "") ? c.slice(2).join(" ") : c.join(" ")) : String(c ?? ""));
const inDir = (cmd, dir) => (dir && !/^\s*cd\s/.test(cmd) ? `cd ${dir} && ${cmd}` : cmd);

/** A JavaScript string literal starting at s[i], decoded (template literals kept as written). */
function literalAt(s, i) {
  const q = s[i];
  if (!`"'\``.includes(q)) return null;
  let j = i + 1;
  while (j < s.length && s[j] !== q) j += s[j] === "\\" ? 2 : 1;
  const raw = s.slice(i + 1, j);
  if (q === '"') {
    try {
      return JSON.parse(`"${raw}"`);
    } catch {}
  }
  return raw.replace(/\\n/g, "\n").replace(/\\(.)/g, "$1");
}
const fieldOf = (s, key) => {
  const m = s.match(new RegExp(`(?:^|[{,\\s])["']?${key}["']?\\s*:\\s*(?=["'\`])`));
  return m ? literalAt(s, m.index + m[0].length) : null;
};
// In a Codex exec cell the patch is still JavaScript source, so a name ends at "\n" or a quote.
const patchFile = (p) => String(p ?? "").match(/\*\*\* (?:Update|Add|Delete) File: ([^\s\\"'`]+)/)?.[1] ?? "";

/** Codex's `exec` tool takes JavaScript that calls tools.<name>(...); each call is one use. */
function codexExec(js) {
  const out = [];
  const calls = [...js.matchAll(/tools\.([A-Za-z0-9_]+)\s*\(/g)];
  for (const [k, m] of calls.entries()) {
    const body = js.slice(m.index + m[0].length, calls[k + 1]?.index ?? m.index + 20000);
    const name = m[1];
    if (name === "exec_command") out.push({ tool: "Bash", arg: inDir(fieldOf(body, "cmd") ?? "", fieldOf(body, "workdir")) });
    else if (name === "apply_patch") out.push({ tool: "Edit", arg: patchFile(body) });
    else if (name.startsWith("mcp__")) out.push({ tool: name, arg: "" });
    else if (name in CANON) {
      if (CANON[name]) out.push({ tool: CANON[name], arg: fieldOf(body, "url") ?? fieldOf(body, "path") ?? fieldOf(body, "query") ?? "" });
    } else out.push({ tool: "Other", arg: name });
  }
  return out;
}

const parse = (t) => {
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
};

/** One tool_call event as [{tool, arg}] in Claude Code's names (MCP tools as mcp__<server>__<tool>). */
export function callsOf(e) {
  let name = e.tool ?? "";
  const input = e.input ?? (typeof e.text === "string" && e.text.startsWith("{") ? parse(e.text) : null) ?? {};
  if (name === "exec" && typeof e.text === "string" && /tools\./.test(e.text)) return codexExec(e.text);
  if (e.server && name.startsWith(`${e.server}-`)) name = `mcp__${e.server}__${name.slice(e.server.length + 1)}`;
  if (name.startsWith("mcp__")) return [{ tool: name, arg: input.question ?? input.query ?? input.q ?? input.path ?? "" }];
  const tool = name in CANON ? CANON[name] : name.toLowerCase() in CANON && !/^[A-Z]/.test(name) ? CANON[name.toLowerCase()] : name;
  if (tool == null) return [];
  if (tool === "Bash" || (tool === "BashOutput" && input.command)) {
    const cmd = input.command ?? input.cmd ?? input.action?.command ?? (name === "local_shell" ? parse(e.text)?.command : null);
    return [{ tool: "Bash", arg: inDir(shellText(cmd), input.workdir ?? input.cwd ?? input.working_directory ?? input.action?.working_directory) }];
  }
  if (tool === "Edit" && (name === "apply_patch" || name === "patch")) return [{ tool, arg: patchFile(input.input ?? input.patch ?? e.text) }];
  if (tool === "Grep" || tool === "Glob" || tool === "LS") return [{ tool, arg: input.path ?? input.dir_path ?? input.directory ?? "" }];
  return [{ tool, arg: String(input.file_path ?? input.filePath ?? input.path ?? input.absolute_path ?? input.url ?? input.query ?? input.pattern ?? input.prompt ?? "") }];
}

// ---- classification (mike-ask src/corpus.mjs) ----

const READ_TOOLS = new Set(["Read", "Grep", "Glob", "LS", "NotebookRead", "WebFetch", "WebSearch", "BashOutput", "TaskOutput"]);
const WRITE_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const NEUTRAL = new Set(["ToolSearch", "TodoWrite", "TodoRead", "Skill", "EnterPlanMode", "ExitPlanMode", "Monitor"]);
const LOOK_HEADS = new Set(("rg grep egrep cat head tail less ls eza find fd wc jq yq stat file tree du df ps pgrep pidof lsof ss which type " +
  "whereis realpath readlink basename dirname date env printenv echo printf journalctl coredumpctl uname hostname id whoami uptime free " +
  "nvidia-smi sort uniq cut awk tr column diff cmp md5sum sha256sum xxd hexdump strings nl test [ true plutil defaults mdfind pg_isready " +
  "tailscale ping dig host nc lsblk findmnt sensors ast-grep sg").split(" "));
const SERVICE_HEADS = new Set(["journalctl", "coredumpctl", "ps", "pgrep", "lsof", "ss", "df", "du", "free", "uptime", "nvidia-smi", "sensors"]);
const GIT_LOOK = new Set(["log", "show", "diff", "status", "blame", "branch", "fetch", "ls-remote", "rev-parse", "grep", "ls-tree", "ls-files",
  "for-each-ref", "merge-base", "remote", "tag", "shortlog", "describe", "reflog", "cat-file", "rev-list", "worktree", "stash", "config", "name-rev"]);
export const FLEET = /fleet|heartbeat|workspace_roster|session_head|inbox|wait_for|ack_session|send_session_message/;

const segsOf = (cmd) => cmd.split(/\s*(?:&&|\|\||;|\|)\s*/).map((s) => s.trim()).filter(Boolean);
const wordsOf = (seg) => seg.replace(/^(sudo|time|[A-Z_]+=\S+)\s+/g, "").split(/\s+/);
const SKIP = new Set(["cd", "export", "set", "source", "."]);
const headOf = (seg) => (wordsOf(seg)[0] || "").replace(/^.*\//, "");

/** A call to ask itself: ask-kit's tool under any server name, mike-ask's, or the CLI. */
const isAsk = (tool, arg = "") =>
  /^mcp__(.*ask.*)__ask$/.test(tool) || (tool === "Bash" && /(^|[;&|]\s*|\s)(ask-kit|ask-kit\.mjs)\s+ask\s/.test(arg));

function bashKind(cmd) {
  let fam = null, look = true;
  for (const s of segsOf(cmd)) {
    const w = wordsOf(s);
    const h = (w[0] || "").replace(/^.*\//, "");
    if (SKIP.has(h)) continue;
    if (h === "git") {
      let i = 1;
      while (w[i]?.startsWith("-")) i += w[i] === "-C" ? 2 : 1;
      fam ??= "git";
      if (!GIT_LOOK.has(w[i] || "") || /\s(add|remove|-d|-D|push|pop|drop|prune|set-url|--unset)\b/.test(s)) look = false;
    } else if (h === "gh") {
      fam ??= "gh";
      if (!/\b(view|list|status|api|search|diff|checks)\b/.test(s) || /(-X|--method)\s*(POST|PATCH|PUT|DELETE)/.test(s)) look = false;
    } else if (h === "ssh") {
      fam ??= "machine";
      if (/\b(restart|start|stop|rm|mv|kill|install|deploy|tee)\b|[^2]>\s*\S/.test(s)) look = false;
    } else if (h === "curl" || h === "wget") {
      fam ??= "machine";
      if (/-X\s*(POST|PUT|DELETE|PATCH)|--data|\s-d\s|\s-o\s/.test(s)) look = false;
    } else if (h === "systemctl" || h === "launchctl") {
      fam ??= "machine";
      if (!/\b(status|show|list-units|list-timers|is-active|is-enabled|cat|print|list)\b/.test(s)) look = false;
    } else if (h === "docker" || h === "podman") {
      fam ??= "machine";
      if (!/\b(ps|logs|inspect|images|stats|top|port|version|info|events|df|ls|config)\b/.test(s) || /\b(rm|rmi|prune|run|up|down|restart|stop|start|kill|exec|build|pull|push)\b/.test(s)) look = false;
    } else if (h === "sed") {
      fam ??= "file";
      if (/\s-i\b|--in-place/.test(s)) look = false;
    } else if (h === "node" || h.startsWith("python")) {
      fam ??= "script";
      if (!/\s-e\s|\s-c\s|\s-p\s|<</.test(s)) look = false;
    } else if (h === "psql" || h === "sqlite3") {
      fam ??= "db";
      if (/\b(insert|update|delete|drop|alter|create)\b/i.test(s)) look = false;
    } else if (LOOK_HEADS.has(h)) {
      fam ??= SERVICE_HEADS.has(h) ? "machine" : "file";
      if (/[^2&]>\s*[^&\s]/.test(s) && !/>\s*\/dev\/null/.test(s)) look = false;
    } else {
      look = false;
      fam ??= "other";
    }
  }
  return { look, fam: fam ?? "file" };
}

/** {k: look|write|act|ask|agent|neutral|other, fam?} for one tool use. */
export function classify(tool, arg = "") {
  if (isAsk(tool, arg)) return { k: "ask" };
  if (WRITE_TOOLS.has(tool)) return { k: "write" };
  if (NEUTRAL.has(tool)) return { k: "neutral" };
  if (READ_TOOLS.has(tool)) return { k: "look", fam: tool.startsWith("Web") ? "web" : "file" };
  if (tool === "Agent" || tool === "Task") return { k: "agent" };
  if (tool === "Act") return { k: "act" };
  if (tool.startsWith("mcp__mike__") || tool.startsWith("mcp__tether__")) {
    if (/send_session_message|record_lesson|write_session_note|set_session_goal|spawn|kill|define_fleet|filter_rule|delete|checkpoint|add_entry|ack_|register|end_workspace|heartbeat|answer|decline|send_mail|correction|fleet_commit|fleet_report/.test(tool))
      return { k: "act" };
    return { k: "look", fam: "mike" };
  }
  if (tool.startsWith("mcp__")) return /(get|list|read|search|find|query|fetch|view|context|status|screenshot)/i.test(tool.split("__")[2] || "") ? { k: "look", fam: "mcp" } : { k: "act" };
  if (tool === "Bash") {
    const { look, fam } = bashKind(arg);
    return look ? { k: "look", fam } : { k: "act" };
  }
  return { k: "other" };
}

/** A normalised form of one lookup, so the same kind of command counts once. */
export function shapeOf(tool, arg = "") {
  if (tool !== "Bash") return tool.startsWith("mcp__") ? tool.replace(/^mcp__(.+?)__/, "$1:") : tool;
  const s = segsOf(arg).find((x) => !SKIP.has(wordsOf(x)[0])) || "";
  const w = wordsOf(s);
  const h = (w[0] || "").replace(/^.*\//, "");
  if (h === "git") {
    let i = 1;
    while (w[i]?.startsWith("-")) i += w[i] === "-C" ? 2 : 1;
    const sub = w[i] || "";
    if (sub === "show" && /\s\S+:\S/.test(s)) return "git show <ref>:<path>";
    if (sub === "log" && /\s-[SG]/.test(s)) return "git log -S/-G <term>";
    return `git ${sub}`;
  }
  if (h === "gh") return `gh ${w[1] || ""} ${w[2] && !w[2].startsWith("-") ? w[2] : ""}`.trim();
  if (h === "curl") return /localhost|127\.0\.0\.1/.test(s) ? `curl localhost:${s.match(/:(\d{2,5})/)?.[1] ?? "?"}` : "curl <remote>";
  if (h === "ssh") return "ssh <host>";
  if (h === "systemctl" || h === "launchctl" || h === "docker") return `${h} ${w.find((x, j) => j > 0 && !x.startsWith("-")) ?? ""}`;
  if (h === "sed") return /-n/.test(s) ? "sed -n <range> <file>" : "sed";
  if (h === "node" || h.startsWith("python")) return `${h} -e <one-liner>`;
  return h || "(cd only)";
}

/** Absolute paths a lookup read; relative ones resolved against the directory it ran in. */
export function pathsOf(tool, arg = "", cwd = null) {
  const raw = [];
  const abs = (p) => (p.startsWith("~/") ? path.join(HOME, p.slice(2)) : p);
  if (tool === "Read" || tool === "Grep" || tool === "Glob" || tool === "LS") {
    if (arg.startsWith("/") || arg.startsWith("~/")) raw.push(abs(arg));
    else if (cwd && tool !== "Read") raw.push(arg ? path.join(cwd, arg) : cwd);
  } else if (tool === "Bash") {
    const dir = arg.match(/^\s*cd\s+("?)([^"\s&;]+)\1\s*(&&|;)/)?.[2] ?? cwd;
    const body = arg.replace(/^\s*cd\s+\S+\s*(&&|;)\s*/, "");
    for (const m of body.matchAll(/(?:^|[\s"'=(:])((?:~\/|\/)?[\w.@-]+(?:\/[\w.@[\]-]+)+|[\w-]+\.[a-z]{1,5})(?=$|[\s"'):;|&,])/g)) {
      const p = m[1];
      if (/^\/(dev|proc|sys)\//.test(p) || /^\d/.test(p) || p.includes("..")) continue;
      if (p.startsWith("/") || p.startsWith("~/")) raw.push(abs(p));
      // A relative token is a path when its last part has an extension or it has two slashes;
      // "owner/repo" and "origin/main" are not.
      else if (dir && (dir.startsWith("/") || dir.startsWith("~/")) && (/\.[a-z]{1,5}$/.test(p) || (p.match(/\//g) ?? []).length >= 2))
        raw.push(path.join(abs(dir), p));
    }
  }
  return raw;
}

/** A path as one area across machines and worktrees: "temet/ask-kit/src", "~/.config/hypr". */
export function normPath(p) {
  return p
    .replace(/\/\.claude\/worktrees\/[^/]+/, "")
    .replace(/^.*?\/projects\//, "")
    .replace(/^\/(private\/)?(tmp|var\/folders)\/.*/, "<tmp>")
    .replace(new RegExp(`^${HOME.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=/|$)`), "~");
}

/** Is the turn's prompt a question someone typed, not "continue", mail or a fleet brief? */
export const informative = (p) => !!p && !/^\[(fleet seat|mail|interrupted|continued)/.test(p) && p.trim().length >= 25;

/** A prompt as an example: mail and fleet briefs marked so informative() can skip them. */
export function tidyPrompt(p) {
  return String(p ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^<channel[^>]*from_session="([0-9a-f]{8})[^>]*>\s*/, "[mail from $1] ")
    .replace(/^<channel[^>]*>\s*/, "[mail] ")
    .replace(/^The tether plugin sent a message: Mail from mike: Your task brief.*/, "[fleet seat: brief from mike]")
    .replace(/^The tether plugin sent a message: Mail from ([^:(]+?)\s*[:(]\s*/, "[mail from $1] ")
    .replace(/^\[Request interrupted.*/, "[interrupted]")
    .replace(/^This session is being continued from a previous conversation.*/, "[continued]")
    .replace(/^([\w-]+)\. Your brief is saved at \S+.*/, "[fleet seat $1: brief in a file]")
    .replace(/^([\w-]+) of fleet [\w-]+\. Your brief is (?:saved )?at \S+.*/, "[fleet seat $1: brief in a file]")
    .slice(0, 200);
}

// ---- which kit a lookup belongs to ----

// Programs whose kit is known even when the kit runs them from a module, not a `requires` entry.
const PROGRAMS = {
  gh: "github", docker: "docker", "docker-compose": "docker", podman: "docker", psql: "postgres", pg_isready: "postgres", pg_dump: "postgres",
  systemctl: "systemd", journalctl: "systemd", coredumpctl: "systemd", loginctl: "systemd", ps: "systemd", pgrep: "systemd", ss: "systemd",
  lsof: "systemd", df: "systemd", du: "systemd", free: "systemd", uptime: "systemd", sensors: "systemd", "nvidia-smi": "systemd",
  git: "code", kubectl: "kubernetes", glab: "gitlab", aws: "aws", gcloud: "gcloud", sqlite3: "sqlite", mike: "mike", tether: "mike",
};
const BUILT_IN = ["sessions", "code"];

/** What attribution needs: installed kits, their programs, folders and MCP servers. */
export function kitRules(config = loadConfig({ required: false }) ?? {}) {
  const installed = new Set(BUILT_IN.filter((d) => config.domains?.[d]?.enabled !== false));
  const programs = { ...PROGRAMS };
  const folders = [];
  const servers = {};
  for (const name of listKits()) {
    if (config.domains?.[name]?.enabled === false || (config.domains && !config.domains[name])) continue;
    let m;
    try {
      m = readManifest(findKit(name));
    } catch {
      continue;
    }
    installed.add(name);
    const settings = { ...Object.fromEntries((m.settings ?? []).filter((s) => s.default != null).map((s) => [s.key, s.default])), ...(config.domains?.[name]?.settings ?? {}) };
    const fill = (s) => String(s).replace(/\$\{([A-Z0-9_]+)\}/g, (_, k) => settings[k] ?? process.env[k] ?? "");
    for (const p of [].concat(m.requires ?? [])) if (!/^mike/.test(p)) programs[p] = name;
    for (const s of m.sources ?? []) {
      if (s.kind === "folder" && s.path) {
        const dir = expand(fill(s.path));
        if (dir) folders.push([dir.replace(/\/$/, ""), name]);
      }
      if ((s.kind === "cli" || s.kind === "mcp") && s.command) {
        const bin = path.basename(fill([].concat(s.command)[0]));
        // mike's own tools stay "mike"; a kit that wraps a few of them is matched below.
        if (s.kind === "cli") programs[bin] = name;
        else if (s.name !== "mike" && !/^mike/.test(bin)) servers[s.name] = servers[bin] = name;
      }
    }
  }
  // Transcript stores are what the sessions domain reads.
  for (const a of Object.values(ADAPTERS)) if (installed.has("sessions")) folders.push([a.where(), "sessions"]);
  folders.sort((a, b) => b[0].length - a[0].length);
  const key = crypto.createHash("sha1").update(JSON.stringify([VERSION, [...installed].sort(), programs, folders, servers])).digest("hex").slice(0, 12);
  return { installed, programs, folders, servers, key };
}

const gitRoots = new Map();
function gitRoot(dir) {
  if (!dir || !path.isAbsolute(dir)) return null;
  if (gitRoots.has(dir)) return gitRoots.get(dir);
  let root = null;
  try {
    if (fs.existsSync(path.join(dir, ".git"))) root = dir;
  } catch {}
  const parent = path.dirname(dir);
  if (!root && parent !== dir && dir !== HOME) root = gitRoot(parent);
  gitRoots.set(dir, root);
  return root;
}

function pathTarget(p, rules, repo) {
  // An agent's own scratch files and saved tool output are not a source.
  if (/\/tool-results\/|\/\.cache\/tmp\/|\/scratchpad\/|\/\.claude\/projects\/[^/]+\/memory\//.test(p)) return null;
  if (/\/\.local\/state\/mike\/|\/\.mike\//.test(p)) return "mike";
  for (const [dir, kit] of rules.folders) if (p === dir || p.startsWith(dir + "/")) return kit;
  if (repo && (p === repo || p.startsWith(repo + "/"))) return "code";
  if (/^\/(var\/log|etc\/systemd|run\/systemd|usr\/lib\/systemd)\//.test(p)) return "systemd";
  if (/^\/(tmp|private\/tmp|var\/folders)\//.test(p)) return null;
  const known = gitRoot(path.dirname(p.replace(/\/\.claude\/worktrees\/[^/]+/, "")));
  if (known || /\/projects\//.test(p)) return "code";
  return `files: ${normPath(p).split("/").slice(0, 2).join("/")}`;
}

/** The kit (or source with no kit) one lookup belongs to. */
export function targetOf(u, rules, repo) {
  if (u.tool.startsWith("mcp__")) {
    const server = u.tool.split("__")[1];
    if (server === "mike" || server === "tether") return rules.installed.has("fleet") && FLEET.test(u.tool) ? "fleet" : "mike";
    return rules.servers[server] ?? `mcp: ${server}`;
  }
  if (u.tool.startsWith("Web")) return "web";
  if (u.tool === "Bash") {
    const heads = segsOf(u.arg).map(headOf).filter((h) => !SKIP.has(h));
    // A command run over ssh counts by what it runs there.
    const inner = heads.includes("ssh") ? segsOf(u.arg.replace(/^.*?\bssh\s+(\S+\s+)*?['"]?/, "")).map(headOf) : [];
    for (const h of [...inner, ...heads]) {
      if (h === "curl" || h === "wget") return /localhost|127\.0\.0\.1|\[::1\]/.test(u.arg) ? "local http" : "web";
      const t = rules.programs[h];
      if (t && t !== "code") return t;
    }
    if (heads.includes("ssh")) return "ssh";
  }
  const ts = u.paths.map((p) => pathTarget(p, rules, repo)).filter(Boolean);
  if (ts.length) return mode(ts);
  if (u.fam === "git" || u.fam === "file") return "code";
  if (u.fam === "machine") return "systemd";
  if (u.fam === "db") return "postgres";
  return null;
}

const mode = (xs) => {
  const n = new Map();
  for (const x of xs) n.set(x, (n.get(x) ?? 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
};

/** The area a chain worked in: the directory most of its reads were in, else its family. */
export function areaOf(chain, depth = 4) {
  const n = new Map();
  for (const u of chain.uses) for (const p of u.paths.filter((x) => !/\/tool-results\/|\/\.cache\/tmp\/|\/scratchpad\//.test(x)).map(normPath)) {
    if (p.startsWith("<")) continue;
    const parts = p.split("/");
    const d = parts.slice(0, Math.min(depth, parts.length - (/\.[\w]{1,5}$/.test(p) ? 1 : 0))).join("/");
    n.set(d, (n.get(d) ?? 0) + 1);
  }
  const best = [...n].sort((a, b) => b[1] - a[1])[0];
  if (best && best[1] * 2 >= chain.uses.filter((u) => u.paths.length).length) return best[0];
  if (chain.fam === "mike") return chain.uses.some((u) => FLEET.test(u.shape)) ? "mike: fleet protocol" : "mike: sessions and history";
  if (chain.fam === "machine") return `machines: ${chain.uses.map((u) => u.shape).find((s) => /^(ssh|systemctl|launchctl|curl|docker)/.test(s)) ?? "state"}`;
  if (chain.fam === "web") return "web";
  if (chain.fam === "mcp") return `mcp: ${chain.uses.map((u) => u.shape.split(":")[0]).find(Boolean)}`;
  return `${chain.fam}: ${chain.cwd ? normPath(chain.cwd) : "(no project)"}`;
}

// ---- chains in one session ----

/**
 * Uses of one session, in order: {turn, prompt, ts, tool, arg, req, chars}, from adapter events
 * read with {usage: true}. Also returns tokens and model per request id.
 */
export function usesOf(events) {
  const uses = [];
  const reqs = new Map();
  const chars = new Map();
  for (const e of events) if (e.role === "tool_result" && e.toolId) chars.set(e.toolId, (e.text ?? "").length);
  let turn = -1;
  let prompt = "";
  const seen = new Set();
  for (const e of events) {
    if (e.role === "user") {
      turn++;
      prompt = tidyPrompt(e.text);
    } else if (e.role === "usage") reqs.set(e.req, { tokens: e.tokens, model: e.model });
    else if (e.role === "tool_call") {
      if (e.toolId && seen.has(e.toolId)) continue;
      if (e.toolId) seen.add(e.toolId);
      const cs = callsOf(e);
      const c = chars.get(e.toolId) ?? 0;
      for (const x of cs) uses.push({ turn, prompt, ts: e.ts, ...x, id: e.toolId, req: e.req ?? `call:${e.i}`, chars: Math.round(c / cs.length) });
    }
  }
  return { uses, reqs };
}

/**
 * Chains and asks of one session. Chain: {turn, ts, prompt, end, purpose, fam, uses:[{tool, fam,
 * shape, paths, req, chars}], reqs}. purpose: "to-do" when a file the chain read is edited later
 * in the turn, "find-then-edit" when other files are, "to-answer" otherwise. Ask: {turn, ts,
 * prompt, req, after} where `after` is how many lookups came just before it.
 */
export function buildChains(uses, { min = 3, cwd = null } = {}) {
  const chains = [], asks = [], writes = new Map();
  let cur = null, run = 0, prev = null;
  const close = (end) => {
    if (cur && cur.uses.length >= min) chains.push({ ...cur, end });
    cur = null;
  };
  for (const u of uses) {
    if (prev && u.turn !== prev.turn) {
      close("turn-end");
      run = 0;
    }
    prev = u;
    const c = classify(u.tool, u.arg);
    if (c.k === "neutral") continue;
    if (c.k === "look") {
      cur ??= { id: u.id, turn: u.turn, ts: u.ts, prompt: u.prompt, cwd, uses: [] };
      cur.uses.push({ tool: u.tool, fam: c.fam, shape: shapeOf(u.tool, u.arg), arg: u.arg, paths: pathsOf(u.tool, u.arg, cwd), req: u.req, chars: u.chars });
      cur.lastTs = u.ts;
      run++;
      continue;
    }
    if (c.k === "ask") asks.push({ id: u.id, turn: u.turn, ts: u.ts, prompt: u.prompt, req: u.req, after: run });
    if (c.k === "write") (writes.get(u.turn) ?? writes.set(u.turn, []).get(u.turn)).push({ ts: u.ts, file: u.arg });
    close(c.k);
    run = 0;
  }
  close("turn-end");
  for (const ch of chains) {
    ch.fam = mode(ch.uses.map((u) => u.fam));
    const read = new Set(ch.uses.flatMap((u) => u.paths));
    const later = (writes.get(ch.turn) ?? []).filter((w) => (w.ts ?? "") >= (ch.lastTs ?? ""));
    ch.purpose = later.some((w) => read.has(w.file)) ? "to-do" : later.length ? "find-then-edit" : "to-answer";
    ch.reqs = [...new Set(ch.uses.map((u) => u.req))];
  }
  return { chains, asks };
}

/** Tokens and $ of a set of requests; requests with no usage counted as result chars / 4. */
function costOf(reqIds, reqs, chars) {
  let tokens = 0, usd = 0, measured = 0, estimated = 0;
  for (const r of reqIds) {
    const u = reqs.get(r);
    if (!u) continue;
    const t = u.tokens;
    tokens += t.input + t.cacheWrite + t.cacheRead + t.output;
    usd += usdOf(u.model, t) ?? 0;
    measured++;
  }
  if (!measured) {
    estimated = Math.round(chars / 4);
    tokens = estimated;
  }
  return { tokens, usd: +usd.toFixed(4), measured: measured > 0 };
}

/** One session, summarised for the cache: chains and asks with their kit, area and cost. */
export async function analyseSession(s, rules) {
  const { uses, reqs } = usesOf(await ADAPTERS[s.source].events(s, { usage: true }));
  const cwd = s.cwd ? s.cwd.replace(/\/\.claude\/worktrees\/[^/]+.*$/, "") : null;
  const repo = gitRoot(s.cwd) ?? cwd;
  const { chains, asks } = buildChains(uses, { cwd: s.cwd });
  return {
    chains: chains.map((ch) => {
      const targets = ch.uses.map((u) => targetOf(u, rules, repo)).filter(Boolean);
      return {
        id: ch.id, ts: ch.ts, prompt: ch.prompt, end: ch.end, purpose: ch.purpose, fam: ch.fam, n: ch.uses.length, area: areaOf(ch),
        kit: mode(targets) ?? "unknown", touched: [...new Set(targets)],
        ...costOf(ch.reqs, reqs, ch.uses.reduce((a, u) => a + u.chars, 0)),
      };
    }),
    asks: asks.map((a) => ({ id: a.id, ts: a.ts, prompt: a.prompt, after: a.after, ...costOf([a.req], reqs, 0) })),
  };
}

// ---- the report ----

const DAY = 86400_000;
const sinceMs = (x) => {
  const m = String(x ?? "30d").match(/^(\d+)\s*([dhw])$/);
  if (m) return Date.now() - Number(m[1]) * { h: 3600_000, d: DAY, w: 7 * DAY }[m[2]];
  const t = Date.parse(x);
  if (Number.isNaN(t)) throw new Error(`--since: a duration like 30d, 12h or 2w, or a date (got ${x})`);
  return t;
};

const cacheFile = () => path.join(STATE_ROOT, "index", "gaps.json");

/**
 * Read every session updated since `since` and summarise. o: {since, sources, rules, cache}.
 * Returns {since, sessions, cached, seconds, chains: [...], asks: [...]} where each item carries
 * {source, session, project}.
 */
export async function scan(o = {}) {
  const started = Date.now();
  const since = sinceMs(o.since);
  const rules = o.rules ?? kitRules();
  let cache = {};
  if (o.cache !== false) {
    try {
      const c = JSON.parse(fs.readFileSync(cacheFile(), "utf8"));
      if (c.key === rules.key) cache = c.sessions ?? {};
    } catch {}
  }
  // Oldest first: a resumed or forked Claude Code session copies its parent's history, tool call
  // ids included, so a chain is counted once, in the session that made it.
  const list = (await listSessions(o.sources)).filter((s) => Date.parse(s.updatedAt) >= since).sort((a, b) => (a.startedAt ?? "").localeCompare(b.startedAt ?? ""));
  const chains = [], asks = [], next = {}, ids = new Set();
  const first = (x) => !x.id || (!ids.has(x.id) && ids.add(x.id));
  let cached = 0;
  const bySource = {};
  for (const s of list) {
    const id = `${s.source}:${s.id}`;
    const stamp = `${s.updatedAt}|${s.size ?? ""}`;
    let r = cache[id]?.stamp === stamp ? cache[id].r : null;
    if (r) cached++;
    else {
      try {
        r = await analyseSession(s, rules);
      } catch {
        r = { chains: [], asks: [] };
      }
    }
    next[id] = { stamp, r };
    bySource[s.source] = (bySource[s.source] ?? 0) + 1;
    const tag = { source: s.source, session: s.id, project: s.project };
    for (const c of r.chains) if (Date.parse(c.ts) >= since && first(c)) chains.push({ ...tag, ...c });
    for (const a of r.asks) if (Date.parse(a.ts) >= since && first(a)) asks.push({ ...tag, ...a });
  }
  if (o.cache !== false) {
    try {
      // Keep entries outside this window too, so a wider --since later reuses them.
      for (const [k, v] of Object.entries(cache)) next[k] ??= v;
      fs.mkdirSync(path.dirname(cacheFile()), { recursive: true, mode: 0o700 });
      fs.writeFileSync(`${cacheFile()}.tmp-${process.pid}`, JSON.stringify({ key: rules.key, sessions: next }));
      fs.renameSync(`${cacheFile()}.tmp-${process.pid}`, cacheFile());
    } catch {}
  }
  return { since: new Date(since).toISOString(), sessions: list.length, bySource, cached, seconds: +((Date.now() - started) / 1000).toFixed(1), rules, chains, asks };
}

function group(items, key) {
  const g = new Map();
  for (const x of items) {
    const k = key(x);
    (g.get(k) ?? g.set(k, []).get(k)).push(x);
  }
  return g;
}

function sumUp(chains, examples = 3) {
  const sessions = new Set(chains.map((c) => `${c.source}:${c.session}`)).size;
  const tokens = chains.reduce((a, c) => a + c.tokens, 0);
  const usd = chains.reduce((a, c) => a + (c.usd ?? 0), 0);
  const areas = [...group(chains, (c) => c.area)].map(([area, cs]) => ({ area, chains: cs.length })).sort((a, b) => b.chains - a.chains).slice(0, 5);
  const seen = new Set();
  const ex = [];
  for (const c of [...chains].sort((a, b) => b.ts.localeCompare(a.ts))) {
    if (ex.length >= examples) break;
    if (!informative(c.prompt) || seen.has(c.prompt)) continue;
    seen.add(c.prompt);
    ex.push({ prompt: c.prompt, source: c.source, session: c.session, ts: c.ts });
  }
  return { chains: chains.length, sessions, tokens, usd: +usd.toFixed(2), areas, examples: ex, uninformative: chains.filter((c) => !informative(c.prompt)).length };
}

const mailOrFleet = (p) => /^\[(fleet seat|mail)/.test(p ?? "");

/** The gaps report from a scan. */
export function report(sc) {
  const toAnswer = sc.chains.filter((c) => c.purpose === "to-answer" && c.end !== "ask");
  const intoAsk = sc.chains.filter((c) => c.end === "ask");
  // Every ask is one piece of digging that went to ask. One after a chain of hand lookups costs
  // that chain; one asked straight away costs the call that made it.
  const direct = sc.asks.filter((a) => a.after < 3);
  const askTokens = intoAsk.reduce((s, c) => s + c.tokens, 0) + direct.reduce((s, a) => s + a.tokens, 0);
  const handTokens = toAnswer.reduce((s, c) => s + c.tokens, 0);
  const units = sc.asks.length + toAnswer.length;
  const measured = sc.chains.filter((c) => c.measured).length;
  const byKit = group(toAnswer, (c) => c.kit);
  // Installed kits count every chain and say how many came from mail, briefs or short prompts.
  // Demand for a kit not built yet counts only chains that started from a typed question.
  const skipped = [...byKit].filter(([k]) => sc.rules.installed.has(k)).map(([kit, cs]) => ({ kit, ...sumUp(cs) })).sort((a, b) => b.tokens - a.tokens);
  const noKit = [...byKit]
    .filter(([k]) => !sc.rules.installed.has(k))
    .map(([source, cs]) => ({ source, ...sumUp(cs.filter((c) => informative(c.prompt))), excluded: cs.filter((c) => !informative(c.prompt)).length }))
    .filter((x) => x.chains > 0)
    .sort((a, b) => b.sessions * b.tokens - a.sessions * a.tokens);
  const byFamily = Object.fromEntries([...group(toAnswer, (c) => c.fam)].map(([f, cs]) => [f, { chains: cs.length, sessions: new Set(cs.map((c) => c.session)).size }]).sort((a, b) => b[1].chains - a[1].chains));
  return {
    since: sc.since,
    scanned: { sessions: sc.sessions, bySource: sc.bySource, fromCache: sc.cached, seconds: sc.seconds },
    cost: {
      basis: measured === sc.chains.length ? "tokens from transcript usage" : `tokens from transcript usage for ${measured} of ${sc.chains.length} chains; the rest estimated as tool-result characters / 4`,
      usd: "Claude models at list price; other models have none",
    },
    coverage: {
      asks: sc.asks.length,
      asksAfterChain: intoAsk.length,
      byHand: toAnswer.length,
      share: units ? +(sc.asks.length / units).toFixed(3) : null,
      tokenShare: askTokens + handTokens ? +(askTokens / (askTokens + handTokens)).toFixed(3) : null,
      handSessions: new Set(toAnswer.map((c) => `${c.source}:${c.session}`)).size,
      handTokens,
      handUsd: +toAnswer.reduce((s, c) => s + (c.usd ?? 0), 0).toFixed(2),
    },
    allChains: sc.chains.length,
    byFamily,
    excluded: {
      mailOrFleet: toAnswer.filter((c) => mailOrFleet(c.prompt)).length,
      other: toAnswer.filter((c) => !mailOrFleet(c.prompt) && !informative(c.prompt)).length,
    },
    skipped,
    noKit,
    installed: [...sc.rules.installed].sort(),
  };
}

export async function gaps(o = {}) {
  return report(await scan(o));
}

const fmtTok = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)}G` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));

/** The report as text for the terminal. */
export function formatReport(r) {
  const c = r.coverage;
  const pct = (x) => (x == null ? "-" : `${Math.round(x * 100)}%`);
  const lines = [
    `Since ${r.since.slice(0, 10)}: ${r.scanned.sessions} sessions (${Object.entries(r.scanned.bySource).map(([k, v]) => `${k} ${v}`).join(", ")}) in ${r.scanned.seconds} s, ${r.scanned.fromCache} from cache.`,
    `Cost: ${r.cost.basis}.`,
    "",
    `Coverage: ${c.asks} asks against ${c.byHand} lookup chains answered by hand: ${pct(c.share)} of the digging went to ask, ${pct(c.tokenShare)} by tokens.`,
    `By hand: ${c.handSessions} sessions, ${fmtTok(c.handTokens)} tokens${c.handUsd ? `, $${c.handUsd} at list price` : ""}.`,
    `Not a typed question: ${r.excluded.mailOrFleet} chains started from mail or a fleet brief, ${r.excluded.other} from a short or interrupted prompt; no example prompts come from them, and "No kit" leaves them out.`,
    "",
    "Installed but skipped:",
  ];
  const block = (name, x) => {
    const note = x.excluded ? ` (${x.excluded} more not from a typed question, left out)` : x.uninformative ? ` (${x.uninformative} not from a typed question)` : "";
    lines.push(`  ${name}: ${x.chains} chains in ${x.sessions} sessions, ${fmtTok(x.tokens)} tokens${x.usd ? `, $${x.usd}` : ""}${note}`);
    if (x.areas.length) lines.push(`    areas: ${x.areas.map((a) => `${a.area} ${a.chains}`).join(", ")}`);
    for (const e of x.examples) lines.push(`    "${e.prompt.slice(0, 140)}"  (${e.source} ${e.session.slice(0, 8)})`);
  };
  if (!r.skipped.length) lines.push("  none");
  for (const x of r.skipped) block(x.kit, x);
  lines.push("", "No kit (ranked by sessions x tokens):");
  if (!r.noKit.length) lines.push("  none");
  for (const x of r.noKit.slice(0, 12)) block(x.source, x);
  return lines.join("\n");
}
