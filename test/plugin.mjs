// The Claude Code plugin: its copies in plugin/ match the bundle (run `ask-kit plugin build` when
// this fails), every path plugin.json names exists, and with the plugin installed `init` and
// setup leave Claude Code alone, so it never gets the skills or the `ask` server twice.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ask-kit-plugin-"));
process.env.ASK_KIT_CONFIG = path.join(tmp, "cfg");
process.env.ASK_KIT_STATE = path.join(tmp, "state");
process.env.CLAUDE_CONFIG_DIR = path.join(tmp, ".claude");
fs.mkdirSync(path.join(tmp, ".claude", "plugins"), { recursive: true });

const { pluginFiles, installBundle, claudePlugin } = await import("../src/setup/bundle.mjs");
const { REGISTER } = await import("../src/setup/register.mjs");

for (const f of pluginFiles()) {
  const on = path.join(ROOT, f.path);
  assert.ok(fs.existsSync(on), `${f.path} missing: run ask-kit plugin build`);
  assert.equal(fs.readFileSync(on, "utf8"), f.content, `${f.path} is stale: run ask-kit plugin build`);
  assert.ok(!f.content.includes("{{"), `${f.path}: placeholders filled`);
}

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, ".claude-plugin", "plugin.json"), "utf8"));
for (const p of [...manifest.skills, ...manifest.agents]) assert.ok(fs.existsSync(path.join(ROOT, p)), `plugin.json names ${p}`);
const market = JSON.parse(fs.readFileSync(path.join(ROOT, ".claude-plugin", "marketplace.json"), "utf8"));
assert.equal(market.plugins[0].name, manifest.name);

// One version everywhere a release names it: package.json, the plugin and the MCP Registry entry.
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const server = JSON.parse(fs.readFileSync(path.join(ROOT, "server.json"), "utf8"));
assert.equal(manifest.version, pkg.version, "plugin.json version matches package.json");
assert.equal(server.version, pkg.version, "server.json version matches package.json");
assert.equal(server.packages[0].version, pkg.version, "server.json package version matches package.json");
assert.equal(server.name, pkg.mcpName, "server.json name matches package.json mcpName");
const gemini = JSON.parse(fs.readFileSync(path.join(ROOT, "gemini-extension.json"), "utf8"));
assert.equal(gemini.version, pkg.version, "gemini-extension.json version matches package.json");
assert.ok(gemini.mcpServers.ask.args.includes(`${pkg.name}@${pkg.version}`), "gemini-extension.json runs this version of the package");

// Without the plugin, Claude Code gets the bundle as before.
assert.equal(claudePlugin(), null);
assert.equal(installBundle(["claude-code"], { dry: true })[0].action, "write");

// With it, the bundle and the registration both step aside.
fs.writeFileSync(path.join(tmp, ".claude", "plugins", "installed_plugins.json"), JSON.stringify({ version: 2, plugins: { "ask-kit@temet-ai": [{ scope: "user" }] } }));
assert.equal(claudePlugin(), "ask-kit@temet-ai");
assert.deepEqual(installBundle(["claude-code"], { dry: true }).map((r) => r.action), ["skip-plugin"]);
const reg = REGISTER["claude-code"]();
assert.match(reg.what, /plugin already provides/);
reg.run();

fs.rmSync(tmp, { recursive: true, force: true });
console.log("plugin: ok");
