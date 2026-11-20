// Keys and tokens are masked out of what history returns (src/transcripts/scrub.mjs). The fake keys
// are put together at run time so no key-shaped string sits in the repository.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scrubDeep, scrubSecrets } from "../src/transcripts/scrub.mjs";

const x = (n, c = "a1B2") => c.repeat(Math.ceil(n / c.length)).slice(0, n);
const cases = [
  ["OpenAI", `export OPENAI_KEY_FILE=none; curl -d "${"sk-" + "proj-" + x(40)}"`, "sk-proj-[redacted]"],
  ["Anthropic", `key ${"sk-" + "ant-" + x(48)} here`, "sk-ant-[redacted]"],
  ["OpenRouter", `${"sk-" + "or-v1-" + x(64)}`, "sk-or-v1-[redacted]"],
  ["GitHub classic", `token ${"ghp" + "_" + x(36)}`, "ghp_[redacted]"],
  ["GitHub fine-grained", `${"github" + "_pat_" + x(22) + "_" + x(59)}`, "github_pat_[redacted]"],
  ["Slack", `${"xox" + "b-" + "1234-5678-" + x(24)}`, "xoxb-[redacted]"],
  ["AWS", `aws ${"AK" + "IA" + "ABCDEFGHIJ234567"} done`, "AKIA[redacted]"],
  ["Google", `${"AI" + "za" + x(35)}`, "AIza[redacted]"],
  ["Bearer", `-H "Authorization: Bearer ${x(40)}"`, "Bearer [redacted]"],
  ["KEY=", `ANKH_API_KEY=${x(32)} node run.mjs`, "ANKH_API_KEY=[redacted]"],
  ["TOKEN=", `GH_TOKEN="${x(20)}"`, "GH_TOKEN=[redacted]"],
  ["SECRET=", `WATCH_SECRET='${x(16)}'`, "WATCH_SECRET=[redacted]"],
  ["postgres URL", `postgres://vimes:${x(14)}@db.example.com:5432/watch`, "postgres://vimes:[redacted]@db.example.com"],
  ["JSON", `{"apiKey": "${x(30)}"}`, '"apiKey": "[redacted]"'],
  ["PEM", `-----BEGIN RSA PRIVATE KEY-----\n${x(64)}\n-----END RSA PRIVATE KEY-----`, "-----BEGIN RSA PRIVATE KEY----- [redacted]"],
];
for (const [kind, text, want] of cases) {
  const out = scrubSecrets(text);
  assert.ok(out.includes(want), `${kind}: ${out}`);
  assert.ok(!out.includes(x(14)), `${kind}: the value is gone: ${out}`);
}

// Left alone: words, references to a variable, short settings, code.
for (const keep of ["MAX_TOKENS=4000", "GH_TOKEN=$GH_TOKEN", "the token: string field", "const token = getToken();", "sk-learn is a library", "Bearer tokens are checked in auth.mjs"])
  assert.equal(scrubSecrets(keep), keep);

// Every string in an event, its tool input included.
const ev = scrubDeep({ i: 3, role: "tool_call", text: `curl -H "Authorization: Bearer ${x(30)}"`, input: { command: `DATABASE_PASSWORD=${x(20)} psql`, n: 2 } });
assert.equal(ev.i, 3);
assert.match(ev.text, /Bearer \[redacted\]/);
assert.equal(ev.input.command, "DATABASE_PASSWORD=[redacted] psql");
assert.equal(ev.input.n, 2);

// Through history: a made-up Claude Code transcript whose session printed a token.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ask-kit-scrub-"));
const proj = path.join(tmp, "claude", "projects", "-watch-house");
fs.mkdirSync(proj, { recursive: true });
const token = "ghp" + "_" + x(36);
const line = (o) => JSON.stringify({ cwd: "/watch-house", timestamp: "2026-11-17T09:00:00.000Z", ...o });
fs.writeFileSync(
  path.join(proj, "s-0001.jsonl"),
  [
    line({ type: "user", message: { role: "user", content: "why does the roster sync fail?" } }),
    line({ type: "assistant", message: { id: "m1", role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: `GH_TOKEN=${token} gh api /repos` } }] } }),
    line({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: `using ${token} for the sync` }] } }),
  ].join("\n") + "\n",
);
process.env.CLAUDE_CONFIG_DIR = path.join(tmp, "claude");
process.env.ASK_KIT_STATE = path.join(tmp, "state");
const { makeHistory } = await import("../src/transcripts/index.mjs");
const history = makeHistory({ sources: ["claude-code"] });
const hits = await history.grep("sync");
assert.ok(hits.length >= 1, "grep finds the events");
const events = await history.events(hits[0].session);
const shown = JSON.stringify([hits, events]);
assert.ok(!shown.includes(x(36)), "no grep hit or event holds the token");
assert.match(shown, /ghp_\[redacted\]/);
fs.rmSync(tmp, { recursive: true, force: true });
console.log("ok");
