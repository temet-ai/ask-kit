// Setup and install bugs, each against throwaway homes: opencode is offered as a client; apply keeps
// the config the answers don't speak to; the Gemini registration follows GEMINI_CLI_HOME; the guide's
// file table is one markdown table; uninstall leaves no empty folders, record or guide; init says why
// an agent was not found; the custom preset can be set up; a key found in a file is kept as a fallback.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ask-kit-setupfix-"));
const home = (...p) => path.join(tmp, ...p);
fs.mkdirSync(home("bin"));
process.env.PATH = home("bin"); // no real agent CLI on PATH
process.env.HOME = tmp;
process.env.ASK_KIT_CONFIG = home("cfg");
process.env.ASK_KIT_STATE = home("state");
process.env.XDG_CONFIG_HOME = home("xdg-config");
process.env.XDG_DATA_HOME = home("xdg-data");
process.env.XDG_STATE_HOME = home("xdg-state");
process.env.CLAUDE_CONFIG_DIR = home(".claude");
process.env.CODEX_HOME = home(".codex");
process.env.COPILOT_HOME = home(".copilot");
process.env.GEMINI_CLI_HOME = home("gemini-home");

const { AGENTS } = await import("../src/providers.mjs");
const { questions } = await import("../src/setup/questions.mjs");
const { plan, apply } = await import("../src/setup/apply.mjs");
const { REGISTER } = await import("../src/setup/register.mjs");
const { installBundle, uninstallBundle, whyNotFound, TARGETS } = await import("../src/setup/bundle.mjs");
const { agentsMd, writeAgentsMd, AGENTS_MD } = await import("../src/agentsmd.mjs");
const { loadConfig, saveConfig } = await import("../src/config.mjs");

const agents = (over = {}) => ({
  "claude-code": { label: "Claude Code", onPath: false, transcripts: null },
  codex: { label: "Codex", onPath: false, transcripts: null },
  "copilot-cli": { label: "GitHub Copilot CLI", onPath: false, transcripts: null },
  "gemini-cli": { label: "Gemini CLI", onPath: false, transcripts: null },
  opencode: { label: "opencode", onPath: false, transcripts: null },
  ...over,
});
const baseD = (over = {}) => ({
  agents: agents(),
  clis: {},
  apis: { openrouter: { label: "OpenRouter", keyFound: false, keyRefs: [] } },
  local: {},
  ...over,
});

// 1. opencode is a client: setup offers it and registers `ask` in its config.
assert.equal(AGENTS.opencode.client, "opencode");
const qd = baseD({ agents: agents({ opencode: { label: "opencode", onPath: true, version: "2.0.1", transcripts: "/x/opencode.db", sessions: 3 } }) });
const clientQ = questions(qd).questions.find((q) => q.id === "clients");
assert.deepEqual(clientQ.options.map((o) => o.value), ["opencode"]);
const opencodeChange = REGISTER.opencode();
opencodeChange.run();
const oc = JSON.parse(fs.readFileSync(home("xdg-config", "opencode", "opencode.json"), "utf8"));
assert.equal(oc.mcp.servers.ask.type, "local");

// 3. Gemini's registration lands in GEMINI_CLI_HOME, where the transcript reader and the bundle look.
const gem = REGISTER["gemini-cli"]();
assert.ok(gem.what.includes(home("gemini-home", "settings.json")), gem.what);
gem.run();
assert.ok(JSON.parse(fs.readFileSync(home("gemini-home", "settings.json"), "utf8")).mcpServers.ask);
assert.ok(!fs.existsSync(home(".gemini")), "nothing under ~/.gemini when GEMINI_CLI_HOME is set");
gem.remove();
assert.equal(JSON.parse(fs.readFileSync(home("gemini-home", "settings.json"), "utf8")).mcpServers.ask, undefined);

// 2. plan() keeps what the person set and the answers don't speak to.
saveConfig({
  version: 1,
  sources: ["codex"],
  clients: ["codex"],
  backends: { default: "mine", list: { mine: { kind: "api", preset: "ollama", model: "qwen3.5:9b" }, "glm-5.3-flash": { kind: "api", preset: "openrouter", model: "z-ai/glm-5.3-flash", key: { env: "OR_KEY" } } } },
  domains: { sessions: { enabled: true, backend: "mine" }, code: { enabled: true }, "ankh-morpork/watch": { enabled: true, backend: "mine" } },
  router: { backend: "glm-5.3-flash", model: "z-ai/glm-5.3-flash-lite" },
  extraSetting: { keep: true },
});
const answers = { investigator: "openrouter:z-ai/glm-5.3-flash", keys: { openrouter: { env: "OR_KEY" } }, domains: ["sessions", "code"], sources: ["codex"], clients: [] };
const kept = plan(answers, baseD(), { dry: true }).config;
assert.equal(kept.router.model, "z-ai/glm-5.3-flash-lite", "router.model kept");
assert.equal(kept.domains.sessions.backend, "mine", "a domain's own backend kept");
assert.deepEqual(kept.domains["ankh-morpork/watch"], { enabled: true, backend: "mine" }, "a domain the person added kept");
assert.ok(kept.backends.list.mine, "a backend the person added kept");
assert.deepEqual(kept.extraSetting, { keep: true });
assert.equal(kept.backends.default, "glm-5.3-flash");
const off = plan({ ...answers, domains: ["sessions"] }, baseD(), { dry: true }).config;
assert.deepEqual(off.domains.code, { enabled: false }, "an unticked built-in domain is turned off");
assert.equal(off.domains["ankh-morpork/watch"].enabled, true);

// The router question: a subscription CLI routes with no API key; the person can pick another
// model, or keywords only; with no answer an earlier router stays.
const subD = baseD({ clis: { "claude-cli": { label: "Claude Code", available: true, signedIn: true }, "codex-cli": { label: "Codex", available: true, signedIn: true } } });
const routerQ = questions(subD).questions.find((q) => q.id === "router");
assert.equal(routerQ.suggested, "investigator");
assert.deepEqual([routerQ.options[0].value, routerQ.options.at(-1).value], ["investigator", "keywords"]);
assert.ok(routerQ.options.some((o) => o.value === "claude-cli:haiku" && /about 4 s per routed question · nothing extra on your subscription/.test(o.note)), JSON.stringify(routerQ.options));
assert.ok(!routerQ.options.some((o) => o.value.startsWith("openrouter:")), "a model with no key is not offered for routing");
const before = loadConfig();
saveConfig({ version: 1, sources: [], backends: { default: "x", list: {} }, domains: {} });
assert.deepEqual(plan({ investigator: "claude-cli:haiku" }, subD, { dry: true }).config.router, { backend: "claude-haiku" }, "Claude Code only: claude -p routes");
assert.deepEqual(plan({ investigator: "codex-cli:", router: "investigator" }, subD, { dry: true }).config.router, { backend: "codex" }, "Codex only: codex routes");
const picked = plan({ investigator: "claude-cli:sonnet", router: "claude-cli:haiku" }, subD, { dry: true }).config;
assert.deepEqual(picked.router, { backend: "claude-haiku" });
assert.ok(picked.backends.list["claude-haiku"], "the router's model is added to the backends");
assert.equal(plan({ investigator: "claude-cli:haiku", router: "keywords" }, subD, { dry: true }).config.router, false);
saveConfig(before);

// Key found in a file: the answer {env} gains the file as a fallback (Codex starts servers with a reduced environment).
const keyFile = home("or.env");
const withFile = baseD({ apis: { openrouter: { label: "OpenRouter", keyFound: true, keyRefs: [{ env: "OPENROUTER_API_KEY" }, { file: keyFile, var: "OPENROUTER_API_KEY" }] } } });
const fb = plan({ investigator: "openrouter:z-ai/glm-5.3-flash", keys: { openrouter: { env: "OPENROUTER_API_KEY" } } }, withFile, { dry: true }).config;
assert.deepEqual(fb.backends.list["glm-5.3-flash"].key, { env: "OPENROUTER_API_KEY", file: keyFile, var: "OPENROUTER_API_KEY" });
const auto = plan({ investigator: "openrouter:z-ai/glm-5.3-flash" }, withFile, { dry: true }).config;
assert.deepEqual(auto.backends.list["glm-5.3-flash"].key, { env: "OPENROUTER_API_KEY", file: keyFile, var: "OPENROUTER_API_KEY" });

// 7. custom: the endpoint comes from answers.custom; a pasted key is stored under its own name.
assert.throws(() => plan({ investigator: "custom:sam-vimes-1", keys: { custom: { env: "WATCH_KEY" } } }, baseD(), { dry: true }), /answers\.custom\.baseUrl/);
const cu = plan({ investigator: "custom:sam-vimes-1", custom: { baseUrl: "https://llm.example.com/v1" }, keys: { custom: { env: "WATCH_KEY" } } }, baseD(), { dry: true }).config;
assert.deepEqual(cu.backends.list["sam-vimes-1"], { kind: "api", preset: "custom", model: "sam-vimes-1", baseUrl: "https://llm.example.com/v1", key: { env: "WATCH_KEY" } });
const nk = plan({ investigator: "custom:sam-vimes-1", custom: { baseUrl: "https://llm.example.com/v1", noKey: true } }, baseD(), { dry: true }).config;
assert.equal(nk.backends.list["sam-vimes-1"].noKey, true);
const r = apply({ investigator: "custom:sam-vimes-1", custom: { baseUrl: "https://llm.example.com/v1" }, keys: { custom: { value: "sk-watch-1" } }, clients: [] }, baseD());
assert.deepEqual(r.config.backends.list["sam-vimes-1"].key, { file: home("cfg", "keys.env"), var: "ASK_KIT_CUSTOM_API_KEY" });
assert.match(fs.readFileSync(home("cfg", "keys.env"), "utf8"), /ASK_KIT_CUSTOM_API_KEY=sk-watch-1/);
assert.ok(!fs.readFileSync(home("cfg", "config.json"), "utf8").includes("sk-watch-1"));
assert.ok(JSON.parse(fs.readFileSync(home("cfg", "config.json"), "utf8")).domains["ankh-morpork/watch"], "apply kept the added domain in the written file");

// 4. The guide's file table is one table: every row follows the header with no break between.
const lines = agentsMd().split("\n");
const head = lines.indexOf("| What | Where |");
assert.ok(head > 0);
let end = head;
while (lines[end]?.startsWith("|")) end++;
const rows = lines.slice(head, end);
assert.ok(rows.length >= 9 && rows.some((l) => l.startsWith("| Journals")) && rows.some((l) => l.startsWith("| ask-kit itself")), rows.join("\n"));
assert.ok(lines.slice(end).every((l) => !l.startsWith("| ")), "no table row outside the table");

// 6. init says why an agent was not found.
fs.mkdirSync(home(".copilot"), { recursive: true });
fs.rmSync(home(".copilot"), { recursive: true });
assert.match(whyNotFound("copilot-cli", { onPath: true }), /on PATH, but it has no home folder yet/);
fs.rmSync(home("gemini-home"), { recursive: true, force: true });
assert.match(whyNotFound("gemini-cli", { onPath: false }), /^not on PATH$/);
fs.mkdirSync(home("gemini-home"), { recursive: true });
assert.match(whyNotFound("gemini-cli", { onPath: false }), /not on PATH \(its folder .* exists\)/);
assert.match(whyNotFound("gemini-cli", { onPath: false, broken: "no version set\nmore" }), /does not run \(no version set\)/);

// 5. uninstall: install into agent homes that exist but are empty, remove, nothing is left behind.
fs.rmSync(home("gemini-home"), { recursive: true });
for (const t of ["claude-code", "codex", "copilot-cli", "opencode"]) fs.mkdirSync(TARGETS[t].base(), { recursive: true });
fs.rmSync(home("cfg", "installed.json"), { force: true });
installBundle(["claude-code", "codex", "copilot-cli", "opencode"]);
writeAgentsMd();
assert.ok(fs.existsSync(home(".claude", "skills")) && fs.existsSync(AGENTS_MD) && fs.existsSync(home("cfg", "installed.json")));
const removed = uninstallBundle({ dry: true });
assert.ok(removed.some((x) => x.path === AGENTS_MD && x.action === "remove"));
assert.ok(fs.existsSync(AGENTS_MD), "dry run removes nothing");
uninstallBundle();
for (const gone of [home(".claude", "skills"), home(".claude", "agents"), home(".claude", "rules"), home(".copilot", "skills"), home(".copilot", "agents"), home(".copilot", "instructions"), home("xdg-config", "opencode", "skill"), home("xdg-config", "opencode", "agent"), AGENTS_MD, home("cfg", "installed.json")]) {
  assert.ok(!fs.existsSync(gone), `left behind: ${gone}`);
}
assert.ok(fs.existsSync(home(".claude")) && fs.existsSync(home("cfg", "config.json")), "the agent's own folder and the config stay");

console.log("ok");
process.exit(0);
