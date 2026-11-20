// An mcp source with many tools is documented by name: the API lists find, describe and call and the
// tool names, signatures come on demand, and a call works. Under the threshold the API is unchanged.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ask-kit-mcpname-"));
process.env.ASK_KIT_CONFIG = path.join(tmp, "config");
process.env.ASK_KIT_STATE = path.join(tmp, "state");
const kits = path.join(tmp, "config", "kits");
const server = path.resolve("test/fixtures/wide-mcp/server.mjs");
const write = (name, extra) => {
  fs.mkdirSync(path.join(kits, name), { recursive: true });
  fs.writeFileSync(path.join(kits, name, "ask-kit.toml"), `name = "${name}"\nsays = "the guild registry"\n[[sources]]\nkind = "mcp"\nname = "guilds"\ncommand = ["${process.execPath}", "${server}"]\ncaller_env = "WIDE_CALLER"\ncaller_args = { guild_3_roster = "from" }\n${extra}`);
};
write("wide", ""); // 40 tools, the default threshold (30)
write("wideall", "by_name_above = 100\n"); // the same 40 tools, listed in full
write("widelow", 'by_name_above = 5\nallow = ["guild_1_roster", "guild_2_roster", "guild_3_roster", "guild_4_roster", "guild_5_roster", "guild_6_roster"]\n');
write("widefew", 'allow = ["guild_1_roster", "guild_3_roster"]\n');
fs.writeFileSync(path.join(tmp, "config", "config.json"), JSON.stringify({ version: 1, sources: [], backends: { default: "x", list: { x: { kind: "api", preset: "ollama", model: "none" } } }, domains: { wide: {}, wideall: {}, widelow: {}, widefew: {} } }));

const { loadDomain } = await import("../src/domains.mjs");
process.env.ASK_KIT_CALLER = "caller-session-1";
const api = async (name) => fs.readFileSync((await loadDomain(name)).apiDoc, "utf8");

const byName = await api("wide");
const full = await api("wideall");
console.log(`API for 40 tools: ${full.length} bytes in full, ${byName.length} by name`);
assert.ok(full.length > 8000 && byName.length < full.length / 3, "by name the API is a fraction of the full one");
assert.match(byName, /find\(word\?: string\)/);
assert.match(byName, /describe\(name: string\)/);
assert.match(byName, /call\(name: string, args\?: Record<string, any>\)/);
assert.match(byName, /Tools: guild_0_roster, guild_1_roster/, "the names are listed");
assert.doesNotMatch(byName, /guild: string/, "signatures are not");
assert.match(full, /guild_0_roster\(args: \{ guild: string/, "a source's own by_name_above keeps its signatures");
assert.match(await api("widelow"), /6 tools/, "by_name_above is per source and counts the allowed tools");
const few = await api("widefew");
assert.match(few, /guild_1_roster\(args: \{ guild: string/, "under the threshold nothing changes");
assert.doesNotMatch(few, /describe\(/);

const g = (await loadDomain("wide")).makeGlobals({ push: () => {}, config: {} }).guilds;
assert.equal(g.tools().length, 40);
const found = g.find("seamstresses");
assert.equal(found.length, 5, "find filters on name and description");
assert.deepEqual(Object.keys(found[0]), ["name", "does"]);
assert.match(found[0].does, /^Roster of the seamstresses guild/);
assert.equal(g.find().length, 40);
const d = g.describe("guild_3_roster");
assert.equal(d.input.properties.guild.type, "string");
assert.equal(d.input.properties.from, undefined, "the argument set to the caller is not offered");
assert.throws(() => g.describe("nope"), /no tool "nope"/);
assert.deepEqual(await g.call("guild_3_roster", { guild: "Fools", note: "hi", from: "someone-else" }), { tool: "guild_3_roster", guild: "Fools", note: "hi", from: "caller-session-1" }, "call works, as the caller");
assert.equal((await g.guild_4_roster({ guild: "Beggars" })).guild, "Beggars", "a tool is still a function");
await assert.rejects(g.call("nope"), /no tool/);

// Under the threshold the global has no find or describe.
const small = (await loadDomain("widefew")).makeGlobals({ push: () => {}, config: {} }).guilds;
assert.equal(small.find, undefined);
assert.equal(small.describe, undefined);
console.log("ok");
process.exit(0);
