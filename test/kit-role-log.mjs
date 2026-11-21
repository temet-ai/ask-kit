// A kit's role reaches the investigator: a question matching a role's patterns gets one line naming
// it, and one matching none gets no line. kit log lists the asks newest first; kit config-dir names
// the kit's folders. A scripted backend stands in for the model. No network.
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
const CLI = path.join(ROOT, "bin", "ask-kit.mjs");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ask-kit-role-"));
const config = path.join(tmp, "config");
const state = path.join(tmp, "state");
fs.cpSync(path.join(ROOT, "test", "fixtures", "kit-skills"), path.join(config, "kits", "skilled"), { recursive: true });
const fake = await fakeBackend([{ answer: "The Watch House roof is broken (docs/roof.md:1)." }]);
fs.writeFileSync(path.join(config, "config.json"), JSON.stringify({ version: 1, sources: [], backends: { default: "fake", list: { fake: fake.backend } }, domains: { skilled: {} } }));
const env = { ...process.env, ASK_KIT_CONFIG: config, ASK_KIT_STATE: state, ASK_KIT_SESSION: "role-test" };
delete env.ASK_KIT_DOMAIN;

const client = new Client({ name: "test", version: "0" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [CLI, "serve"], env, stderr: "inherit" }));
const firstUser = (i) => fake.requests[i].messages.find((m) => m.role === "user").content;

const a = await client.callTool({ name: "ask", arguments: { question: "why is the roof at the Watch House broken?", early: false } });
assert.ok(!a.isError, a.content?.[0]?.text);
assert.match(firstUser(0), /This question fits the kit's role `triage` \(a question about something failing or broken\): run `skills\.read\("role:triage"\)` first/);
const n = fake.requests.length;
await client.callTool({ name: "ask", arguments: { question: "who looks after the Pseudopolis Yard ledger?", early: false } });
assert.doesNotMatch(firstUser(n), /fits the kit's role/, "no role matches, so no line");
await client.close();
await fake.close();

const log = JSON.parse(execFileSync(process.execPath, [CLI, "kit", "log", "skilled", "--json"], { env, encoding: "utf8" }));
assert.equal(log.length, 2);
assert.match(log[0].question, /Pseudopolis Yard ledger/, "newest first");
assert.equal(log[1].ok, true);
assert.equal(log[1].backend, "fake");
const dirs = JSON.parse(execFileSync(process.execPath, [CLI, "kit", "config-dir", "skilled"], { env, encoding: "utf8" }));
assert.equal(dirs.kit, path.join(config, "kits", "skilled"));
assert.equal(dirs.journals, path.join(state, "skilled"));
assert.equal(dirs.data, null, "no data folder until the kit keeps something");

fs.rmSync(tmp, { recursive: true, force: true });
console.log("ok");
process.exit(0);
