// act: an ask gets the calls that change things only when its caller asked for a change. No model
// and no network: a throwaway config, a fixture kit (folder, module and cli sources, acts, an
// acting [[actions]] entry), a scripted backend on 127.0.0.1, and the real servers over MCP.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ask-kit-act-"));
const config = path.join(tmp, "config");
const state = path.join(tmp, "state");
process.env.ASK_KIT_CONFIG = config;
process.env.ASK_KIT_STATE = state;

// The folder the kit reads (and, with act, writes): a git repository.
const roster = path.join(tmp, "roster");
fs.mkdirSync(roster, { recursive: true });
fs.writeFileSync(path.join(roster, "roster.txt"), "Sam Vimes: Pseudopolis Yard\nAngua: Cable Street\n");
const git = (...a) => execFileSync("git", a, { cwd: roster, stdio: "ignore", env: { ...process.env, GIT_AUTHOR_NAME: "Sam Vimes", GIT_AUTHOR_EMAIL: "vimes@example.com", GIT_COMMITTER_NAME: "Sam Vimes", GIT_COMMITTER_EMAIL: "vimes@example.com" } });
git("init", "-q");
git("add", ".");
git("commit", "-q", "-m", "the roster");
process.env.ASK_KIT_CODE_ROOT = roster;

const kit = path.join(config, "kits", "watch");
fs.mkdirSync(path.join(kit, "scripts"), { recursive: true });
fs.writeFileSync(
  path.join(kit, "ask-kit.toml"),
  `name = "watch"
says = "the Night Watch roster"
acts = ["post.dismiss", "post.promote", "post run bell", "clock ring"]

[[sources]]
kind = "folder"
name = "roster"
path = '${roster}'

[[sources]]
kind = "module"
name = "post"
module = "post.mjs"

[[sources]]
kind = "cli"
name = "clock"
command = ["${process.execPath}", "-e", "console.log(process.argv.slice(1).join(' '))"]

[[actions]]
name = "dismiss"
title = "Dismiss an officer"
script = "dismiss"
match = ['dismiss (?<officer>\\w+)']
acts = true
`,
);
fs.writeFileSync(
  path.join(kit, "post.mjs"),
  "export const make = ({ act }) => ({ act, look: () => 'the roster', dismiss: (n) => `dismissed ${n}`, run: (...a) => `ran ${a.join(' ')}`, call: (name) => `called ${name}` });\n",
);
fs.writeFileSync(path.join(kit, "scripts", "dismiss.mjs"), 'export const meta = { purpose: "dismiss an officer", params: { officer: "string" }, returns: "text" };\nexport default async (g, { officer }) => g.post.dismiss(officer);\n');

// ---- a scripted backend: the cell set before each ask, then an answer quoting its result ----
let cell = "1";
const requests = [];
const server = http.createServer(async (req, res) => {
  let raw = "";
  for await (const c of req) raw += c;
  const body = JSON.parse(raw || "{}");
  requests.push(body);
  const lastMsg = body.messages.at(-1);
  const message =
    lastMsg.role === "tool"
      ? { role: "assistant", content: `result: ${lastMsg.content.split("\n\nAbout")[0]}` }
      : { role: "assistant", content: null, tool_calls: [{ id: `call-${requests.length}`, type: "function", function: { name: "repl", arguments: JSON.stringify({ code: cell }) } }] };
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ choices: [{ message, finish_reason: message.tool_calls ? "tool_calls" : "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0 } }));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const backend = { kind: "api", preset: "custom", baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model: "fake", noKey: true };
fs.writeFileSync(
  path.join(config, "config.json"),
  JSON.stringify({ version: 1, sources: [], backends: { default: "fake", list: { fake: backend } }, domains: { watch: { actions: { dismiss: true } }, code: {} } }),
);

// ---- 1. which requests ask for a change: the caller's words ----
const { asksForChange } = await import("../src/actions.mjs");
for (const q of ["fix the typo in roster.txt", "Please add a test for X", "can you restart the watch service?", "go ahead and commit it", "Run the tests", "record that as a lesson", "message session 1234abcd"])
  assert.ok(asksForChange(q), `asks for a change: ${q}`);
for (const q of ["where is the roster defined?", "how do I fix X?", "why did the build fail", "tell me what calls dismiss", "which session added the roster", "can you check whether Angua is on duty?"])
  assert.ok(!asksForChange(q), `only asks: ${q}`);

// ---- 2. the globals a kit builds, with and without act ----
const { loadDomain } = await import("../src/domains.mjs");
const watch = await loadDomain("watch");
const ro = watch.makeGlobals({ push: () => {}, config: {} });
assert.match(ro.roster.read("roster.txt").text, /Vimes/, "a read-only ask reads");
assert.match(await ro.roster.git("log", "--format=%s"), /the roster/, "and runs git that reads");
assert.throws(() => ro.roster.write("ro.txt", "x"), /repo|roster\.write is off in this ask.*act: true/);
assert.throws(() => ro.roster.edit("roster.txt", "Angua", "Nobby"), /roster\.edit is off in this ask/);
await assert.rejects(ro.roster.run("touch", "ro.txt"), /roster\.run is off in this ask/);
await assert.rejects(ro.roster.git("commit", "-m", "x"), /git\("commit"\) is off in this ask/);
await assert.rejects(ro.roster.git("diff", "--output=ro.txt"), /off in this ask/, "a reading git command that writes a file");
assert.ok(!fs.existsSync(path.join(roster, "ro.txt")), "nothing was written");
assert.equal(ro.post.act, false, "a module's make() is told act");
assert.equal(ro.post.look(), "the roster");
assert.throws(() => ro.post.dismiss("Nobby"), /not in this ask: post\.dismiss changes things/, "an acts entry <source>.<function> is withheld");
assert.throws(() => ro.post.run("bell"), /not in this ask: post: post run bell/, "an acts phrase in a module call is withheld");
assert.equal(ro.post.run("tea"), "ran tea");
assert.throws(() => ro.post.call("promote", { officer: "Nobby" }), /not in this ask: post\.promote/, "a call that names an acts function as its first argument (mcp.call(name))");
assert.equal(ro.post.call("look"), "called look");
assert.equal(ro.post.run("promote the bell"), "ran promote the bell", "only the whole first argument names a function");
await assert.rejects(ro.clock("ring"), /not in this ask: clock: clock ring/, "an acts phrase in a cli call is refused");
assert.equal((await ro.clock("tock")).out.trim(), "tock");

const rw = watch.makeGlobals({ push: () => {}, config: {}, act: true });
assert.deepEqual(rw.roster.write("rw.txt", "x"), { file: "rw.txt", bytes: 1 }, "with act it writes");
assert.equal(rw.post.dismiss("Nobby"), "dismissed Nobby");
assert.equal(rw.post.act, true);
assert.equal((await rw.clock("ring")).out.trim(), "ring");
fs.rmSync(path.join(roster, "rw.txt"));

// The built-in code domain: the same read-only repo.
const code = await loadDomain("code");
const cro = code.makeGlobals({ push: () => {}, config: {} }).repo;
assert.throws(() => cro.write("ro.txt", "x"), /repo\.write is off in this ask/);
await assert.rejects(cro.run("node", "-v"), /repo\.run is off in this ask/);
assert.match(await cro.git("show", "--stat", "HEAD"), /roster\.txt/);
assert.equal(typeof code.makeGlobals({ push: () => {}, config: {}, act: true }).repo.write("rw.txt", "x").bytes, "number");
fs.rmSync(path.join(roster, "rw.txt"));

// An MCP source: a tool named in acts is withheld.
fs.mkdirSync(path.join(config, "kits", "fake"), { recursive: true });
fs.writeFileSync(path.join(config, "kits", "fake", "ask-kit.toml"), `name = "fake"\nsays = "a fake MCP server"\nacts = ["fake.echo"]\n[[sources]]\nkind = "mcp"\nname = "fake"\ncommand = ["${process.execPath}", "${path.join(ROOT, "test/fixtures/kit-mcp/server.mjs")}"]\nallow = ["echo"]\n`);
const fake = await loadDomain("fake");
await assert.rejects(fake.makeGlobals({ push: () => {}, config: {} }).fake.echo({ text: "hi" }), /not in this ask: fake\.echo/);
assert.equal((await fake.makeGlobals({ push: () => {}, config: {}, act: true }).fake.echo({ text: "hi" })).text, "hi");
assert.match(fs.readFileSync(watch.instructions, "utf8"), /work only when the caller asked for a change \(`act: true`\)/, "the investigator is told how act works");

// ---- 3. ask.kit passes the calling ask's act on, never more ----
const { makeAskKit } = await import("../src/kitcall.mjs");
for (const act of [false, true]) {
  const sent = [];
  const k = makeAskKit({ config: {}, from: "watch", act, runnableKits: async () => ["watch", "code"], connect: async () => ({ callTool: async (a) => (sent.push(a.arguments), { content: [{ type: "text", text: "ok" }] }), close: async () => {} }) });
  await k("code", "fix the roster");
  assert.equal(sent[0].act, act, `ask.kit from an ask with act ${act} asks with act ${act}, whatever the question says`);
}

// The real REPL server: ASK_KIT_ACT reaches ask.kit (a stub stands in for the other kit's server).
const stub = path.join(tmp, "stub-server.mjs");
fs.writeFileSync(
  stub,
  `import { McpServer } from ${JSON.stringify(import.meta.resolve("@modelcontextprotocol/sdk/server/mcp.js"))};
import { StdioServerTransport } from ${JSON.stringify(import.meta.resolve("@modelcontextprotocol/sdk/server/stdio.js"))};
import { z } from ${JSON.stringify(import.meta.resolve("zod"))};
const s = new McpServer({ name: "stub", version: "0" });
s.registerTool("ask", { description: "stub", inputSchema: { question: z.string(), act: z.boolean().optional() } }, async ({ act }) => ({ content: [{ type: "text", text: "act=" + act + " env=" + (process.env.ASK_KIT_ACT ?? "unset") }] }));
await s.connect(new StdioServerTransport());
`,
);
const text = (r) => r.content.map((c) => c.text).join("\n");
const base = { ...process.env, ASK_KIT_DOMAIN: "watch", ASK_KIT_SESSION: "act-test", ASK_KIT_KITCALL_SERVER: stub };
delete base.ASK_KIT_ACT;
for (const [env, want] of [[{}, "act=false"], [{ ASK_KIT_ACT: "1" }, "act=true"]]) {
  const c = new Client({ name: "test", version: "0" });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, "src/server.mjs")], env: { ...base, ASK_KIT_INNER: "1", ...env }, stderr: "inherit" }));
  const r = await c.callTool({ name: "repl", arguments: { code: 'await ask.kit("code", "restart everything")' } });
  assert.match(text(r), new RegExp(`${want} env=unset`), "the other kit gets act as an argument, not this process's environment");
  await c.close();
}

// ---- 4. the whole ask: the investigator's REPL is read-only unless the caller asked ----
const WRITE = (f) => `(() => { try { roster.write(${JSON.stringify(f)}, "hi"); return "wrote ${f}"; } catch (e) { return e.message; } })()`;
const outer = new Client({ name: "test", version: "0" });
await outer.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, "src/server.mjs")], env: { ...base, ASK_KIT_SESSION: "act-ask" }, stderr: "inherit" }));
const ask = async (args, file) => {
  cell = WRITE(file);
  return text(await outer.callTool({ name: "ask", arguments: { early: false, ...args } }));
};
const exists = (f) => fs.existsSync(path.join(roster, f));

let a = await ask({ question: "who is on the roster?" }, "a.txt");
assert.match(a, /roster\.write is off in this ask/, "a question gets a read-only REPL");
assert.ok(!exists("a.txt"));
a = await ask({ question: "who is on the roster?", act: true }, "b.txt");
assert.match(a, /wrote b\.txt/, "act: true gives it the acting calls");
assert.ok(exists("b.txt"));
a = await ask({ question: "fix the roster note" }, "c.txt");
assert.match(a, /wrote c\.txt/, "a request that opens with what to do sets act");
a = await ask({ question: "and the next one too", continue: true }, "d.txt");
assert.match(a, /wrote d\.txt/, "a follow-up keeps the act of the ask it continues");
a = await ask({ question: "fix the roster note", act: false }, "e.txt");
assert.match(a, /off in this ask/, "act: false keeps even a request read-only");
assert.ok(!exists("e.txt"));
a = await ask({ question: "and that one", continue: true }, "f.txt");
assert.match(a, /off in this ask/, "and its follow-up");
a = text(await outer.callTool({ name: "ask", arguments: { question: "dismiss Nobby" } }));
assert.match(a, /dismissed Nobby/, "an acting [[actions]] entry the config turned on counts as the caller's request");
await outer.close();
const rows = fs.readFileSync(path.join(state, "watch", "act-ask.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((r) => r.type === "ask");
assert.deepEqual(rows.map((r) => r.act), [false, true, true, true, false, false, true], "every ask row says whether it could act");
const firstSystem = requests.find((b) => b.messages[0].role === "system").messages[0].content;
assert.match(firstSystem, /`act: true`/, "the investigator's instructions say how act works");

// ---- 5. through the router: it sets act from the request ----
const routed = new Client({ name: "test", version: "0" });
await routed.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, "bin/ask-kit.mjs"), "serve"], env: { ...base, ASK_KIT_SESSION: "act-router" }, stderr: "inherit" }));
const viaRouter = async (args, file) => {
  cell = WRITE(file);
  return text(await routed.callTool({ name: "ask", arguments: { about: "watch", early: false, ...args } }));
};
assert.match(await viaRouter({ question: "where is Angua posted?" }, "g.txt"), /off in this ask/);
assert.match(await viaRouter({ question: "please update the roster note" }, "h.txt"), /wrote h\.txt/);
await routed.close();
const routes = fs.readFileSync(path.join(state, "router", "act-router.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
assert.equal(routes[0].actBy, undefined);
assert.deepEqual([routes[1].act, routes[1].actBy], [true, "request"], "the router journals that the request set act");

await new Promise((r) => server.close(r));
fs.rmSync(tmp, { recursive: true, force: true });
console.log("ok");
process.exit(0);
