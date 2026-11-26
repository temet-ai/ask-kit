// Citation check: a scripted backend answers with good and bad citations, against a fixture repository
// (code domain) and fixture transcripts (sessions domain). The host resolves them with no model:
// the journal row carries { checked, failed, failedList }, the reply carries a bracketed line only
// when something did not resolve, and `ask-kit report` shows the failed rate and flags the asks.
// Also `report --since <sha>`. No network, no model.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fakeBackend } from "./fixtures/shot-kit/fake-backend.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ask-kit-citations-")));
const config = path.join(tmp, "config");
const state = path.join(tmp, "state");
process.env.ASK_KIT_CONFIG = config;
process.env.ASK_KIT_STATE = state;
fs.mkdirSync(config, { recursive: true });

// The repository: src/watch.mjs has five lines (and a final newline).
const repo = path.join(tmp, "watch-repo");
fs.mkdirSync(path.join(repo, "src"), { recursive: true });
fs.writeFileSync(path.join(repo, "src", "watch.mjs"), "// the Watch\nexport const captain = 'Sam Vimes';\nexport const sergeant = 'Fred Colon';\nexport const corporal = 'Nobby Nobbs';\nexport const patrol = [captain, sergeant, corporal];\n");

// The transcripts: a Codex session with the id cx-0001.
const codexHome = path.join(tmp, "codex");
const cwd = path.join(tmp, "work", "shop-api");
fs.mkdirSync(cwd, { recursive: true });
const copy = (from, to) => {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name);
    const b = path.join(to, e.name);
    if (e.isDirectory()) copy(a, b);
    else fs.writeFileSync(b, fs.readFileSync(a, "utf8").replaceAll("__CWD__", JSON.stringify(cwd).slice(1, -1)));
  }
};
copy(path.join(ROOT, "test", "fixtures", "codex"), codexHome);

const fake = await fakeBackend([
  { answer: "Sam Vimes is captain (src/watch.mjs:2), the patrol is built in src/watch.mjs:2-5, and src/watch.mjs:900 and src/gone.mjs:1 are not there. Not files: http://example.com:8080 and 10:30." },
  { answer: "Captain at src/watch.mjs:2; sergeant at `src/watch.mjs:3`." },
  { answer: "Nobody cites anything here." },
  { answer: "The flaky retry test was found in codex cx-0001 #1, #3 and #500, and codex nosuch99 #1; bare #41 has no session." },
  { answer: "The suite ran in codex cx-0001 #2 and #3." },
]);
fs.writeFileSync(path.join(config, "config.json"), JSON.stringify({ version: 1, sources: ["codex"], backends: { default: "fake", list: { fake: fake.backend } }, domains: { code: {}, sessions: {} } }));
const base = { ...process.env, ASK_KIT_CONFIG: config, ASK_KIT_STATE: state, CODEX_HOME: codexHome };
const textOf = (r) => r.content.map((c) => c.text).join("\n");
const rowsOf = (domain, session) => {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(d, e.name));
      else if (e.name === `${session}.jsonl`) out.push(...fs.readFileSync(path.join(d, e.name), "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((r) => r.type === "ask"));
    }
  };
  walk(path.join(state, domain));
  return out;
};
const connect = async (domain, session, extra = {}) => {
  const client = new Client({ name: "test", version: "0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, "src", "server.mjs")], env: { ...base, ASK_KIT_DOMAIN: domain, ASK_KIT_SESSION: session, ...extra }, stderr: "inherit" }));
  return client;
};

// ---- code: path:line and path:line-line ----
const code = await connect("code", "cite-code", { ASK_KIT_CODE_ROOT: repo });
const a1 = textOf(await code.callTool({ name: "ask", arguments: { question: "who is the captain?", early: false } }));
assert.match(a1, /^Sam Vimes is captain \(src\/watch\.mjs:2\)/, "the answer text is unchanged");
assert.ok(a1.endsWith("\n\n[2 of 4 citations did not resolve: src/watch.mjs:900, src/gone.mjs:1]"), a1);
const a2 = textOf(await code.callTool({ name: "ask", arguments: { question: "and the sergeant?", early: false } }));
assert.equal(a2, "Captain at src/watch.mjs:2; sergeant at `src/watch.mjs:3`.", "all resolved: the reply is the answer alone");
const a3 = textOf(await code.callTool({ name: "ask", arguments: { question: "anything else?", early: false } }));
assert.equal(a3, "Nobody cites anything here.");
await code.close();
const codeRows = rowsOf("code", "cite-code");
assert.equal(codeRows.length, 3);
assert.deepEqual(codeRows[0].citations, { checked: 4, failed: 2, failedList: ["src/watch.mjs:900", "src/gone.mjs:1"] });
assert.deepEqual(codeRows[1].citations, { checked: 2, failed: 0 });
assert.equal(codeRows[2].citations, undefined, "nothing cited, nothing journaled");
assert.equal(codeRows[0].answerChars, "Sam Vimes is captain (src/watch.mjs:2), the patrol is built in src/watch.mjs:2-5, and src/watch.mjs:900 and src/gone.mjs:1 are not there. Not files: http://example.com:8080 and 10:30.".length, "answerChars is the investigator's answer, not the reply");

// ---- shortened paths: the file named in full in the answer, else the only one that ends so ----
for (const f of ["src/night/mod.mjs", "src/day/mod.mjs", "src/day/beat.mjs"]) {
  fs.mkdirSync(path.dirname(path.join(repo, f)), { recursive: true });
  fs.writeFileSync(path.join(repo, f), "one\ntwo\n");
}
process.env.ASK_KIT_CODE_ROOT = repo;
const cite = await import("../src/citations.mjs");
const { domain: codeDomain } = await import("../domains/code/domain.mjs");
const short = async (t) => (await cite.checkCitations(t, { ...codeDomain, name: "code" }, {}))?.journal;
assert.deepEqual(await short("See beat.mjs:2, day/mod.mjs:1 and /src/watch.mjs:3."), { checked: 3, failed: 0 });
assert.deepEqual(await short("See mod.mjs:1."), { checked: 1, failed: 1, failedList: ["mod.mjs:1"] }, "two files share the name");
assert.deepEqual(await short("The shift is in src/night/mod.mjs; it starts at mod.mjs:1."), { checked: 1, failed: 0 });
assert.deepEqual(await short("See beat.mjs:9."), { checked: 1, failed: 1, failedList: ["beat.mjs:9"] }, "the line is not there");

// ---- another repository: the one the question names, or a path in the question or answer ----
const tower = path.join(tmp, "semaphore-tower");
fs.mkdirSync(path.join(tower, "src", "relay"), { recursive: true });
execFileSync("git", ["init", "-q", tower]);
fs.writeFileSync(path.join(tower, "src", "relay", "send.mjs"), "// the clacks\nexport const send = (m) => m;\nexport const overhead = 'GNU Terry Pratchett';\n");
const other = async (answer, question) => (await cite.checkCitations(answer, { ...codeDomain, name: "code" }, {}, { question }))?.journal;
const said = "send is at src/relay/send.mjs:2, the overhead at src/relay/send.mjs:3, and the captain at src/watch.mjs:2.";
assert.deepEqual(await other(said, "How does semaphore-tower send a message?"), { checked: 3, failed: 0 }, "the repository the question names, then this one");
assert.deepEqual(await other(said, "How does the clacks send a message?"), { checked: 3, failed: 2, failedList: ["src/relay/send.mjs:2", "src/relay/send.mjs:3"] }, "named nowhere: this repository only");
assert.deepEqual(await other(said, `How does ${tower}/src send a message?`), { checked: 3, failed: 0 }, "a path inside it in the question");
assert.deepEqual(await other(`In ${path.join(tower, "src")}, ${said}`, ""), { checked: 3, failed: 0 }, "a path inside it in the answer");
assert.deepEqual(await other("It is relay/send.mjs:3 and send.mjs:2.", "semaphore-tower: how is a message sent?"), { checked: 2, failed: 0 }, "a shortened path, from that repository's files");
fs.writeFileSync(path.join(tower, "src", "relay", "mod.mjs"), "one\ntwo\n");
fs.mkdirSync(path.join(tower, "src", "tower"), { recursive: true });
fs.writeFileSync(path.join(tower, "src", "tower", "mod.mjs"), "one\ntwo\n");
assert.deepEqual(await other("See mod.mjs:1.", "semaphore-tower?"), { checked: 1, failed: 1, failedList: ["mod.mjs:1"] }, "two of its files share the name");
assert.deepEqual(await other("The relay is relay/mod.mjs; it starts at mod.mjs:1.", "semaphore-tower?"), { checked: 1, failed: 0 }, "the longer path in the answer chooses");
assert.deepEqual(await other("It is src/relay/send.mjs:30.", "semaphore-tower: how is a message sent?"), { checked: 1, failed: 1, failedList: ["src/relay/send.mjs:30"] }, "a line past its end");
assert.deepEqual(cite.namedRepos("semaphore-towers and watch-repo, see http://example.com/a/b", "", repo), [], "a longer word, the repository itself and a URL name nothing");

// ---- sessions: <source> <session> #n, and #m chained after it ----
const sessions = await connect("sessions", "cite-sessions");
const s1 = textOf(await sessions.callTool({ name: "ask", arguments: { question: "who found the flaky test?", early: false } }));
assert.ok(s1.endsWith("\n\n[2 of 4 citations did not resolve: codex cx-0001 #500, codex nosuch99 #1]"), s1);
assert.match(s1, /bare #41 has no session/, "a bare #41 is neither checked nor counted");
const s2 = textOf(await sessions.callTool({ name: "ask", arguments: { question: "what ran?", early: false } }));
assert.equal(s2, "The suite ran in codex cx-0001 #2 and #3.");
await sessions.close();
const sRows = rowsOf("sessions", "cite-sessions");
assert.deepEqual(sRows[0].citations, { checked: 4, failed: 2, failedList: ["codex cx-0001 #500", "codex nosuch99 #1"] });
assert.deepEqual(sRows[1].citations, { checked: 2, failed: 0 });
assert.equal(fake.requests.length, 5, "the check made no model call");
await fake.close();

// ---- the unit: the cap and the time budget ----
const { checkCitations, pathCitations, eventCitations } = await import("../src/citations.mjs");
const many = Array.from({ length: 30 }, (_, i) => `src/watch.mjs:${i + 1}`).join(" ");
assert.equal(pathCitations(many).length, 30);
const capped = await checkCitations(many, { name: "code", makeGlobals: () => ({ repo: { read: () => ({ lines: 99, text: "1\tx" }) } }) }, {}, { max: 20 });
assert.equal(capped.journal.checked, 20, "a given max bounds the check");
const nowhere = Array.from({ length: 60 }, (_, i) => `src/unseen-university-${i + 1}.mjs:${i + 1}`);
const all60 = await checkCitations(nowhere.join(" "), { name: "code", makeGlobals: () => ({ repo: { read: () => { throw new Error("no such file"); } } }) }, {});
assert.equal(all60.line, `\n\n[60 of 60 citations did not resolve: ${nowhere.join(", ")}]`, "every one that did not resolve is named");
assert.equal(all60.journal.failedList.length, 10, "the journal row stays short");
const slow = await checkCitations("src/a.mjs:1 src/b.mjs:2", { name: "code", makeGlobals: () => ({ repo: { read: () => new Promise(() => {}) } }) }, {}, { budgetMs: 100 });
assert.equal(slow, null, "a check that runs out of time counts nothing");
assert.deepEqual(eventCitations("codex 5ca1ab1e #12, #19 and #20; claude-code 11112222 #3").map((c) => c.key), ["codex 5ca1ab1e #12", "codex 5ca1ab1e #19", "codex 5ca1ab1e #20", "claude-code 11112222 #3"]);

// ---- report: the failed rate by domain, flagged asks, and --since <sha> ----
const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "Sam Vimes", GIT_AUTHOR_EMAIL: "vimes@example.com", GIT_COMMITTER_NAME: "Sam Vimes", GIT_COMMITTER_EMAIL: "vimes@example.com", GIT_COMMITTER_DATE: "2026-11-10T12:00:00Z", GIT_AUTHOR_DATE: "2026-11-10T12:00:00Z" } }).trim();
git("init", "-q");
git("add", ".");
git("commit", "-q", "-m", "the Watch");
const sha = git("rev-parse", "--short", "HEAD");
// An old ask, from before the commit, with a failed citation.
const old = { ts: "2026-11-01T00:00:00.000Z", session: "old", type: "ask", question: "an old one", backend: "fake", kind: "api", ok: true, ms: 1000, answerChars: 10, citations: { checked: 1, failed: 1, failedList: ["src/old.mjs:1"] } };
fs.appendFileSync(path.join(state, "code", fs.readdirSync(path.join(state, "code")).find((d) => fs.statSync(path.join(state, "code", d)).isDirectory() && d !== "warm"), "old.jsonl"), JSON.stringify(old) + "\n");
process.chdir(repo);
const { report, parseSince } = await import("../src/report.mjs");
assert.equal(parseSince(sha), Date.parse("2026-11-10T12:00:00Z"), "a sha is its commit date");
assert.equal(parseSince("HEAD"), Date.parse("2026-11-10T12:00:00Z"), "so is a ref");
assert.equal(parseSince("2026-11-05"), Date.parse("2026-11-05"));
assert.throws(() => parseSince("no-such-ref"), /use 24h, 7d, a date, or a git commit sha or ref/);
assert.throws(() => parseSince("--output=x"), /--since/);
const r = report({ since: sha });
assert.equal(r.asks, 5, "the old ask is before the commit");
assert.deepEqual(r.citations.code, { asks: 2, checked: 6, failed: 2, asksWithFailures: 1, failedRate: 0.33 });
assert.deepEqual(r.citations.sessions, { asks: 2, checked: 6, failed: 2, asksWithFailures: 1, failedRate: 0.33 });
const flagged = r.flaggedAsks.filter((a) => a.signals.some((s) => /citations did not resolve/.test(s)));
assert.equal(flagged.length, 2);
assert.ok(flagged.some((a) => a.domain === "code" && a.signals.includes("2 of 4 citations did not resolve: src/watch.mjs:900, src/gone.mjs:1")));
const all = report({ since: "2026-10-30" });
assert.equal(all.asks, 6);
assert.equal(all.citations.code.checked, 7, "an older window adds the old ask's citations");

// The text output from the shell.
const out = execFileSync(process.execPath, [path.join(ROOT, "bin", "ask-kit.mjs"), "report", "--since", sha], { cwd: repo, encoding: "utf8", env: base });
assert.match(out, /Citations that did not resolve: code 2 of 6 \(33%, 1 of 2 asks\), sessions 2 of 6 \(33%, 1 of 2 asks\)/);
assert.match(out, /2 of 4 citations did not resolve: src\/watch\.mjs:900/);

console.log("ok");
process.exit(0);
