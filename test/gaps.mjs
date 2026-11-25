// ask-kit gaps with no real transcripts: Claude Code, Codex and Copilot stores written here with a
// known set of lookup chains, two fixture kits, a forked copy of a session and one investigator
// session. Asserts the chains found, their kit, cost and the coverage report.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ask-kit-gaps-")));
process.env.ASK_KIT_CONFIG = path.join(tmp, "config");
process.env.ASK_KIT_STATE = path.join(tmp, "state");
process.env.CLAUDE_CONFIG_DIR = path.join(tmp, "claude");
process.env.CODEX_HOME = path.join(tmp, "codex");
process.env.COPILOT_HOME = path.join(tmp, "copilot");
process.env.GEMINI_CLI_HOME = path.join(tmp, "gemini");
process.env.OPENCODE_DB = path.join(tmp, "none.db");

const repo = path.join(tmp, "work", "ankh-morpork-watch");
const notes = path.join(tmp, "notes");
fs.mkdirSync(path.join(repo, ".git"), { recursive: true });
fs.mkdirSync(notes, { recursive: true });

// Two kits: clacks (an MCP server) and notes (a folder). github and docker are not installed.
const kit = (name, toml) => {
  fs.mkdirSync(path.join(tmp, "config", "kits", name), { recursive: true });
  fs.writeFileSync(path.join(tmp, "config", "kits", name, "ask-kit.toml"), toml);
};
kit("clacks", `name = "clacks"\nsays = "the clacks towers"\n[[sources]]\nkind = "mcp"\nname = "clacks"\ncommand = ["clacks-mcp"]\n`);
kit("notes", `name = "notes"\nsays = "Lady Sybil's notes"\n[[sources]]\nkind = "folder"\nname = "notes"\npath = "${notes}"\n`);
fs.writeFileSync(path.join(tmp, "config", "config.json"), JSON.stringify({ version: 1, domains: { sessions: { enabled: true }, code: { enabled: true }, clacks: {}, notes: {} } }));

let clock = Date.now() - 2 * 86400_000;
const ts = () => new Date((clock += 1000)).toISOString();
const lines = (rows) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";

// ---- Claude Code ----
function claudeSession(id, cwd, turns) {
  const rows = [];
  let n = 0;
  for (const t of turns) {
    rows.push({ type: "user", timestamp: ts(), cwd, sessionId: id, message: { role: "user", content: t.prompt } });
    for (const m of t.calls) {
      const mid = m.id ?? `msg_${id}_${n++}`;
      const content = m.tools.map(([name, input, tid]) => ({ type: "tool_use", id: tid ?? `toolu_${id}_${n++}`, name, input }));
      rows.push({ type: "assistant", timestamp: ts(), cwd, message: { id: mid, model: "claude-sonnet-4", usage: { input_tokens: 1000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 10 }, content } });
      rows.push({ type: "user", timestamp: ts(), cwd, message: { role: "user", content: content.map((c) => ({ type: "tool_result", tool_use_id: c.id, content: "result text" })) } });
    }
    rows.push({ type: "assistant", timestamp: ts(), cwd, message: { id: `msg_${id}_${n++}`, model: "claude-sonnet-4", content: [{ type: "text", text: "Done." }] } });
  }
  const dir = path.join(tmp, "claude", "projects", cwd.replace(/[/.]/g, "-"));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.jsonl`), lines(rows));
}

const vimes = {
  prompt: "Which pull requests on the watch roster are still open, Sam Vimes asked?",
  calls: [
    { id: "msg_gh_1", tools: [["Bash", { command: "gh pr list" }, "toolu_gh_1"], ["Bash", { command: "gh pr view 12" }, "toolu_gh_2"]] },
    { id: "msg_gh_2", tools: [["Bash", { command: "gh pr checks 12" }, "toolu_gh_3"]] },
  ],
};
claudeSession("11111111-aaaa-4000-8000-000000000001", repo, [
  vimes,
  {
    prompt: "Where does the night shift rota get its duty hours from?",
    calls: [{ tools: [["Read", { file_path: path.join(repo, "src/rota.js") }], ["Grep", { pattern: "duty" }], ["Bash", { command: "rg -n duty src/" }], ["mcp__ask__ask", { question: "where are duty hours set?" }]] }],
  },
  {
    prompt: "Fix the typo in the rota file, the one Carrot found",
    calls: [{ tools: [["Read", { file_path: path.join(repo, "src/rota.js") }], ["Grep", { pattern: "dutty", path: repo }], ["Read", { file_path: path.join(repo, "src/hours.js") }], ["Edit", { file_path: path.join(repo, "src/rota.js") }]] }],
  },
  {
    prompt: '<channel source="tether" from_session="abcdef12-0000">Check the containers at the Patrician\'s palace',
    calls: [{ tools: [["Bash", { command: "docker ps" }], ["Bash", { command: "docker logs palace-web" }], ["Bash", { command: "docker inspect palace-web" }]] }],
  },
  {
    prompt: "What is the status of the cable car at the Unseen University library?",
    calls: [{ tools: [["WebFetch", { url: "https://example.com/uu" }], ["WebSearch", { query: "uu cable car" }], ["WebFetch", { url: "https://example.com/uu/2" }]] }],
  },
  {
    prompt: "What did Lady Sybil's notes say about the dragon sanctuary budget?",
    calls: [{ tools: [["Read", { file_path: path.join(notes, "sanctuary.md") }], ["Read", { file_path: path.join(notes, "budget.md") }], ["Grep", { pattern: "budget", path: notes }]] }],
  },
  { prompt: "Ask about the Guild of Thieves dues for this year", calls: [{ tools: [["mcp__plugin_ask-kit_ask__ask", { question: "thieves guild dues" }]] }] },
]);
// A fork of the first session: same history, same tool ids, started later. Counted once.
claudeSession("22222222-bbbb-4000-8000-000000000002", repo, [vimes]);
// ask-kit's own investigator: never counted.
claudeSession("33333333-cccc-4000-8000-000000000003", path.join(tmp, "state", "warm", "cwd"), [vimes].map((t) => ({ ...t, calls: t.calls.map((c) => ({ tools: c.tools.map(([n, i]) => [n, i]) })) })));

// ---- Codex: exec cells calling tools.exec_command, and a shell call ----
{
  const dir = path.join(tmp, "codex", "sessions", "2026", "11", "18");
  fs.mkdirSync(dir, { recursive: true });
  const t0 = ts();
  const tc = (total, last) => ({ timestamp: ts(), type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { total_tokens: total }, last_token_usage: { input_tokens: last, cached_input_tokens: 0, output_tokens: 5 } } } });
  fs.writeFileSync(path.join(dir, "rollout-2026-11-18-nobby.jsonl"), lines([
    { timestamp: t0, type: "session_meta", payload: { id: "44444444-dddd-4000-8000-000000000004", cwd: repo, timestamp: t0 } },
    { timestamp: ts(), type: "turn_context", payload: { model: "gpt-5" } },
    { timestamp: ts(), type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Which issues did Nobby Nobbs open on the watch repo last week?" }] } },
    { timestamp: ts(), type: "response_item", payload: { type: "custom_tool_call", name: "exec", call_id: "c1", input: 'const r = await Promise.all([tools.exec_command({cmd:"gh issue list --author nobby",workdir:"/x"}), tools.exec_command({cmd:"gh issue view 3"})]);\ntext(r);' } },
    { timestamp: ts(), type: "response_item", payload: { type: "custom_tool_call_output", call_id: "c1", output: "two issues" } },
    tc(1100, 1000),
    tc(1100, 1000),
    { timestamp: ts(), type: "response_item", payload: { type: "function_call", name: "shell", call_id: "c2", arguments: JSON.stringify({ command: ["bash", "-lc", "gh run list"] }) } },
    { timestamp: ts(), type: "response_item", payload: { type: "function_call_output", call_id: "c2", output: "runs" } },
    tc(2300, 1200),
    { timestamp: ts(), type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Two." }] } },
  ]));
}

// ---- Copilot: an MCP server's tools as "<server>-<tool>" ----
{
  const dir = path.join(tmp, "copilot", "session-state", "55555555-eeee-4000-8000-000000000005");
  fs.mkdirSync(dir, { recursive: true });
  const call = (id, tool) => [
    { type: "tool.execution_start", timestamp: ts(), data: { toolCallId: id, toolName: tool, arguments: { tower: "Tump" }, mcpServerName: "clacks" } },
    { type: "tool.execution_complete", timestamp: ts(), data: { toolCallId: id, success: true, result: { content: "x".repeat(400) } } },
  ];
  fs.writeFileSync(path.join(dir, "events.jsonl"), lines([
    { type: "session.start", timestamp: ts(), data: { sessionId: "55555555-eeee-4000-8000-000000000005", startTime: ts(), context: { cwd: repo } } },
    { type: "user.message", timestamp: ts(), data: { content: "Why is the clacks tower at Tump running slow tonight?" } },
    { type: "assistant.turn_start", timestamp: ts(), data: { turnId: "0" } },
    { type: "session.usage_record", timestamp: ts(), data: { usage: { model: "gpt-5", inputTokens: 500, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 } } },
    ...call("p1", "clacks-get_tower"),
    ...call("p2", "clacks-list_messages"),
    ...call("p3", "clacks-get_tower_status"),
    { type: "assistant.message", timestamp: ts(), data: { content: "Fog." } },
  ]));
}

const { scan, report, callsOf, classify, lookupsOf, formatReport } = await import("../src/gaps.mjs");

// The pieces on their own.
assert.deepEqual(callsOf({ tool: "exec", text: 'tools.exec_command({cmd:"git log -3",workdir:"/w"}); tools.apply_patch("*** Begin Patch\\n*** Update File: a.js\\n")' }), [
  { tool: "Bash", arg: "cd /w && git log -3" },
  { tool: "Edit", arg: "a.js" },
]);
assert.deepEqual(callsOf({ tool: "view", input: { path: "/w/a.js" } }), [{ tool: "Read", arg: "/w/a.js" }]);
assert.equal(callsOf({ tool: "clacks-get_tower", server: "clacks", input: {} })[0].tool, "mcp__clacks__get_tower");
for (const t of ["mcp__ask__ask", "mcp__mike-ask__ask", "mcp__plugin_ask-kit_ask__ask"]) assert.equal(classify(t).k, "ask", t);
assert.equal(classify("Bash", 'ask-kit ask "why"').k, "ask");
assert.equal(classify("Bash", "git push").k, "act");
assert.equal(classify("Bash", "gh pr list").k, "look");

// Quoted text, heredocs and substitutions are read as the shell reads them.
const look = (cmd) => assert.equal(classify("Bash", cmd).k, "look", cmd);
const act = (cmd) => {
  assert.equal(classify("Bash", cmd).k, "act", cmd);
  assert.deepEqual(lookupsOf("Bash", cmd), [], cmd);
};
const args = (cmd) => lookupsOf("Bash", cmd).map((l) => l.arg);
for (const cmd of [
  'rg -n "a|b" src',
  "rg -n 'vimes && carrot; nobby || colon' src | head -5",
  'rg -n "vimes\ncarrot" -U src',
  'rg -n "vimes\\"|rm -rf" src',
  "rg -n a\\|b src",
  'grep -n "> /watch/rota" notes.txt 2>&1 | head',
  'grep -n "x" "$(git ls-files | grep "rota|duty")" 2>/dev/null',
  "awk '$3 > 5 {print $1}' rota.txt",
  "awk '{print}' rota.txt # ; rm rota.txt",
  "git grep -n remove src",
  `jq '.watch[] | select(.name=="Vimes" or .rank>3)' rota.json`,
  "cat <<'EOF'\nrm -rf rota; git push | tee x > y\nEOF\nrg duty src",
  "python3 - <<'EOF'\nimport json; print(json.load(open('rota.json'))['a'] > 3)\nEOF",
  `node -e 'const r = require("./rota.json"); console.log(r.a | 1)'`,
  `psql -c "select name from watch where note like '%update%;'"`,
  "ssh pseudopolis-yard 'git log -3; uptime | cut -c1-80'",
  "for f in src/*.js; do head -3 $f; done",
  "ls src | while read f; do wc -l $f; done",
  "diff <(git show a:rota) <(git show b:rota)",
  "find src -name '*.js' -exec grep -n duty {} \\;",
  "rg -l duty | xargs sed -n 1,5p",
  "[[ 3 > 2 && -f rota.js ]] && cat rota.js",
  'docker exec palace-db psql -c "select 1"',
  "timeout 10 rg duty src",
  'rg "ask-kit ask " docs',
])
  look(cmd);
for (const cmd of [
  "rg duty src | tee out.txt",
  "rg duty src > out.txt",
  "rg duty src >> out.txt 2>&1",
  "git show HEAD:rota.js > rota.js",
  "cat > rota.js <<'EOF'\nrg duty\nEOF",
  "sed -i s/a/b/ rota.js",
  "sed -Ei 's/a|b/c/' rota.js",
  'rg duty src && git commit -m "a | b"',
  "rg duty src\nrm rota.js",
  "rg duty src; echo $(rm rota.js)",
  'echo "$(git push)"',
  "bash -c 'rm rota.js'",
  "bash <<'EOF'\nrm rota.js\nEOF",
  "python3 - <<'EOF'\nopen('rota.js', 'w').write('x')\nEOF",
  `node -e 'require("fs").writeFileSync("a", "b")'`,
  `psql -c "delete from watch where name = 'Nobby'"`,
  "ssh pseudopolis-yard 'systemctl restart clacks'",
  "rg -l duty | xargs rm",
  "find . -name '*.tmp' -delete",
  "for f in *.tmp; do rm $f; done",
  'gh pr comment 12 --body "please view the list"',
  "git branch -D night-shift",
])
  act(cmd);

assert.deepEqual(lookupsOf("Read", "/w/rota.js"), [{ arg: "/w/rota.js", fam: "file" }]);
assert.deepEqual(lookupsOf("Edit", "/w/rota.js"), []);
assert.deepEqual(lookupsOf("Bash", "cd /w && rg -n 'duty|shift' src | head -20; git log -3\ndocker ps || df -h"), [
  { arg: "rg -n 'duty|shift' src | head -20", fam: "file", dir: "/w" },
  { arg: "git log -3", fam: "git", dir: "/w" },
  { arg: "docker ps", fam: "machine", dir: "/w" },
  { arg: "df -h", fam: "machine", dir: "/w" },
]);
assert.deepEqual(args("cat a.js | sort | uniq -c | sort -rn"), ["cat a.js | sort | uniq -c | sort -rn"]);
assert.deepEqual(args('export A=1; cd /w; echo "== rota"; printf "a|b\\n"; pwd; true'), [], "cd, export and echo are none");
assert.deepEqual(args("echo '{\"a\":1}' | jq .a"), []);
assert.deepEqual(args('echo ---; cat a.js; echo "--- b; c"; cat b.js'), ["cat a.js", "cat b.js"]);
assert.deepEqual(args("rg -l duty | while read f; do head -1 $f; tail -1 $f; done | sort; git status"), ["rg -l duty | while read f; do head -1 $f; tail -1 $f; done | sort", "git status"], "a loop fed by a pipe is its pipeline");
assert.deepEqual(args("rg duty \\\n  src |\n  head"), ["rg duty \\\n  src |\n  head"], "a continued line");
assert.deepEqual(args("rg duty src &&\n git log -1"), ["rg duty src", "git log -1"]);
assert.deepEqual(args("sqlite3 rota.db <<'EOF'\nselect 1; select 2;\nEOF\ncat a.js").length, 2);
assert.deepEqual(args('echo "$(git log -1)"'), ['echo "$(git log -1)"'], "a lookup inside an echo");
for (const cut of ['rg "duty', "rg $(git log", "cat <<'EOF'\nrota", "rg ${a", "echo `ls", "("]) lookupsOf("Bash", cut);

// A Bash call with three lookups is a chain by itself; cd and echo neither count nor break one.
const { buildChains } = await import("../src/gaps.mjs");
{
  // rg and git are required by kits that are not about them; lantern is one kit's own program.
  for (const [name, req] of [["guards", '["rg", "git", "lantern"]'], ["bursar", '["git", "rg"]'], ["git", '["git"]']]) kit(name, `name = "${name}"\nsays = "x"\nrequires = ${req}\n[[sources]]\nkind = "folder"\nname = "${name}"\npath = "${tmp}/${name}"\n`);
  const { kitRules, targetOf } = await import("../src/gaps.mjs");
  const rules = kitRules({ version: 1, domains: { code: {}, guards: {}, bursar: {}, git: {} } });
  const to = (arg) => targetOf({ tool: "Bash", arg, fam: "file", paths: [] }, rules, repo);
  assert.equal(to("rg duty src"), "code");
  assert.equal(to("lantern list"), "guards");
  assert.equal(to("git log -3"), "git");
  assert.equal(to("git grep duty"), "code");
  for (const name of ["guards", "bursar", "git"]) fs.rmSync(path.join(tmp, "config", "kits", name), { recursive: true });
}
const use = (arg) => ({ turn: 0, prompt: "Where is the night rota?", ts: "2026-11-18T00:00:00Z", tool: "Bash", arg, req: arg, chars: 300 });
const batched = buildChains([use("cd notes && cat a.md; rg 'duty|rota' x.md; git log -2")], { cwd: "/w" }).chains;
assert.equal(batched.length, 1);
assert.deepEqual(batched[0].uses.map((u) => [u.fam, u.shape, u.chars, u.paths]), [["file", "cat", 100, ["/w/notes/a.md"]], ["file", "rg", 100, ["/w/notes/x.md"]], ["git", "git log", 100, []]]);
const { shellEdits } = await import("../src/gaps.mjs");
assert.deepEqual(shellEdits("sed -i 's/a/b/' src/rota.mjs"), ["src/rota.mjs"]);
assert.deepEqual(shellEdits("python3 - <<'E'\nopen('rota.md','w').write('x')\nE"), [""]);
assert.deepEqual(shellEdits("cat > src/rota.mjs <<'E'\nx\nE"), ["src/rota.mjs"]);
assert.deepEqual(shellEdits("cat > /tmp/run.mjs <<'E'\nx\nE"), []);
assert.deepEqual(shellEdits("cargo test | head; git push"), []);
assert.equal(buildChains([use("cat a.md; cat b.md; cat c.md"), { ...use("sed -i 's/a/b/' d.md"), ts: "9" }]).chains[0].purpose, "find-then-edit", "a shell edit is an edit");
const asked = buildChains([use("cat a.md"), { ...use(""), tool: "mcp__ask__ask", id: "ask1" }, { ...use("cat b.md; cat c.md"), says: "Read the rota" }, { ...use("cat d.md"), says: "Read the rota" }]).chains;
assert.deepEqual([asked.length, asked[0].afterAsk, asked[0].says], [1, "ask1", ["Read the rota"]], "a chain knows the ask before it and what its calls were for");
assert.equal(buildChains([use("cat a.md | sort | uniq | head")]).chains.length, 0, "a pipeline counts once");
assert.equal(buildChains([use("cat a.md"), use("echo ok"), use("cat b.md; cat c.md")]).chains[0].uses.length, 3);

const sc = await scan({ since: "30d" });
const byPrompt = (re) => sc.chains.filter((c) => re.test(c.prompt));

assert.equal(sc.sessions, 4, "the investigator session is left out");
assert.equal(byPrompt(/Sam Vimes/).length, 1, "a forked session's copy of a chain counts once");
assert.equal(byPrompt(/Sam Vimes/)[0].session, "11111111-aaaa-4000-8000-000000000001", "in the session that made it");

const vimesChain = byPrompt(/Sam Vimes/)[0];
assert.equal(vimesChain.kit, "github");
assert.equal(vimesChain.purpose, "to-answer");
assert.equal(vimesChain.end, "turn-end");
assert.equal(vimesChain.n, 3);
assert.equal(vimesChain.tokens, 2020, "two model calls, each counted once");
assert.ok(vimesChain.measured);

const rota = byPrompt(/duty hours/)[0];
assert.equal(rota.end, "ask");
assert.equal(rota.kit, "code", "a Grep with no path is the session's repository");
assert.equal(byPrompt(/typo/)[0].purpose, "to-do", "a chain whose file is edited after it is not to-answer");
assert.equal(byPrompt(/palace/)[0].kit, "docker");
assert.match(byPrompt(/palace/)[0].prompt, /^\[mail from abcdef12\]/);
assert.equal(byPrompt(/cable car/)[0].kit, "web");
assert.equal(byPrompt(/Sybil/)[0].kit, "notes", "a folder source's path");

const codex = sc.chains.find((c) => c.source === "codex");
assert.equal(codex.n, 3, "two exec_command calls in one cell and one shell call");
assert.equal(codex.kit, "github");
assert.equal(codex.tokens, 1005 + 1205, "a repeated token_count is counted once");

const copilot = sc.chains.find((c) => c.source === "copilot-cli");
assert.equal(copilot.kit, "clacks", "an MCP server a kit runs");
assert.equal(copilot.tokens, 505);

assert.equal(sc.asks.length, 2);
assert.deepEqual(sc.asks.map((a) => a.after).sort(), [0, 3]);

const r = report(sc);
assert.equal(r.coverage.asks, 2);
assert.equal(r.coverage.byHand, 6, "github x2, docker, web, notes, clacks");
assert.equal(r.coverage.share, +(2 / 8).toFixed(3));
assert.deepEqual(r.excluded, { mailOrFleet: 1, other: 0 });
const skipped = Object.fromEntries(r.skipped.map((x) => [x.kit, x]));
assert.deepEqual(Object.keys(skipped).sort(), ["clacks", "notes"], "github and docker are not installed here");
assert.equal(skipped.clacks.examples[0].prompt, "Why is the clacks tower at Tump running slow tonight?");
const noKit = Object.fromEntries(r.noKit.map((x) => [x.source, x]));
assert.equal(noKit.github.chains, 2);
assert.equal(noKit.github.sessions, 2);
assert.equal(noKit.web.chains, 1);
assert.equal(noKit.docker, undefined, "a chain started by mail is not demand for a kit");
assert.equal(r.noKit[0].source, "github", "ranked by sessions x tokens");
assert.match(formatReport(r), /Coverage: 2 asks against 6 lookup chains/);

// A second scan reads the cache.
const again = await scan({ since: "30d" });
assert.equal(again.cached, 4);
assert.equal(again.chains.length, sc.chains.length);

fs.rmSync(tmp, { recursive: true, force: true });
console.log("ok");
