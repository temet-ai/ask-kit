// Config `aliases`: other words a caller may give as `about`, so a host (mike-ask) keeps the names
// its callers already use. An alias reaches its domain, is listed in the tool's `about` and its
// description, and one naming a domain that is not enabled, or shadowing a domain's own name, is left out.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fakeBackend } from "./fixtures/shot-kit/fake-backend.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ask-kit-aliases-"));
const config = path.join(tmp, "config");
const state = path.join(tmp, "state");
process.env.ASK_KIT_CONFIG = config;
process.env.ASK_KIT_STATE = state;

const kit = (name) => {
  const dir = path.join(config, "kits", name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "ask-kit.toml"), `name = "${name}"\nsays = "the ${name} of Ankh-Morpork"\n[[sources]]\nkind = "module"\nname = "${name.replace(/-/g, "_")}"\nmodule = "m.mjs"\n`);
  fs.writeFileSync(path.join(dir, "m.mjs"), "export const make = () => ({ roster: () => ['Sam Vimes'] });\n");
};
kit("watch-almanac");
kit("guild");
const fake = await fakeBackend([() => ({ answer: "Answered from the fixture." })]);
const cfg = {
  version: 1,
  sources: [],
  backends: { default: "fake", list: { fake: fake.backend } },
  domains: { sessions: {}, "watch-almanac": {}, guild: {} },
  aliases: { almanac: "watch-almanac", guild: "watch-almanac", gone: "unseen", "Bad Word": "guild" },
};
fs.writeFileSync(path.join(config, "config.json"), JSON.stringify(cfg));

const { makeRouter } = await import("../src/router.mjs");
const r = await makeRouter(cfg);
assert.deepEqual(r.aliases, { almanac: "watch-almanac" }, "an alias of a missing domain, of a domain's own name, or not a name, is left out");

const env = { ...process.env, ASK_KIT_CONFIG: config, ASK_KIT_STATE: state, ASK_KIT_SESSION: "aliases-test" };
delete env.ASK_KIT_DOMAIN;
const client = new Client({ name: "test", version: "0" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, "bin", "ask-kit.mjs"), "serve"], env, stderr: "inherit" }));
const tool = (await client.listTools()).tools.find((t) => t.name === "ask");
assert.deepEqual(tool.inputSchema.properties.about.enum, ["sessions", "watch-almanac", "guild", "almanac"]);
assert.match(tool.description, /it also takes "almanac" for watch-almanac/);

const out = await client.callTool({ name: "ask", arguments: { question: "who is on the night shift?", about: "almanac", early: false } });
assert.ok(!out.isError, out.content.map((c) => c.text).join("\n"));
assert.match(out.content[0].text, /Answered from the fixture/);
const bad = await client.callTool({ name: "ask", arguments: { question: "x", about: "gone" } }).catch((e) => e);
assert.ok(bad instanceof Error || bad.isError, "an alias that was left out is refused");
await client.close();

const rows = fs.readFileSync(path.join(state, "router", "aliases-test.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
assert.deepEqual(rows.map((x) => [x.domain, x.how]), [["watch-almanac", "caller"]]);
assert.ok(fs.existsSync(path.join(state, "watch-almanac", "aliases-test.jsonl")), "the aliased domain's own server answered");

await fake.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log("ok");
process.exit(0);
