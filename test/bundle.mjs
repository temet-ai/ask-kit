// The bundle installer against throwaway agent homes: every agent gets its skills, agent and rule
// in its own format; a reinstall is a no-op; a file the user edited, or one that was never
// ask-kit's, is left alone; rule blocks are added once and replaced in place; uninstall removes
// only what ask-kit wrote. Also: the guide (AGENTS.md) is written with this machine's paths.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ask-kit-bundle-"));
const home = (...p) => path.join(tmp, ...p);
process.env.ASK_KIT_CONFIG = home("cfg");
process.env.ASK_KIT_STATE = home("state");
process.env.CLAUDE_CONFIG_DIR = home(".claude");
process.env.CODEX_HOME = home(".codex");
process.env.COPILOT_HOME = home(".copilot");
process.env.XDG_CONFIG_HOME = home(".config");
process.env.GEMINI_CLI_HOME = home(".gemini");
for (const d of [".claude", ".codex", ".copilot", ".config/opencode"]) fs.mkdirSync(home(d), { recursive: true });
// Gemini is not "installed" here: its folder is missing, so nothing is written for it.
fs.writeFileSync(home(".codex", "AGENTS.md"), "# My own Codex rules\n\nBe brief.\n");
fs.mkdirSync(home(".claude", "skills", "ask-kit-improve"), { recursive: true });
fs.writeFileSync(home(".claude", "skills", "ask-kit-improve", "SKILL.md"), "mine, not ask-kit's\n");

const { installBundle, uninstallBundle, TARGETS } = await import("../src/setup/bundle.mjs");
const { writeAgentsMd, AGENTS_MD } = await import("../src/agentsmd.mjs");

const all = Object.keys(TARGETS);
const first = installBundle(all);
const act = (p) => first.find((r) => r.path === p)?.action;
assert.equal(first.find((r) => r.agent === "gemini-cli").action, "skip-no-agent");
assert.equal(act(home(".claude", "skills", "ask-kit-setup", "SKILL.md")), "write");
assert.equal(act(home(".claude", "skills", "ask-kit-improve", "SKILL.md")), "skip-not-ours");
assert.equal(act(home(".claude", "agents", "ask-kit-tuner.md")), "write");
assert.equal(act(home(".claude", "rules", "ask-kit.md")), "write");
assert.equal(act(home(".codex", "skills", "ask-kit-domain", "SKILL.md")), "write");
assert.equal(act(home(".codex", "AGENTS.md")), "block-add");
assert.equal(act(home(".copilot", "instructions", "ask-kit.instructions.md")), "write");
assert.equal(act(home(".config", "opencode", "agent", "ask-kit-tuner.md")), "write");

// Placeholders filled, formats per agent.
const setup = fs.readFileSync(home(".claude", "skills", "ask-kit-setup", "SKILL.md"), "utf8");
assert.ok(!setup.includes("{{") && setup.includes("bin") && setup.includes(AGENTS_MD), "skill names the command and the guide");
assert.match(fs.readFileSync(home(".claude", "agents", "ask-kit-tuner.md"), "utf8"), /^---\nname: ask-kit-tuner\n[\s\S]*model: sonnet/);
const cop = fs.readFileSync(home(".copilot", "agents", "ask-kit-tuner.md"), "utf8");
assert.ok(cop.startsWith("---\nname: ask-kit-tuner\n") && !/^model:/m.test(cop), "copilot agent drops Claude's model");
assert.match(fs.readFileSync(home(".config", "opencode", "agent", "ask-kit-tuner.md"), "utf8"), /^---\ndescription: .*\nmode: subagent\n---/);
assert.match(fs.readFileSync(home(".copilot", "instructions", "ask-kit.instructions.md"), "utf8"), /^---\napplyTo: "\*\*"\n---\n# Asking instead of digging/);
const codexMd = fs.readFileSync(home(".codex", "AGENTS.md"), "utf8");
assert.ok(codexMd.startsWith("# My own Codex rules") && codexMd.includes("# Asking instead of digging"));

// Again: nothing new, the block replaced in place (still one).
const second = installBundle(all);
assert.ok(second.filter((r) => !r.rule && r.action !== "skip-no-agent" && r.action !== "skip-not-ours").every((r) => r.action === "unchanged"), JSON.stringify(second.filter((r) => r.action !== "unchanged")));
assert.equal(fs.readFileSync(home(".codex", "AGENTS.md"), "utf8").split("# Asking instead of digging").length, 2);

// The user edits one of ours: kept on reinstall and on uninstall.
const edited = home(".copilot", "skills", "ask-kit-setup", "SKILL.md");
fs.appendFileSync(edited, "\nmy note\n");
assert.equal(installBundle(["copilot-cli"]).find((r) => r.path === edited).action, "skip-edited");

const md = writeAgentsMd();
const guide = fs.readFileSync(md, "utf8");
assert.ok(guide.includes("Not set up yet") && guide.includes(path.join(tmp, "cfg", "config.json")), "guide names this machine's config");

const removed = uninstallBundle();
assert.ok(!fs.existsSync(home(".claude", "skills", "ask-kit-setup", "SKILL.md")));
assert.ok(fs.existsSync(edited), "edited file kept");
assert.equal(fs.readFileSync(home(".claude", "skills", "ask-kit-improve", "SKILL.md"), "utf8"), "mine, not ask-kit's\n");
assert.equal(fs.readFileSync(home(".codex", "AGENTS.md"), "utf8").trim(), "# My own Codex rules\n\nBe brief.");
assert.ok(removed.some((r) => r.action === "skip-edited"));
console.log("ok");
