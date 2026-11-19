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
write("elsewhere", { "ask-kit.toml": `name = "elsewhere"\nsays = "x"\nplatforms = ["no-such-os"]\n[[sources]]\nkind = "cli"\nname = "x"\ncommand = ["node"]\n` });
assert.match((await loadDomain("elsewhere")).unavailable, /runs on no-such-os/);

// Skills, roles, uses: fixture kits copied into the throwaway config.
const copy = (from, to) => fs.cpSync(from, path.join(kits, to), { recursive: true });
copy("test/fixtures/kit-skills", "skilled");
copy("test/fixtures/kit-uses/base", "base");
copy("test/fixtures/kit-uses/top", "top");
const calls = [];
const sk = await loadDomain("skilled");
const skg = sk.makeGlobals({ push: (c) => calls.push(c), config: {} });
assert.deepEqual(skg.skills.list().map((x) => x.name), ["changelog", "owner", "role:triage", "role:inventory"]);
assert.equal(skg.skills.list()[1].purpose, "Find the owner of a file", "the purpose is the first line");
assert.match(skg.skills.read("owner"), /Step 1/);
assert.match(skg.skills.read("role:triage"), /newest error/);
assert.match(skg.skills.read("inventory"), /names only/, "a role also reads by its bare name");
assert.throws(() => skg.skills.read("nope"), /no skill "nope"/);
assert.deepEqual(calls.map((c) => [c.kind, c.detail]), [["skills", "read owner"], ["skills", "read role:triage"], ["skills", "read role:inventory"]], "reads are journaled");
const text = fs.readFileSync(sk.instructions, "utf8");
assert.match(text, /- `owner`: Find the owner of a file/);
assert.match(text, /- `role:triage`: a question about something failing or broken/);
assert.match(text, /skills\.read\("role:<name>"\)/);
assert.match(fs.readFileSync(sk.apiDoc, "utf8"), /declare const skills:/);
assert.equal(sk.roleFor("why does the build keep failing?").name, "triage");
assert.equal(sk.roleFor("list everything"), null, "a role with no patterns never matches");
console.log(text.slice(text.indexOf("Skills (")));

const top = await loadDomain("top");
assert.equal(top.unavailable, null);
assert.deepEqual(top.uses, ["base"]);
const tg = top.makeGlobals({ push: () => {}, config: {} });
assert.equal(tg.basetool.hello("x"), "base says hi to x", "a used kit's sources are in this REPL");
assert.equal(tg.toptool.ping(), "pong");
assert.ok(top.scriptsDirs.includes(path.join(kits, "base", "scripts")), "and its scripts");
const greet = await import(path.join(kits, "base", "scripts", "greet.mjs"));
assert.equal(await greet.default(tg, { name: "Ann" }), "base says hi to Ann");
const topApi = fs.readFileSync(top.apiDoc, "utf8");
assert.match(topApi, /declare const basetool:/);
assert.equal(topApi.split("declare const scripts:").length, 2, "the toolkit is written once");
assert.match(fs.readFileSync(top.instructions, "utf8"), /Kits used: `base`/);
const cliKit = (name, extra) => write(name, { "ask-kit.toml": `name = "${name}"\nsays = "x"\n${extra}\n[[sources]]\nkind = "cli"\nname = "x"\ncommand = ["node"]\n` });
cliKit("lost", `uses = ["not-installed"]`);
assert.match((await loadDomain("lost")).unavailable, /uses the not-installed kit, which is not installed/);
cliKit("ouro-a", `uses = ["ouro-b"]`);
cliKit("ouro-b", `uses = ["ouro-a"]`);
await assert.rejects(loadDomain("ouro-a"), /uses cycle: ouro-a uses ouro-b uses ouro-a/);
cliKit("bad-role", `[[roles]]\nname = "r"\ninstructions = "missing.md"`);
await assert.rejects(loadDomain("bad-role"), /roles\[0\]\.when[\s\S]*roles\[0\]\.instructions/);
cliKit("blind", `uses = ["absent"]`);
assert.match((await loadDomain("blind")).unavailable, /uses the absent kit, which cannot run here: needs no-such-program-ask-kit/);

const { makeRouter } = await import("../src/router.mjs");
const router = await makeRouter({ ...JSON.parse(fs.readFileSync(path.join(tmp, "config", "config.json"), "utf8")), domains: { notes: {}, echo: {}, mod: {}, absent: {} } });
assert.ok(!router.enabled.includes("absent") && router.skipped.absent, "a kit that cannot run here is not offered");
assert.equal(router.byPattern("notes: billing"), "notes");
assert.equal(router.byRules("shout it"), "echo");
fs.rmSync(tmp, { recursive: true, force: true });
console.log("ok");
process.exit(0);
