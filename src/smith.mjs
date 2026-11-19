// smith: the kit that builds kits (docs/design/smith.md). `ask-kit gaps` finds the sources agents dig
// through by hand and `ask-kit mine` finds the questions they dug for. smith takes it from there:
//
//   scaffold <source>  find the source on this machine (an MCP server in an agent's config, a program
//                      on PATH, a folder), draft a kit for it from the questions agents asked, and
//                      write it to STATE_ROOT/drafts/kits/<name>, where nothing routes to it
//   prove <name>       kit test on the draft, the mined questions judged against what the agents
//                      found by hand; failures go to a model that rewrites the instructions, up to
//                      three rounds
//   install <name>     move a proven draft into the kits folder and enable it
//   promote <kit>      the questions `ask-kit report` finds keep running one script, as [[actions]]
//                      entries (printed for the kit's author to add; smith never edits a kit)
//
// A drafted kit only reads: the tools an MCP server offers that change something are left out of
// `allow` and listed in a comment, for the user to add. A setting's value is never copied into a
// kit file: a value the agent's config takes from the environment stays an environment reference,
// and any other value is read from that config file each time (`detect`).
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { parse as parseToml } from "smol-toml";
import { CONFIG_DIR, HOME, loadConfig, saveConfig } from "./config.mjs";
import { PROGRAMS, scan } from "./gaps.mjs";
import { listSessions } from "./transcripts/index.mjs";
import { draftsDir, readManifest, MANIFEST } from "./kits.mjs";
import { mine } from "./mine.mjs";
import { which } from "./platform.mjs";

const NAME = /^[a-z][a-z0-9-]*$/;
const SECRET = /TOKEN|SECRET|PASSWORD|PASSWD|KEY|CREDENTIAL|AUTH|COOKIE|SESSION|EMAIL/i;
// A word in a tool's name that changes something (jira_add_comment, env_switch, k8s_port_forward).
const WRITES = /^post[_-]|(^|[_-])(add|create|update|delete|remove|transition|merge|approve|send|set|switch|ensure|connect|forward|restart|stop|start|run|trigger|retry|cancel|close|reopen|edit|write|push|label|assign|unassign|upload|move|rename|kill|exec|apply|deploy|publish|submit|reply|comment|rebase|revert|lock|unlock|enable|disable|install|grant|revoke)([_-]|$)/i;

// A prompt that asks for a change rather than an answer.
const ACTING = /^(create|add|post|merge|approve|fix|implement|write|update|delete|remove|push|commit|make|build|deploy|move|rename|send|reply|comment|close|open|raise|file|log|set|change|apply)\b/i;

/** Does an MCP tool only read? By its name: no word in it changes something. */
export const readsOnly = (tool) => !WRITES.test(tool);

// ---- discover: where the source is on this machine ----

const readJson = (f) => {
  try {
    return JSON.parse(fs.readFileSync(f, "utf8"));
  } catch {
    return null;
  }
};

/** MCP server configs agents use, nearest first: .mcp.json above each session's directory, then each agent's own. */
export function mcpConfigs(cwds = []) {
  const out = [];
  const seen = new Set();
  const add = (file, servers, cwd = null) => {
    if (!servers || seen.has(file)) return;
    seen.add(file);
    out.push({ file, servers, cwd });
  };
  for (const start of cwds.filter(Boolean)) {
    for (let d = start; ; d = path.dirname(d)) {
      const f = path.join(d, ".mcp.json");
      if (fs.existsSync(f)) add(f, readJson(f)?.mcpServers, d);
      if (d === path.dirname(d) || d === HOME) break;
    }
  }
  add(path.join(HOME, ".claude.json"), readJson(path.join(HOME, ".claude.json"))?.mcpServers);
  add(path.join(process.env.COPILOT_HOME || path.join(HOME, ".copilot"), "mcp-config.json"), readJson(path.join(process.env.COPILOT_HOME || path.join(HOME, ".copilot"), "mcp-config.json"))?.mcpServers);
  add(path.join(HOME, ".gemini", "settings.json"), readJson(path.join(HOME, ".gemini", "settings.json"))?.mcpServers);
  const codex = path.join(process.env.CODEX_HOME || path.join(HOME, ".codex"), "config.toml");
  try {
    add(codex, parseToml(fs.readFileSync(codex, "utf8")).mcp_servers);
  } catch {}
  return out;
}

/**
 * Where `source` (a name `ask-kit gaps` lists) lives here. Returns {kind: "mcp", server, file, cwd,
 * command, env} | {kind: "cli", programs} | {kind: "folder", path}; throws with the reason when it
 * cannot be a kit of its own.
 */
export function discover(source, { cwds = [] } = {}) {
  const mcp = source.match(/^mcp: (.+)$/);
  if (mcp) {
    const server = mcp[1];
    const hit = mcpConfigs(cwds).find((c) => c.servers?.[server]);
    if (!hit) throw new Error(`no agent config here names the MCP server "${server}" (looked in .mcp.json above the sessions' folders and in each agent's own config)`);
    const s = hit.servers[server];
    if (s.url || s.type === "http" || s.type === "sse") throw new Error(`"${server}" is an HTTP MCP server; kits start stdio servers only`);
    return { kind: "mcp", server, file: hit.file, cwd: hit.cwd, command: [s.command, ...(s.args ?? [])], env: s.env ?? {} };
  }
  const folder = source.match(/^files: (.+)$/);
  if (folder) return { kind: "folder", path: folder[1] };
  const programs = Object.entries(PROGRAMS).filter(([, k]) => k === source).map(([p]) => p).filter((p) => which(p));
  if (programs.length) return { kind: "cli", programs };
  const why = {
    web: "the web is many sites, not one source",
    ssh: "ssh reaches other machines; a kit for what runs there is the better fit",
    mike: "mike's kit is ask-kit-mike, being built as a pack",
    "local http": "a local HTTP service needs its API named (an OpenAPI document or a module source)",
    unknown: "these chains touched nothing gaps could name",
  }[source];
  throw new Error(`${source}: ${why ?? "no MCP server, program or folder of that name here"}`);
}

/** Env entries as manifest text and settings: references stay references, other values are read from the config file. */
export function envOf(d) {
  const env = {};
  const settings = [];
  for (const [k, v] of Object.entries(d.env ?? {})) {
    if (!/^[A-Z_][A-Z0-9_]*$/.test(k)) continue;
    if (/^\$\{[A-Z_][A-Z0-9_]*\}$/.test(String(v))) {
      env[k] = String(v);
      continue;
    }
    env[k] = `\${${k}}`;
    const js = "const j=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));process.stdout.write(String((j.mcpServers??{})[process.argv[2]]?.env?.[process.argv[3]]??''))";
    settings.push({ key: k, about: `${d.server}'s ${k}, read from ${d.file.replace(HOME, "~")}`, detect: ["node", "-e", js, d.file, d.server, k], secret: SECRET.test(k) });
  }
  return { env, settings };
}

/** The values a drafted server needs to start now (scaffold lists its tools): read, never written. */
function liveEnv(d) {
  const out = {};
  for (const [k, v] of Object.entries(d.env ?? {})) {
    const ref = String(v).match(/^\$\{([A-Z_][A-Z0-9_]*)\}$/);
    out[k] = ref ? process.env[ref[1]] ?? "" : String(v);
  }
  return out;
}

async function listTools(d) {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
  const c = new Client({ name: "ask-kit-smith", version: "0" });
  await c.connect(new StdioClientTransport({ command: d.command[0], args: d.command.slice(1), env: { ...process.env, ...liveEnv(d) }, stderr: "ignore", ...(d.cwd ? { cwd: d.cwd } : {}) }));
  try {
    return (await c.listTools()).tools.map((t) => ({ name: t.name, description: (t.description ?? "").replace(/\s+/g, " ").slice(0, 200) }));
  } finally {
    await c.close().catch(() => {});
  }
}

function helpOf(prog) {
  try {
    return execFileSync(prog, ["--help"], { encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NO_COLOR: "1", PAGER: "cat" } }).split("\n").slice(0, 60).join("\n");
  } catch (e) {
    return String(e.stdout ?? "").split("\n").slice(0, 60).join("\n");
  }
}

// ---- scaffold ----

const toml = (v) => JSON.stringify(v);
const tomlArr = (a) => `[${a.map(toml).join(", ")}]`;

const DRAFT =
  "You write a kit for ask-kit: a cheap model that answers coding agents' questions by calling one source (an MCP server's tools, " +
  "a program, or a folder) from a JavaScript REPL. You get the source, what it offers, and real questions agents dug through it for " +
  "by hand. Reply with JSON only: {\"says\": one line naming what the kit answers, in the words those questions use (it is what a " +
  "router reads to choose this kit), \"keywords\": up to 6 regex words that mark a question as this kit's (no word another tool " +
  "would own, like git or file), \"route_hint\": one sentence on what goes here and what goes to session history or code instead, " +
  "\"instructions\": markdown for the investigator: which calls answer which kind of question, in what order, what to cite (ids, " +
  "URLs, names), and what the source cannot answer; under 60 lines, no preamble}.";

/**
 * Draft a kit for `source`. o: {name, since, n, scan, chat, tools}. `scan`, `chat` and `tools` may be
 * passed in (tests). Returns {dir, name, kind, allow, leftOut, settings, questions}.
 */
export async function scaffold(source, o = {}) {
  const sc = o.scan ?? (await scan({ since: o.since ?? "30d" }));
  const chains = sc.chains.filter((c) => c.kit === source);
  if (!chains.length) throw new Error(`${source}: no lookup chains since ${sc.since.slice(0, 10)} (ask-kit gaps lists the sources)`);
  const sessions = new Map((await listSessions()).map((s) => [`${s.source}:${s.id}`, s]));
  const cwds = [...new Set(chains.map((c) => sessions.get(`${c.source}:${c.session}`)?.cwd).filter(Boolean))];
  const d = discover(source, { cwds });
  const name = o.name ?? (d.kind === "mcp" ? d.server : source.replace(/^files: /, "").split("/").pop()).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!NAME.test(name)) throw new Error(`"${name}" is not a kit name; pass --name`);
  const dir = path.join(draftsDir(), name);
  if (fs.existsSync(path.join(dir, MANIFEST))) throw new Error(`${dir} already has a draft; prove it, or remove the folder to start again`);

  // A drafted kit only reads, so a mined task that asks it to change something can't be its test.
  const mined = await mine({ kit: source, scan: sc, n: (o.n ?? 12) * 2 });
  const questions = mined.rows.filter((r) => r.found && !ACTING.test(r.q.replace(/^(okay|ok|so|now|then|please|pls),?\s+/i, ""))).slice(0, o.n ?? 12).map((r) => ({ id: r.id, q: r.q, reference: r.found, askedAt: r.source.split(" ").at(-1), source: r.source }));
  if (!questions.length) throw new Error(`${source}: no typed question with an answer to test against`);

  let offer = "";
  let allow = [];
  let leftOut = [];
  let srcToml = "";
  let requires = [];
  const { env, settings } = d.kind === "mcp" ? envOf(d) : { env: {}, settings: [] };
  if (d.kind === "mcp") {
    const tools = o.tools ?? (await listTools(d));
    allow = tools.filter((t) => readsOnly(t.name)).map((t) => t.name);
    leftOut = tools.filter((t) => !readsOnly(t.name)).map((t) => t.name);
    offer = tools.filter((t) => allow.includes(t.name)).map((t) => `- ${t.name}: ${t.description}`).join("\n");
    srcToml =
      `[[sources]]\nkind = "mcp"\nname = ${toml(d.server.replace(/[^A-Za-z0-9_]/g, "_"))}\ncommand = ${tomlArr(d.command)}\n` +
      (d.cwd ? `cwd = ${toml(d.cwd.replace(HOME, "~"))}\n` : "") +
      (Object.keys(env).length ? `env = { ${Object.entries(env).map(([k, v]) => `${k} = ${toml(v)}`).join(", ")} }\n` : "") +
      `allow = ${tomlArr(allow)}\n` +
      (leftOut.length ? `# Left out because they change something; add one to allow to let the kit use it: ${leftOut.join(", ")}\n` : "");
  } else if (d.kind === "cli") {
    requires = d.programs;
    offer = d.programs.map((p) => `$ ${p} --help\n${o.help?.[p] ?? helpOf(p)}`).join("\n\n");
    srcToml = d.programs.map((p) => `[[sources]]\nkind = "cli"\nname = ${toml(p.replace(/[^A-Za-z0-9_]/g, "_"))}\ncommand = ${tomlArr([p])}\n`).join("\n");
  } else {
    offer = `the folder ${d.path}`;
    srcToml = `[[sources]]\nkind = "folder"\nname = "files"\npath = ${toml(d.path)}\n`;
  }

  const chat = o.chat ?? (await import("./llm.mjs")).chat;
  const user = `Source: ${d.kind} ${d.kind === "mcp" ? d.server : d.kind === "cli" ? d.programs.join(", ") : d.path}\n\nWhat it offers:\n${offer}\n\nQuestions agents dug for by hand:\n${questions.map((q) => `- ${q.q}`).join("\n")}`;
  const draft = await chat({ system: DRAFT, user, json: true, maxTokens: 3000 });

  fs.mkdirSync(path.join(dir, "bench"), { recursive: true });
  const settingsToml = settings
    .map((s) => `[[settings]]\nkey = ${toml(s.key)}\nabout = ${toml(s.about)}\ndetect = ${tomlArr(s.detect)}\n${s.secret ? "secret = true\n" : ""}`)
    .join("\n");
  fs.writeFileSync(
    path.join(dir, MANIFEST),
    `# Drafted by ask-kit smith from ${chains.length} lookup chains on ${source} since ${sc.since.slice(0, 10)}.\n` +
      `name = ${toml(name)}\nversion = "0.1.0"\nsays = ${toml(String(draft.says ?? "").trim())}\n` +
      (draft.keywords?.length ? `keywords = ${tomlArr(draft.keywords.map(String).slice(0, 6))}\n` : "") +
      (draft.route_hint ? `route_hint = ${toml(String(draft.route_hint))}\n` : "") +
      (requires.length ? `requires = ${tomlArr(requires)}\n` : "") +
      `instructions = "instructions.md"\n\n${settingsToml ? `${settingsToml}\n` : ""}${srcToml}`,
  );
  fs.writeFileSync(path.join(dir, "instructions.md"), `${String(draft.instructions ?? "").trim()}\n`);
  fs.writeFileSync(path.join(dir, "bench", "questions.json"), JSON.stringify({ about: `Mined by ask-kit smith: questions agents dug for by hand on ${source}. Each is judged against reference, what the agent found then.`, questions }, null, 2) + "\n");
  fs.writeFileSync(path.join(dir, "smith.json"), JSON.stringify({ source, discovered: { ...d, env: Object.keys(d.env ?? {}) }, chains: chains.length, since: sc.since, allow, leftOut, offer, rounds: [] }, null, 2) + "\n");
  readManifest(dir);
  return { dir, name, kind: d.kind, allow, leftOut, settings: settings.map((s) => s.key), questions: questions.length };
}

// ---- prove ----

const TUNE =
  "You improve a kit's instructions for ask-kit, a cheap model that answers questions from a REPL over a source. You get the " +
  "instructions, what the source offers, and the questions the kit got wrong: each with the reference answer an agent found by " +
  "hand, the kit's answer and the judge's reason. Change the instructions so the investigator finds those answers: which call to " +
  "make first, which fields hold the answer, what to cite, what to do when a call returns nothing. Keep what works. Reply with JSON " +
  "only: {\"instructions\": the whole new markdown, under 80 lines, \"changed\": one sentence on what you changed}.";

/**
 * kit test on a draft, up to `rounds` times; between rounds a model rewrites instructions.md from the
 * failures. Questions judged "changed" (the source moved on since the reference) are not failures to
 * fix: they are reported for the user. o: {rounds, backends, log, test, chat}.
 */
export async function prove(name, o = {}) {
  const dir = path.join(draftsDir(), name);
  if (!fs.existsSync(path.join(dir, MANIFEST))) throw new Error(`no draft ${name} in ${draftsDir()}`);
  process.env.ASK_KIT_DRAFTS = "1";
  const log = o.log ?? (() => {});
  const test = o.test ?? (async (n, x) => (await import("./kittest.mjs")).kitTest(n, x));
  const chat = o.chat ?? (await import("./llm.mjs")).chat;
  const meta = readJson(path.join(dir, "smith.json")) ?? { rounds: [] };
  const rounds = o.rounds ?? 3;
  const latest = new Map();
  const before = meta.rounds.length;
  let only;
  for (let round = 1; round <= rounds; round++) {
    log(`round ${round}${only ? `: ${only.length} questions` : ""}`);
    const r = await test(name, { backends: o.backends, only, log });
    for (const x of r.results) latest.set(`${x.backend}|${x.id}`, x);
    const failed = r.results.filter((x) => !x.pass && x.verdict !== "changed");
    meta.rounds.push({ round, at: new Date().toISOString(), summary: r.summary, failed: failed.map((x) => x.id) });
    if (!failed.length || round === rounds) break;
    const bench = readJson(path.join(dir, "bench", "questions.json")).questions;
    const byId = Object.fromEntries(bench.map((q) => [q.id, q]));
    const instructions = fs.readFileSync(path.join(dir, "instructions.md"), "utf8");
    const user = `Instructions now:\n${instructions}\n\nWhat the source offers:\n${meta.offer ?? ""}\n\nWrong answers:\n${JSON.stringify(failed.map((x) => ({ question: byId[x.id]?.q, reference: byId[x.id]?.reference, answer: x.answer.slice(0, 1200), judge: x.reason ?? x.missing?.join("; ") })))}`;
    const t = await chat({ system: TUNE, user, json: true, maxTokens: 4000 });
    if (t.instructions) fs.writeFileSync(path.join(dir, "instructions.md"), `${String(t.instructions).trim()}\n`);
    meta.rounds.at(-1).changed = t.changed ?? null;
    log(`  instructions: ${t.changed ?? "rewritten"}`);
    only = [...new Set(failed.map((x) => x.id))];
  }
  fs.writeFileSync(path.join(dir, "smith.json"), JSON.stringify(meta, null, 2) + "\n");
  const all = [...latest.values()];
  const changed = all.filter((x) => x.verdict === "changed").map((x) => x.id);
  const passed = all.filter((x) => x.pass).length;
  return { name, dir, passed, of: all.length, changed, failed: all.filter((x) => !x.pass && x.verdict !== "changed").map((x) => x.id), rounds: meta.rounds.length - before };
}

// ---- promote: questions that keep running one script become [[actions]] ----

const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const capture = (key, v) => `(?<${key}>${typeof v === "number" ? "\\d+(?:\\.\\d+)?" : /\s/.test(String(v)) ? ".+?" : "[^\\s?!,]+"})`;

/**
 * One [[actions]] entry from a report cluster ({kit, template, script, questions, params}), or
 * {skip: why}. The pattern is the first question with each param value that differs between
 * questions turned into a named capture; a value the questions share is a default in `params`.
 * The entry is kept only when every example question matches it as compileActions matches.
 */
export function actionFrom(cluster, { taken = new Set(), acts = [] } = {}) {
  const sets = (cluster.params ?? []).map((p) => {
    try {
      return JSON.parse(p);
    } catch {
      return null;
    }
  }).filter((p) => p && typeof p === "object" && !Array.isArray(p));
  const pairs = cluster.questions.map((q) => ({ q, p: sets.find((s) => Object.values(s).every((v) => typeof v === "object" || String(q).toLowerCase().includes(String(v).toLowerCase()))) ?? (sets.length ? null : {}) }));
  if (pairs.some((x) => !x.p)) return { skip: "a question's params could not be found in its words" };
  const keys = [...new Set(pairs.flatMap((x) => Object.keys(x.p)))];
  const varying = keys.filter((k) => new Set(pairs.map((x) => JSON.stringify(x.p[k]))).size > 1);
  const defaults = Object.fromEntries(keys.filter((k) => !varying.includes(k)).map((k) => [k, pairs[0].p[k]]));
  if (varying.some((k) => !/^[A-Za-z_]\w*$/.test(k) || pairs.some((x) => typeof x.p[k] === "object"))) return { skip: "a param that varies is not a plain value" };
  // Place the varying values in the first question, left to right, and escape the text between.
  const q0 = String(pairs[0].q).replace(/[\s?.!]+$/, "");
  const lower = q0.toLowerCase();
  const spots = varying.map((k) => ({ k, v: pairs[0].p[k], at: lower.indexOf(String(pairs[0].p[k]).toLowerCase()) })).sort((a, b) => a.at - b.at);
  if (spots.some((s) => s.at < 0)) return { skip: "a varying value is not in the first question" };
  let pattern = "";
  let i = 0;
  for (const s of spots) {
    if (s.at < i) return { skip: "two values overlap in the question" };
    pattern += reEsc(q0.slice(i, s.at)).replace(/\s+/g, "\\s+") + capture(s.k, s.v);
    i = s.at + String(s.v).length;
  }
  pattern += reEsc(q0.slice(i)).replace(/\s+/g, "\\s+");
  const re = new RegExp(`^\\s*(?:${pattern})[\\s?.!]*$`, "i");
  const missed = pairs.filter((x) => {
    const m = String(x.q).match(re);
    return !m || varying.some((k) => String(m.groups?.[k]).toLowerCase() !== String(x.p[k]).toLowerCase());
  });
  if (missed.length) return { skip: `the pattern does not cover: ${missed.map((x) => x.q).join(" | ")}` };
  let name = cluster.script.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^[^a-z]+/, "") || "action";
  for (let n = 2; taken.has(name); n++) name = `${cluster.script.toLowerCase().replace(/[^a-z0-9-]+/g, "-")}-${n}`;
  taken.add(name);
  return {
    action: { name, title: q0.slice(0, 60), script: cluster.script, match: [pattern], ...(Object.keys(defaults).length ? { params: defaults } : {}), ...(acts.includes(cluster.script) ? { acts: true } : {}) },
    from: { n: cluster.n, sessions: cluster.sessions, costUsd: cluster.costUsd, questions: cluster.questions },
  };
}

// A regex reads best as a TOML literal string ('...', no escapes); one holding a quote is a basic string.
const tomlValue = (v) =>
  typeof v === "string" ? (/['\n]/.test(v) ? JSON.stringify(v) : `'${v}'`) : typeof v === "object" ? `{ ${Object.entries(v).map(([k, x]) => `${k} = ${tomlValue(x)}`).join(", ")} }` : String(v);

/** [[actions]] entries as manifest text, each with a comment saying what it was promoted from. */
export function actionsToml(entries) {
  return entries
    .map(({ action: a, from }) =>
      `# Promoted by ask-kit smith from ${from.n} questions in ${from.sessions} sessions, e.g. ${JSON.stringify(from.questions[0])}.\n[[actions]]\n` +
      Object.entries(a).map(([k, v]) => `${k} = ${Array.isArray(v) ? `[${v.map(tomlValue).join(", ")}]` : tomlValue(v)}`).join("\n"),
    )
    .join("\n\n");
}

/**
 * The report's "Worth an action" clusters for `kit`, as [[actions]] entries. o: {since, clusters}.
 * Returns {kit, entries, skipped, toml}; nothing is written to the kit.
 */
export async function promote(kit, o = {}) {
  const dir = (await import("./kits.mjs")).findKit(kit);
  if (!dir) throw new Error(`no kit ${kit}`);
  const m = readManifest(dir);
  const clusters = o.clusters ?? (await import("./report.mjs")).report({ since: o.since ?? "30d" }).worthAnAction.filter((c) => c.kit === kit);
  const taken = new Set((m.actions ?? []).map((a) => a.name));
  const have = new Set((m.actions ?? []).map((a) => a.script));
  const entries = [];
  const skipped = [];
  for (const c of clusters) {
    if (have.has(c.script)) {
      skipped.push({ template: c.template, script: c.script, why: `an action already runs ${c.script}` });
      continue;
    }
    const r = actionFrom(c, { taken, acts: [].concat(m.acts ?? []) });
    if (r.skip) skipped.push({ template: c.template, script: c.script, why: r.skip });
    else entries.push(r);
  }
  const { checkActions } = await import("./actions.mjs");
  const problems = checkActions(entries.map((e) => e.action));
  if (problems.length) throw new Error(`promote made an entry kits would refuse: ${problems.join("; ")}`);
  return { kit, dir, entries, skipped, toml: actionsToml(entries) };
}

// ---- install ----

/** Move a draft into the kits folder and enable it. */
export function install(name) {
  const from = path.join(draftsDir(), name);
  if (!fs.existsSync(path.join(from, MANIFEST))) throw new Error(`no draft ${name} in ${draftsDir()}`);
  const to = path.join(CONFIG_DIR, "kits", name);
  if (fs.existsSync(to)) throw new Error(`${to} exists; remove it or draft under another --name`);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  try {
    fs.renameSync(from, to);
  } catch {
    fs.cpSync(from, to, { recursive: true });
    fs.rmSync(from, { recursive: true, force: true });
  }
  const c = loadConfig();
  c.domains = { ...(c.domains ?? {}), [name]: { ...(c.domains?.[name] ?? {}), enabled: true } };
  saveConfig(c);
  return { installed: name, dir: to, next: "Run `ask-kit lines` or restart the agents so `ask` lists it." };
}
