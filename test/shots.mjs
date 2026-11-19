// Shots with no model: `ask` with do: "<kit>.<script>" through the router runs the fixture kit's
// script, returns its result with no backend call and journals shot:true; a continue: true question
// finds the value as shots.<script> in its REPL; `ask-kit run` prints the same output.
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ask-kit-shots-"));
const config = path.join(tmp, "config");
const state = path.join(tmp, "state");
fs.cpSync(path.join(ROOT, "test", "fixtures", "shot-kit"), path.join(config, "kits", "watch"), { recursive: true });

const fake = await fakeBackend([{ code: 'shots.duty.officers.join(", ")' }, { answer: "On duty at Pseudopolis Yard: Sam Vimes, Carrot Ironfoundersson (shots.duty)." }]);
fs.writeFileSync(path.join(config, "config.json"), JSON.stringify({ version: 1, sources: [], backends: { default: "fake", list: { fake: fake.backend } }, domains: { watch: {} } }));
const env = { ...process.env, ASK_KIT_CONFIG: config, ASK_KIT_STATE: state, ASK_KIT_SESSION: "shots-test" };
delete env.ASK_KIT_DOMAIN;
const textOf = (r) => r.content.map((c) => c.text).join("\n");

const client = new Client({ name: "test", version: "0" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, "bin", "ask-kit.mjs"), "serve"], env, stderr: "inherit" }));

// The shot: the script's result, its footer, and no request to the backend.
const shot = await client.callTool({ name: "ask", arguments: { do: "watch.duty", params: { post: "Pseudopolis Yard" } } });
const shotText = textOf(shot);
assert.ok(!shot.isError, shotText);
assert.match(shotText, /"Sam Vimes"/);
assert.doesNotMatch(shotText, /\[watch · shot duty/, "no footer unless config sets footer: true");
assert.doesNotMatch(shotText, /\d+ ms, \d+ call/, "the REPL's timing note is not passed on");
assert.equal(fake.requests.length, 0, "a shot calls no backend");

// An unknown script is refused with the kit's scripts.
const bad = await client.callTool({ name: "ask", arguments: { do: "watch.nope" } });
assert.ok(bad.isError);
assert.match(textOf(bad), /no script "nope".*Its scripts: duty/);

// The journal row: shot:true, no backend, model or cost.
const rows = fs.readFileSync(path.join(state, "watch", "shots-test.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((r) => r.type === "ask");
const row = rows[0];
assert.equal(row.shot, true);
assert.equal(row.do, "duty");
assert.equal(row.ok, true);
assert.deepEqual(row.params, { post: "Pseudopolis Yard" });
for (const k of ["backend", "model", "costUsd", "kind"]) assert.equal(row[k], undefined, `a shot row has no ${k}`);

// A follow-up with a model: told about the shot in one line, and finds shots.duty in its REPL.
const follow = await client.callTool({ name: "ask", arguments: { question: "who is on duty at Pseudopolis Yard?", continue: true } });
assert.ok(!follow.isError, textOf(follow));
assert.match(textOf(follow), /Sam Vimes, Carrot Ironfoundersson/);
const firstUser = fake.requests[0].messages.find((m) => m.role === "user").content;
assert.match(firstUser, /Already in your REPL from shots the caller ran: shots\.duty\./, "the follow-up prompt names the held shot");
const toolResult = fake.requests[1].messages.find((m) => m.role === "tool").content;
assert.match(toolResult, /^Sam Vimes, Carrot Ironfoundersson/m, "shots.duty was already in the REPL");
await client.close();

// From a shell: the same output.
const cli = execFileSync(process.execPath, [path.join(ROOT, "bin", "ask-kit.mjs"), "run", "watch", "duty", "post=Pseudopolis Yard"], { env: { ...env, ASK_KIT_SESSION: "shots-cli" }, encoding: "utf8" }).trim();
const sameish = (t) => t.replace(/ · \d+s\]/, " · Ns]");
assert.equal(sameish(cli), sameish(shotText), "ask-kit run prints what the shot returned");

if (process.env.SHOTS_SHOW) console.log(`--- ask do: watch.duty\n${shotText}\n--- journal row\n${JSON.stringify(row)}\n--- ask-kit run watch duty post="Pseudopolis Yard"\n${cli}\n--- follow-up\n${textOf(follow)}`);
await fake.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log("ok");
process.exit(0);
