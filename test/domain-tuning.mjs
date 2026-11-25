import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fakeBackend } from "./fixtures/shot-kit/fake-backend.mjs";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ask-domain-tuning-"));
process.env.ASK_KIT_CONFIG = path.join(tmp, "config");
process.env.ASK_KIT_STATE = path.join(tmp, "state");
const { makeRepo } = await import("../domains/code/repo.mjs");
const { default: overview } = await import("../domains/code/scripts/overview.mjs");
const { default: lookup, named, bodyEnd } = await import("../domains/code/scripts/lookup.mjs");
const { domain: code } = await import("../domains/code/domain.mjs");
const { matchAction, openerFor, shapeProblem } = await import("../src/actions.mjs");
const { default: where } = await import("../domains/code/scripts/where.mjs");
const { default: digest } = await import("../domains/sessions/scripts/session-digest.mjs");

try {
  const folder = path.join(tmp, "watch");
  fs.mkdirSync(path.join(folder, "src"), { recursive: true });
  fs.mkdirSync(path.join(folder, "node_modules", "lantern"), { recursive: true });
  fs.writeFileSync(path.join(folder, "README.md"), "# The Watch\n");
  fs.writeFileSync(path.join(folder, "src", "lantern.mjs"), "export const lantern = 'brass';\n");
  fs.writeFileSync(path.join(folder, "node_modules", "lantern", "package.json"), "{}");
  const repo = makeRepo({ root: folder, push() {} });
  const listed = await repo.files(["**/*.mjs", "!**/node_modules/**"]);
  assert.deepEqual([...listed], ["src/lantern.mjs"]);
  const plain = await overview({ repo }, {});
  assert.equal(plain.files, 2);
  assert.equal(plain.complete, true);
  assert.equal(plain.docs[0].file, "README.md");
  assert.deepEqual(plain.recent, []);
  assert.match(plain.recentError, /not a git repository/);
  assert.deepEqual(plain.manifests, []);

  const git = (...args) => execFileSync("git", args, { cwd: folder, stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-b", "main");
  git("-c", "user.name=Sam Vimes", "-c", "user.email=vimes@example.com", "commit", "--allow-empty", "-m", "Start the watch");
  const tracked = await overview({ repo }, {});
  assert.match(tracked.recent[0], /Start the watch/);
  assert.equal(tracked.recentError, undefined);

  const session = { source: "codex", id: "watch-session", project: "watch", title: "Lanterns" };
  const replies = Array.from({ length: 45 }, (_, i) => ({ i, role: "assistant", text: `Lantern ${i}` }));
  const history = { events: async () => Object.assign([...replies], { total: replies.length, session }) };
  const long = await digest({ history }, { session: session.id });
  assert.equal(long.events, 45);
  assert.equal(long.repliesSkipped, 15);
  assert.equal(long.replies.length, 30);
  assert.ok(long.replies.every((r) => typeof r.text === "string"));
  assert.equal(long.replies[0].text, "Lantern 0");
  assert.equal(long.replies.at(-1).text, "Lantern 44");
  assert.doesNotThrow(() => long.replies.map((r) => r.text.slice(0, 8)));
  const short = await digest({ history: { events: async () => Object.assign(replies.slice(0, 3), { total: 3, session }) } }, { session: session.id });
  assert.equal(short.replies.length, 3);
  assert.equal(short.repliesSkipped, undefined);
  // The commonest code question: what is X, what does it do, what calls it.
  fs.writeFileSync(path.join(folder, "src", "rota.mjs"), [
    "// How long Angua waits before relieving a post.",
    "export function relievePost(post,",
    "  officer,",
    ") {",
    "  if (!officer) {",
    "    throw new Error('no relief tonight');",
    "  }",
    "  return { post, officer };",
    "}",
    "",
    "export const NIGHT_LIMIT = 4;",
  ].join("\n") + "\n");
  fs.writeFileSync(path.join(folder, "src", "patrol.mjs"), [
    'import { relievePost, NIGHT_LIMIT } from "./rota.mjs";',
    "export async function walkTheBeat(officers) {",
    "  const done = officers.slice(0, NIGHT_LIMIT).map((o) => {",
    "    const relief = relievePost('Cable Street', o);",
    "    return relief;",
    "  });",
    "  return done;",
    "}",
  ].join("\n") + "\n");
  const asked = "Where is relievePost defined, what does it do without an officer, and what calls it? Also what is `NIGHT_LIMIT`?";

  // Before: search, read what was found, read the caller. Three cells, since each needs the last.
  let cells = 0;
  const cell = async (fn) => (cells++, fn());
  const w = await cell(() => where({ repo }, { name: "relievePost" }));
  const body = await cell(() => repo.read(w.definitions[0].file, { from: w.definitions[0].line, to: w.definitions[0].line + 10 }));
  const use = w.uses.find((u) => u.text.includes("'Cable Street'"));
  const caller = await cell(() => repo.read(use.file, { from: 1, to: use.line }));
  assert.equal(cells, 3);
  // After: one lookup holds every line those three showed.
  const one = await lookup({ repo }, { question: asked });
  for (const line of [...body.text.split("\n").slice(0, 8)]) assert.ok(one.includes(line), `the body is whole: ${line}`);
  assert.match(one, /relievePost defined: src\/rota\.mjs:1-9/);
  assert.match(one, /1\t\/\/ How long Angua waits/);
  assert.match(caller.text, /2\texport async function walkTheBeat/);
  assert.match(one, /src\/patrol\.mjs:4 \[in function walkTheBeat\] const relief = relievePost/, "the use names the function around it, not the local it is assigned to");
  assert.match(one, /NIGHT_LIMIT defined: src\/rota\.mjs:11-11\n11\texport const NIGHT_LIMIT = 4;/);
  assert.match(one, /src\/patrol\.mjs:3 \[in function walkTheBeat\]/);
  assert.doesNotMatch(one, /Not shown/);
  assert.match(await lookup({ repo }, { names: ["relieve_post"] }), /relievePost/, "another spelling finds it");
  assert.equal(await lookup({ repo }, { question: "How many officers are there?" }), null);
  assert.match(await lookup({ repo }, { question: "relievePost and dismissPost" }), /Not found: dismissPost/);
  assert.match(await lookup({ repo }, { question: 'what throws "no relief tonight", and what is in src/patrol.mjs?' }), /rota\.mjs:6 throw new Error[\s\S]*/);
  assert.match(await lookup({ repo }, { question: "see src/patrol.mjs:4" }), /## src\/patrol\.mjs:1-9\n1\timport/);
  const n = named("In `Watch::relieve()` and (walkTheBeat) see src/rota.mjs:11, /srv/city and \"no relief tonight\"");
  assert.deepEqual(n.names, ["relieve", "walkTheBeat"]);
  assert.deepEqual([n.files, n.folders, n.quotes], [["src/rota.mjs:11"], ["/srv/city"], ["no relief tonight"]]);
  assert.equal(bodyEnd(["fn a(", "    x: u8,", ") -> u8", "where", "    u8: Copy,", "{", "    x", "}", "fn b() {}"], 1), 8);
  assert.equal(bodyEnd(["def a():", "    x = 1", "", "    return x", "", "def b():"], 1), 4);

  // What does not fit is named with how to read it, and the result stays within its budget.
  fs.writeFileSync(path.join(folder, "src", "long.mjs"), `export function longWatch() {\n${"  patrolTheShades('all night long');\n".repeat(300)}}\n`);
  const big = await lookup({ repo }, { names: ["longWatch", "patrolTheShades"] });
  assert.ok(big.length <= 3900, `${big.length}`);
  assert.match(big, /longWatch defined src\/long\.mjs:1 `export function longWatch\(\) \{`: repo\.read\("src\/long\.mjs", \{ from: 1, to: 302 \}\)/);
  assert.match(big, /patrolTheShades used: 300 lines in 1 files/);
  assert.match(big, /patrolTheShades: \d+ more uses, in src\/long\.mjs \(\d+\)/);
  assert.match(await lookup({ repo }, { names: ["longWatch"], budget: 20000 }), /\n302\t\}/, "a larger budget gives the whole body");

  // The opener: run before the first model call, never an answer by itself.
  assert.equal(matchAction(code.actions, asked), null);
  const opener = openerFor(code.actions, asked);
  assert.equal(opener.params.question, asked);
  assert.equal(shapeProblem(opener.action, "null"), "empty");
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const fake = await fakeBackend([{ answer: "relievePost is at src/rota.mjs:2 (called at src/patrol.mjs:4)." }]);
  fs.mkdirSync(process.env.ASK_KIT_CONFIG, { recursive: true });
  fs.writeFileSync(path.join(process.env.ASK_KIT_CONFIG, "config.json"), JSON.stringify({ version: 1, sources: [], backends: { default: "fake", list: { fake: fake.backend } }, domains: { code: {} } }));
  const client = new Client({ name: "test", version: "0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, "src", "server.mjs")], env: { ...process.env, ASK_KIT_DOMAIN: "code", ASK_KIT_SESSION: "tuning-test", ASK_KIT_CODE_ROOT: folder }, stderr: "inherit" }));
  try {
    const r = await client.callTool({ name: "ask", arguments: { question: asked } });
    assert.ok(!r.isError, r.content[0].text);
    assert.equal(fake.requests.length, 1, "one model call: the data was there before it");
    const first = fake.requests[0].messages.findLast((m) => m.role === "user").content;
    assert.ok(first.includes(one), "the first message holds the whole lookup");
    assert.match(fake.requests[0].messages[0].content, /scripts\.run\("lookup", \{ names:/);
    await client.callTool({ name: "ask", arguments: { question: "How many officers are there?" } });
    assert.doesNotMatch(fake.requests[1].messages.findLast((m) => m.role === "user").content, /Run for you before/, "a question that names nothing gets nothing added");
  } finally {
    await client.close();
    fake.close();
  }
  console.log("ok");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
