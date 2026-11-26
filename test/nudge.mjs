// The plugin's PostToolUse and SubagentStart hooks: fed sample hook JSON, the tool hook prints one
// line after the third lookup in a row and never exits non-zero; the nudge is logged and
// `ask-kit gaps` counts it. No model, no network.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ask-kit-nudge-"));
const env = { ...process.env, ASK_KIT_CONFIG: path.join(tmp, "cfg"), ASK_KIT_STATE: path.join(tmp, "state"), HOME: "/home/vimes" };
process.env.ASK_KIT_CONFIG = env.ASK_KIT_CONFIG;
process.env.ASK_KIT_STATE = env.ASK_KIT_STATE;

// What is enabled: the built-in two, and kits whose manifests name programs and folders. rust also
// requires git; systemd is off, postgres is not in the config and docker cannot run here.
const repo = path.join(tmp, "repo");
fs.mkdirSync(path.join(repo, ".git"), { recursive: true });
const bin = path.join(tmp, "bin");
fs.mkdirSync(bin);
for (const p of ["gh", "cargo", "git", "docker", "psql", "clacks", "coredumpctl", "journalctl", "ssh"]) fs.writeFileSync(path.join(bin, p), "#!/bin/sh\nexit 99\n", { mode: 0o755 });
env.PATH = `${bin}${path.delimiter}${env.PATH}`;
const domains = { code: { enabled: true }, sessions: { enabled: true } };
const kit = (name, { enabled = true, requires = [], keywords = [], reads = [], source, settings } = {}) => {
  const d = path.join(env.ASK_KIT_CONFIG, "kits", name);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, "m.mjs"), "export default () => ({});\n");
  // A detect command the hook must never run.
  fs.writeFileSync(path.join(d, "ask-kit.toml"), `name = "${name}"\nversion = "0.1.0"\nsays = "${name} of the Watch"\nrequires = ${JSON.stringify(requires)}\nkeywords = ${JSON.stringify(keywords)}\nreads = ${JSON.stringify(reads)}\n\n[[settings]]\nkey = "WATCH_${name.replace(/-/g, "_").toUpperCase()}"\nabout = "x"\ndetect = ["touch", ${JSON.stringify(path.join(tmp, "detected"))}]\n\n[[sources]]\n${source ?? `kind = "module"\nname = "m"\nmodule = "m.mjs"`}\n`);
  if (enabled !== null) domains[name] = { enabled, ...(settings ? { settings } : {}) };
};
const save = (d = domains) => {
  fs.mkdirSync(env.ASK_KIT_CONFIG, { recursive: true });
  fs.writeFileSync(path.join(env.ASK_KIT_CONFIG, "config.json"), JSON.stringify({ version: 1, domains: d }));
};
kit("git", { requires: ["git"] });
kit("rust", { requires: ["cargo", "git"] });
kit("github", { requires: ["gh"] });
kit("tests", { keywords: ["tests?", "test suite"] });
kit("sqlite", { keywords: ["sqlite3?", "\\.db\\b", "\\.sqlite3?\\b"] });
kit("logs", { keywords: ["log files?", "\\.log\\b"] });
kit("files", { keywords: ["pdfs?"] });
kit("claude-setup", { keywords: ["hooks?", "settings\\.json"] });
kit("clacks", { keywords: ["semaphores?", "\\.clk\\b"] }); // a kit the hook has no words for
for (const k of ["ops", "mike"]) kit(k);
kit("crash", { requires: ["coredumpctl", "journalctl"] });
kit("systemd", { enabled: false });
kit("postgres", { enabled: null, requires: ["psql"] }); // on disk, not in the config
kit("docker", { requires: ["docker", "octarine-missing-program"] }); // enabled, cannot run here
const rota = path.join(tmp, "rota");
fs.mkdirSync(rota);
kit("rota", { source: `kind = "folder"\nname = "rota"\npath = ${JSON.stringify(rota)}\nabout = "the rota"` });
kit("semaphore", { source: `kind = "mcp"\nname = "semaphore"\ncommand = ["semaphore-mcp"]` });
kit("writing", { source: `kind = "folder"\nname = "w"\npath = "."\nabout = "a relative folder"` });

// Every hook process runs with this: a socket, a name lookup, a fetch or a child process is recorded.
const guard = path.join(tmp, "guard.mjs");
const reached = path.join(tmp, "reached");
fs.writeFileSync(guard, `import fs from "node:fs"; import net from "node:net"; import dns from "node:dns"; import dgram from "node:dgram"; import cp from "node:child_process"; import { syncBuiltinESMExports } from "node:module";
const note = (what) => (...a) => { fs.appendFileSync(${JSON.stringify(reached)}, what + " " + String(a[0]) + "\\n"); throw new Error("offline"); };
net.Socket.prototype.connect = note("connect"); dns.lookup = note("lookup"); dgram.createSocket = note("dgram"); globalThis.fetch = note("fetch");
for (const f of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) cp[f] = note(f);
syncBuiltinESMExports();
`);
env.NODE_OPTIONS = `--import=${guard}`;
// The guard itself works.
const probe = spawnSync(process.execPath, ["-e", 'try { require("net").connect(9, "127.0.0.1") } catch {} try { require("child_process").execFileSync("true") } catch {}'], { env, encoding: "utf8" });
assert.equal(probe.status, 0, probe.stderr);
assert.match(fs.readFileSync(reached, "utf8"), /connect[\s\S]*execFileSync/);
fs.rmSync(reached);

const run = (sub, stdin) => {
  const r = spawnSync(process.execPath, [path.join(ROOT, "bin", "ask-kit.mjs"), "plugin", sub], { input: stdin, env, encoding: "utf8" });
  assert.equal(r.status, 0, `plugin ${sub} exits 0 (stderr: ${r.stderr})`);
  return r.stdout;
};
const given = []; // [session, about] of every nudge the hook printed
const post = (session, tool, input, extra = {}) => {
  const out = run("tool", JSON.stringify({ session_id: session, hook_event_name: "PostToolUse", tool_name: tool, tool_input: input, tool_response: {}, cwd: repo, ...extra }));
  if (out) given.push([session, JSON.parse(out).hookSpecificOutput.additionalContext.match(/about: "([^"]+)"/)[1]]);
  return out;
};

// Before setup nothing is enabled, so nothing is named.
assert.equal(post("s0", "Bash", { command: "rg a src; rg b src; rg c src" }), "");
save();

// Bash rg, Read, Grep: nothing for two, one line on the third.
assert.equal(post("s1", "Bash", { command: "rg -n handler src/" }), "");
assert.equal(post("s1", "Read", { file_path: `${repo}/src/a.mjs` }), "");
const out = post("s1", "Grep", { pattern: "Vimes" });
const j = JSON.parse(out);
assert.equal(j.hookSpecificOutput.hookEventName, "PostToolUse");
assert.equal(j.hookSpecificOutput.additionalContext, 'ask-kit: that is 3 lookups in a row (rg, Read, Grep). One call answers the question behind them outside your context, with its evidence: ask({ about: "code", question: "<the whole question these lookups were for>" }). Add continue: true to follow up.');
assert.equal(out.trim().split("\n").length, 1);

// Not again within the same chain.
assert.equal(post("s1", "Read", { file_path: `${repo}/src/b.mjs` }), "");
assert.equal(post("s1", "Read", { file_path: `${repo}/src/c.mjs` }), "");

// An Edit resets, so a new chain nudges again after three.
assert.equal(post("s1", "Edit", { file_path: `${repo}/src/a.mjs` }), "");
assert.equal(post("s1", "Read", { file_path: `${repo}/src/a.mjs` }), "");
assert.equal(post("s1", "Read", { file_path: `${repo}/src/b.mjs` }), "");
assert.match(post("s1", "Read", { file_path: `${repo}/src/c.mjs` }), /3 lookups in a row/);

// A call to ask resets; a lookup in another session or subagent counts on its own.
post("s2", "Read", { file_path: `${repo}/src/a.mjs` });
post("s2", "Read", { file_path: `${repo}/src/b.mjs` });
assert.equal(post("s2", "mcp__plugin_ask-kit_ask__ask", { question: "where is the watch rota?" }), "");
assert.equal(post("s2", "Read", { file_path: `${repo}/src/c.mjs` }), "");
post("s3", "Read", { file_path: `${repo}/src/a.mjs` }, { agent_id: "agent-1", agent_type: "Explore" });
post("s3", "Read", { file_path: `${repo}/src/b.mjs` }, { agent_id: "agent-1", agent_type: "Explore" });
assert.equal(post("s3", "Read", { file_path: `${repo}/src/c.mjs` }), ""); // the main agent's own counter is at 1
assert.match(post("s3", "Read", { file_path: `${repo}/src/c.mjs` }, { agent_id: "agent-1", agent_type: "Explore" }), /3 lookups in a row/);

// Names the investigator that fits: gh is github, a transcript path is sessions.
for (const c of ["gh pr list", "gh pr view 4", "gh run list"]) var gh = post("s4", "Bash", { command: c });
assert.match(gh, /about: \\"github\\"/);
for (const c of ["ls ~/.claude/projects/x/a.jsonl", "head ~/.claude/projects/x/b.jsonl", "wc -l ~/.claude/projects/x/c.jsonl"]) var se = post("s5", "Bash", { command: c });
assert.match(se, /about: \\"sessions\\"/);

// Lookups batched into one Bash call count one each; a pipeline is one, cd and echo are none.
const about = (o) => JSON.parse(o).hookSpecificOutput.additionalContext.match(/about: "([^"]+)"/)[1];
let n0 = 0;
const bash = (command, extra) => post(`b${n0++}`, "Bash", { command }, extra);
assert.equal(about(bash("cd src && rg -n 'Vimes|Carrot' . ; cat a.mjs\nhead b.mjs")), "code");
assert.match(bash("rg a src; rg b src; git log | head -3"), /3 lookups in a row \(rg x2, git log\)/);
assert.equal(bash("cd src; echo one; rg a | sort | head; cat a.mjs"), ""); // two lookups
post("b-two", "Bash", { command: "rg a src; rg b src" });
assert.match(post("b-two", "Bash", { command: "rg c src" }), /rg x3/);
post("b-act", "Bash", { command: "rg a src; rg b src" });
post("b-act", "Bash", { command: "rg a src; rg b src; git commit -m x" }); // an action in the call resets
assert.equal(post("b-act", "Bash", { command: "rg c src" }), "");

// The kit named is the enabled one that fits the lookups.
const three = (c) => `${c}; ${c}; ${c}`;
for (const [command, want, extra] of [
  [three("git log --oneline -5"), "git"],
  [three("git blame src/a.mjs"), "git"],
  [three("git -C /srv/watch show HEAD"), "git"],
  [three("git grep Vimes"), "code"],
  [three("git show HEAD:src/a.mjs"), "code"],
  [three("cargo tree"), "rust"],
  ["cat Cargo.toml crates/watch/Cargo.toml; head Cargo.lock; cat crates/night/Cargo.toml", "rust"],
  ["cat test/rota.mjs; rg -n assert test/watch.test.mjs; head src/post.spec.ts", "tests"],
  [three("sqlite3 watch.db 'select * from rota'"), "sqlite"],
  ["ls -l data/watch.sqlite; stat data/rota.db; file data/night.sqlite3", "sqlite"],
  ["tail -50 /srv/watch/night.log; rg ERROR /var/log/watch/day.log.1; cat logs/post.log", "logs"],
  ["ls /srv/watch/papers/rota.txt; cat /srv/watch/papers/b.txt; head /srv/watch/papers/c.txt", "files"],
  ["cat towers.clk; rg -n GNU /srv/watch/towers/a.clk; head /srv/watch/towers/b.clk", "clacks"], // a file type only its manifest names
  // Paths of one part, from a directory inside a repository.
  ['ls ~/Documents; find ~/Downloads -name "*.pdf"; du -sh ~/Downloads', "files"],
  ['ls ~/Documents; find ~/Downloads -name "*.pdf"; ls ~', "files"],
  ["ls -la ~/Documents/; ls '~/Pictures'; stat ~/Downloads | head -3", "files"],
  ["ls /tmp; find /tmp -name 'rota*'; stat /tmp/rota.txt", "files"],
  ["ls /etc; cat /etc/hosts; find /etc -name watch.conf", "files"],
  ["ls /; find / -maxdepth 1; ls -d /opt", "files"],
  ["cd ~/Downloads && ls; cd ~ && ls; ls /srv", "files"],
  ["rg /etc src; grep -n /tmp src; rg '/login' src", "code"], // searched for, not looked in
  ["ls src | grep /etc; cat src/a.mjs | sed 's/a/b/'; awk '/tmp/' src/b.mjs", "code"],
  ["ls /rota-none; ls src; cat src/a.mjs", "code"],
  [three("ls"), "files", { cwd: "/srv/watch" }],
  ["cat ~/.claude/settings.json; cat .claude/settings.local.json; cat .mcp.json", "claude-setup"],
  [three("gh pr list"), "github"],
  [three("systemctl status watch"), "ops"], // systemd is turned off
  [three("journalctl -u watch"), "ops"], // crash requires journalctl too
  [three("coredumpctl list"), "crash"],
  [`cat ${rota}/a.md; cat ${rota}/b.md; rg Vimes ${rota}/c.md`, "rota"],
  ["rg 'night.log' src; rg \"rota.sqlite\" src; rg 'settings.json' src", "code"], // a pattern is not a path
  // The whole chain chooses, not its last call.
  ["git log -3; git diff HEAD~1; cat src/a.mjs", "git"],
  ["rg a src; rg b src; git log -1", "code"],
])
  assert.equal(about(bash(command, extra)), want, command);
// The same when each lookup is its own Bash call: silent for two, named on the third.
for (const [commands, want] of [
  [["git log -3", "git show HEAD", "git blame src/a.mjs"], "git"],
  [["cargo tree", "cargo metadata", "cat Cargo.toml"], "rust"],
  [["cat test/rota.mjs", "rg -n assert test/", "head test/watch.test.mjs"], "tests"],
  [["sqlite3 watch.db .tables", "sqlite3 watch.db .schema", "sqlite3 watch.db 'select 1'"], "sqlite"],
  [["tail /srv/watch/a.log", "rg ERROR /srv/watch/a.log", "head /srv/watch/b.log"], "logs"],
  [["ls /srv/watch/a.txt", "cat /srv/watch/b.txt", "cat /srv/watch/c.txt"], "files"],
  [["rg Vimes src", "cat src/a.mjs", "head src/b.mjs"], "code"],
]) {
  const s = `single-${want}`;
  assert.equal(post(s, "Bash", { command: commands[0] }), "", commands[0]);
  assert.equal(post(s, "Bash", { command: commands[1] }), "", commands[1]);
  assert.equal(about(post(s, "Bash", { command: commands[2] })), want, commands.join(" | "));
}
for (const t of ["list_posts", "get_post"]) post("mcp", `mcp__semaphore__${t}`, {});
assert.equal(about(post("mcp", "mcp__semaphore__read_post", {})), "semaphore");
for (let i = 0; i < 4; i++) assert.equal(post("mail", "mcp__tether__inbox", {}), ""); // mail is not a lookup
for (const t of ["list_sessions", "get_session"]) post("mk", `mcp__mike__${t}`, {});
assert.equal(about(post("mk", "mcp__mike__find_text", {})), "mike");
post("grep", "Grep", { pattern: "a", path: "/srv/watch/logs/a.log" });
post("grep", "Grep", { pattern: "b", path: "/srv/watch/logs/a.log" });
assert.equal(about(post("grep", "Grep", { pattern: "c", path: "/srv/watch/logs/b.log" })), "logs");

// Not enabled, not installed or unable to run: never named, and its lookups do not count.
for (const c of ["psql -c 'select 1'", "docker ps"]) assert.equal(bash(three(c)), "", c);
for (const t of ["list_x", "get_x", "read_x"]) assert.equal(post("mcp2", `mcp__clacks__${t}`, {}), "");
const only = (...names) => save(Object.fromEntries(names.map((n) => [n, domains[n]])));
only("code");
for (const [c, want] of [[three("git log"), "code"], ["cat Cargo.toml; cat Cargo.lock; cat Cargo.toml", "code"], ["cat test/a.mjs; cat test/b.mjs; cat test/c.mjs", "code"]]) assert.equal(about(bash(c)), want, c);
for (const c of [three("cargo tree"), three("sqlite3 a.db .tables"), three("gh pr list"), three("systemctl status watch"), "cat /srv/watch/a.txt /srv/watch/b.txt; ls /srv/watch/c.txt; cat /srv/watch/d.txt", "head ~/.claude/projects/x/b.jsonl; ls ~/.claude/projects/x/c.jsonl; cat ~/.claude/projects/x/a.jsonl"]) assert.equal(bash(c), "", c);
save({ code: { enabled: false }, sessions: { enabled: false } });
assert.equal(bash(three("rg a src")), "");
// A broken manifest takes only its own kit away.
fs.writeFileSync(path.join(env.ASK_KIT_CONFIG, "kits", "rust", "ask-kit.toml"), "name = [[[");
save();
assert.equal(about(bash(three("git log"))), "git");
fs.writeFileSync(path.join(env.ASK_KIT_CONFIG, "config.json"), "{{{");
assert.equal(bash(three("git log")), "");
save();
assert.ok(!fs.existsSync(path.join(tmp, "detected")), "no detect command ran");
// The counter keeps kinds of lookup and destinations, no command or path.
const kept = JSON.parse(fs.readFileSync(path.join(env.ASK_KIT_STATE, "nudges", "grep.json"), "utf8"));
assert.deepEqual({ ...kept, at: null }, { n: 3, nudged: true, to: { logs: 3 }, kinds: { Grep: 3 }, at: null });
const before = JSON.parse(fs.readFileSync(path.join(env.ASK_KIT_STATE, "nudges", "s4.json"), "utf8"));
assert.deepEqual(before.to, { github: 3 });

// SubagentStart adds the short rule.
const sub = JSON.parse(run("subagent", JSON.stringify({ session_id: "s1", hook_event_name: "SubagentStart", agent_id: "agent-1", agent_type: "Explore" })));
assert.equal(sub.hookSpecificOutput.hookEventName, "SubagentStart");
assert.match(sub.hookSpecificOutput.additionalContext, /call it before a run of searches/);
assert.match(run("subagent", ""), /SubagentStart/);

// The plugin names both hooks, and its commands exist.
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, ".claude-plugin", "plugin.json"), "utf8"));
for (const [ev, sub] of [["PostToolUse", "tool"], ["SubagentStart", "subagent"]]) {
  const h = manifest.hooks[ev][0].hooks[0];
  assert.equal(h.type, "command");
  assert.deepEqual(h.args.slice(-2), ["plugin", sub]);
  assert.ok(h.timeout <= 10);
}

// A command a kit declares in `reads` is a lookup named for that kit; undeclared, it is an action.
assert.equal(bash(three("mike fleet status watch")), "");
kit("fleet", { reads: ["mike fleet status", "mike fleet list"] });
save();
assert.equal(about(bash(three("mike fleet status watch"))), "fleet");
assert.match(bash("mike fleet list; mike fleet status watch | head; rg a src"), /3 lookups in a row \(mike fleet list, mike fleet status, rg\)[^]*about: \\"fleet\\"/);
assert.equal(bash("mike fleet status watch; mike fleet start watch; mike fleet list"), "", "an undeclared command in the call is an action");
post("fl", "Bash", { command: "mike fleet status watch" });
post("fl", "Bash", { command: "mike fleet list" });
assert.equal(about(post("fl", "Read", { file_path: `${repo}/src/a.mjs` })), "fleet");

// The nudges are logged, and gaps counts them.
const { nudgesSince } = await import("../src/nudge.mjs");
const n = nudgesSince(0);
const by = {};
for (const [, a] of given) by[a] = (by[a] ?? 0) + 1;
assert.equal(n.count, given.length);
assert.equal(n.sessions, new Set(given.map(([x]) => x)).size);
assert.deepEqual(n.by, by); // every nudge printed is logged under the name it gave
for (const k of ["code", "git", "rust", "tests", "sqlite", "logs", "files", "claude-setup", "github", "ops", "crash", "sessions", "rota", "semaphore", "mike", "fleet"]) assert.ok(by[k], `${k} was named`);
for (const k of ["postgres", "docker", "systemd", "writing"]) assert.ok(!by[k], `${k} was never named`);
const { formatReport } = await import("../src/gaps.mjs");
const base = { since: "2026-11-01T00:00:00Z", scanned: { sessions: 0, bySource: {}, fromCache: 0, seconds: 0 }, cost: { basis: "x" }, coverage: { asks: 0, byHand: 0, share: null, tokenShare: null, handSessions: 0, handTokens: 0, handUsd: 0 }, excluded: { mailOrFleet: 0, other: 0 }, skipped: [], noKit: [] };
assert.match(formatReport({ ...base, nudges: n }), new RegExp(`Nudges: the plugin's hook pointed ${n.count} lookup chains at ask in ${n.sessions} sessions`));
assert.match(formatReport({ ...base, nudges: { count: 0, sessions: 0, by: {} } }), /Nudges: none/);

// Broken input and a broken state file never error and never print.
for (const bad of ["", "not json", "null", "[]", "{}", JSON.stringify({ tool_name: "Read" }), JSON.stringify({ session_id: "s6", tool_name: 5 })]) assert.equal(run("tool", bad), "");
const stateDir = path.join(env.ASK_KIT_STATE, "nudges");
fs.writeFileSync(path.join(stateDir, "s7.json"), "{{{ not json");
assert.equal(post("s7", "Read", { file_path: `${repo}/src/a.mjs` }), "");
fs.writeFileSync(path.join(stateDir, "s8.json"), JSON.stringify({ n: "many" }));
assert.equal(post("s8", "Read", { file_path: `${repo}/src/a.mjs` }), "");
// A program run in a container goes to its own kit when that is enabled, else to the docker kit.
kit("docker", { requires: ["docker"] });
save();
const inside = 'docker exec palace-db psql -c "select 1"';
assert.equal(about(bash(three(inside))), "docker");
kit("postgres", { requires: ["psql"] });
save();
assert.equal(about(bash(three(inside))), "postgres");

fs.rmSync(stateDir, { recursive: true });
fs.writeFileSync(stateDir, "a file where the folder should be"); // the state folder cannot be made
assert.equal(post("s9", "Read", { file_path: `${repo}/src/a.mjs` }), "");
fs.rmSync(stateDir);

assert.equal(fs.existsSync(reached) ? fs.readFileSync(reached, "utf8") : "", "", "the hooks open no socket and start no process");
fs.rmSync(tmp, { recursive: true, force: true });
console.log("ok");
process.exit(0);
