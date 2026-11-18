// Kits with no model: a folder kit of one manifest loads, gets the host's folder scripts and a
// generated API; a cli kit runs its program and refuses what it says it refuses; a module kit
// gets its make(ctx) global with resolved settings; patterns route outright.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ask-kit-kits-"));
process.env.ASK_KIT_CONFIG = path.join(tmp, "config");
process.env.ASK_KIT_STATE = path.join(tmp, "state");
const kits = path.join(tmp, "config", "kits");
const notes = path.join(tmp, "notes");
fs.mkdirSync(notes, { recursive: true });
fs.writeFileSync(path.join(notes, "billing.md"), "# Billing retro\n\nAction items: move the invoice worker to the queue.\n");
fs.writeFileSync(path.join(notes, "api-token.txt"), "invoice worker token abc\n");
const write = (name, files) => {
  fs.mkdirSync(path.join(kits, name), { recursive: true });
  for (const [f, t] of Object.entries(files)) fs.writeFileSync(path.join(kits, name, f), t);
};
write("notes", { "ask-kit.toml": `name = "notes"\nsays = "my notes"\npatterns = ['^notes:']\n[[sources]]\nkind = "folder"\nname = "notes"\npath = "${notes}"\nexclude = ["*token*"]\n` });
write("echo", { "ask-kit.toml": `name = "echo"\nsays = "echo"\nkeywords = ["shout"]\n[[sources]]\nkind = "cli"\nname = "echo"\ncommand = ["${process.execPath}", "-e", "console.log(JSON.stringify(process.argv.slice(1)))"]\nrefuse = [{ args = "secret", why = "it would print one" }]\n` });
write("mod", {
  "ask-kit.toml": `name = "mod"\nsays = "a module"\n[[settings]]\nkey = "MOD_GREETING"\ndefault = "hello"\n[[settings]]\nkey = "MOD_SECRET"\nsecret = true\n[[sources]]\nkind = "module"\nname = "greet"\nmodule = "greet.mjs"\n`,
  "greet.mjs": "export const make = ({ settings }) => ({ say: (n) => `${settings.MOD_GREETING} ${n}` });\n",
});
write("fake", { "ask-kit.toml": `name = "fake"\nsays = "a fake MCP server"\n[[sources]]\nkind = "mcp"\nname = "fake"\ncommand = ["${process.execPath}", "${path.resolve("test/fixtures/kit-mcp/server.mjs")}"]\nallow = ["echo"]\ncaller_env = "FAKE_CALLER"\ncaller_args = { echo = "from" }\n` });
fs.writeFileSync(path.join(tmp, "config", "config.json"), JSON.stringify({ version: 1, sources: [], backends: { default: "x", list: { x: { kind: "api", preset: "ollama", model: "none" } } }, domains: { notes: {}, echo: {}, mod: {} } }));

const { listDomains, loadDomain } = await import("../src/domains.mjs");
assert.ok(["notes", "echo", "mod"].every((k) => listDomains().includes(k)), "kits are listed as domains");

const n = await loadDomain("notes");
const g = n.makeGlobals({ push: () => {}, config: {} });
assert.equal(g.folder, g.notes, "the first folder source is also `folder`");
const find = await import(path.join(n.scriptsDirs[0], "find.mjs"));
const r = await find.default({ ...g }, { topic: "invoice worker" });
assert.equal(r.files[0].file, "billing.md");
assert.equal(r.files.length, 1, "an excluded file is never searched");
assert.throws(() => g.notes.read("api-token.txt"), /excluded/);
await assert.rejects(g.notes.run("cat", "api-token.txt"), /excluded/);
assert.match(fs.readFileSync(n.apiDoc, "utf8"), /declare const notes:/);
assert.match(fs.readFileSync(n.instructions, "utf8"), /path:line/);

const e = await loadDomain("echo");
const eg = e.makeGlobals({ push: () => {}, config: {} });
assert.deepEqual(await eg.echo.json("a", "b"), ["a", "b"]);
await assert.rejects(eg.echo("secret"), /not allowed/);

const m = await loadDomain("mod");
assert.equal(m.makeGlobals({ push: () => {}, config: {} }).greet.say("you"), "hello you");
assert.equal(m.childEnv().MOD_GREETING, "hello");
process.env.MOD_SECRET = "s3";
const m2 = await (await import("../src/kits.mjs")).kitDomain(path.join(kits, "mod"), { config: {} });
m2.makeGlobals({ push: () => {}, config: {} });
assert.equal(process.env.MOD_SECRET, undefined, "a secret setting leaves the environment");
assert.equal(m2.childEnv().MOD_SECRET, "s3", "and still reaches the investigator's server");

process.env.ASK_KIT_CALLER = "caller-session-1";
const f = await loadDomain("fake");
const fg = f.makeGlobals({ push: () => {}, config: {} });
assert.deepEqual(fg.fake.tools().map((t) => t.name), ["echo"], "allow keeps only the listed tools");
assert.deepEqual(await fg.fake.echo({ text: "hi", from: "someone-else" }), { text: "hi", from: "caller-session-1", env: "caller-session-1" }, "acting arguments are the caller's");
await assert.rejects(fg.fake.call("hidden"), /no tool/);
assert.match(fs.readFileSync(f.apiDoc, "utf8"), /echo\(args: \{ text: string \}\)/);
delete process.env.ASK_KIT_CALLER;

write("absent", { "ask-kit.toml": `name = "absent"\nsays = "x"\nrequires = ["no-such-program-ask-kit"]\n[[sources]]\nkind = "cli"\nname = "x"\ncommand = ["no-such-program-ask-kit"]\n` });
assert.match((await loadDomain("absent")).unavailable, /no-such-program-ask-kit/);

const { makeRouter } = await import("../src/router.mjs");
const router = await makeRouter({ ...JSON.parse(fs.readFileSync(path.join(tmp, "config", "config.json"), "utf8")), domains: { notes: {}, echo: {}, mod: {}, absent: {} } });
assert.ok(!router.enabled.includes("absent") && router.skipped.absent, "a kit that cannot run here is not offered");
assert.equal(router.byPattern("notes: billing"), "notes");
assert.equal(router.byRules("shout it"), "echo");
fs.rmSync(tmp, { recursive: true, force: true });
console.log("ok");
process.exit(0);
