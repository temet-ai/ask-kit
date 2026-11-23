// Setup without touching the real machine: a made-up detection, answers through plan(), and the
// Codex and Copilot registrations written twice into throwaway homes (the second write must
// replace, not duplicate).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ask-kit-setup-"));
process.env.ASK_KIT_CONFIG = path.join(tmp, "config");
process.env.ASK_KIT_STATE = path.join(tmp, "state");
process.env.CODEX_HOME = path.join(tmp, "codex");
process.env.COPILOT_HOME = path.join(tmp, "copilot");
fs.mkdirSync(process.env.CODEX_HOME);
fs.writeFileSync(path.join(process.env.CODEX_HOME, "config.toml"), 'model = "gpt-6"\n\n[mcp_servers.other]\ncommand = "x"\n');

const { questions, investigatorChoices } = await import("../src/setup/questions.mjs");
const { plan, apply, backendName } = await import("../src/setup/apply.mjs");

// Codex and Copilot only, no API key, Ollama running: the conversation a ChatGPT-plan user has.
const d = {
  agents: {
    "claude-code": { label: "Claude Code", onPath: false, transcripts: null },
    codex: { label: "Codex", onPath: true, version: "codex-cli 0.170.0", transcripts: "/x/.codex/sessions", sessions: 62 },
    "copilot-cli": { label: "GitHub Copilot CLI", onPath: true, version: "1.0.113", transcripts: "/x/.copilot/session-state", sessions: 149 },
    "gemini-cli": { label: "Gemini CLI", onPath: false, transcripts: null },
    opencode: { label: "opencode", onPath: false, transcripts: null },
  },
  clis: {
    "claude-cli": { label: "Claude Code", available: false },
    "codex-cli": { label: "Codex CLI", available: true, signedIn: true },
    "copilot-cli": { label: "Copilot CLI", available: true, signedIn: true },
  },
  apis: { openrouter: { label: "OpenRouter", keyFound: false, keyRefs: [] }, openai: { label: "OpenAI API", keyFound: false, keyRefs: [] } },
  local: { ollama: { label: "Ollama (local)", running: true, models: ["qwen3.5:9b", "nomic-embed-text:latest"] }, lmstudio: { running: false, models: [] } },
};

const { questions: qs, suggested } = questions(d);
assert.deepEqual(qs.map((q) => q.id), ["sources", "clients", "investigator", "extras", "router", "domains"]);
assert.deepEqual(suggested.sources, ["codex", "copilot-cli"]);
assert.deepEqual(suggested.clients, ["codex", "copilot-cli"]);
// No key anywhere: the first ready choice is the Codex subscription, not an API that needs a key.
assert.equal(suggested.investigator, "codex-cli:");
const ids = investigatorChoices(d).map((c) => c.id);
assert.ok(ids.includes("ollama:qwen3.5:9b") && !ids.some((i) => i.includes("embed")), "embedding models are not investigators");
assert.equal(backendName("openrouter:z-ai/glm-5.3-flash"), "glm-5.3-flash");

// An API without a key found must get one from the answers.
assert.throws(() => plan({ ...suggested, investigator: "openrouter:z-ai/glm-5.3-flash" }, d), /no key for OpenRouter/);
const p = plan({ ...suggested, investigator: "openrouter:z-ai/glm-5.3-flash", keys: { openrouter: { env: "MY_OR_KEY" } } }, d, { dry: true });
assert.deepEqual(p.config.backends.list["glm-5.3-flash"].key, { env: "MY_OR_KEY" });
assert.equal(p.config.router.backend, "glm-5.3-flash");

// Apply twice, with a pasted key: config written, key stored apart, registrations replaced.
const answers = { ...suggested, extras: ["openrouter:z-ai/glm-5.3-flash"], keys: { openrouter: { value: "sk-test-123" } } };
for (let n = 0; n < 2; n++) {
  const r = apply(answers, d);
  assert.ok(r.applied.every((a) => a.ok), JSON.stringify(r.applied));
}
const cfg = JSON.parse(fs.readFileSync(path.join(process.env.ASK_KIT_CONFIG, "config.json"), "utf8"));
assert.equal(cfg.backends.default, "codex");
assert.ok(!JSON.stringify(cfg).includes("sk-test-123"), "config never holds a key");
assert.match(fs.readFileSync(path.join(process.env.ASK_KIT_CONFIG, "keys.env"), "utf8"), /OPENROUTER_API_KEY=sk-test-123/);
// Windows has no POSIX modes; there the file sits in the user's own %APPDATA%.
if (process.platform !== "win32") assert.equal(fs.statSync(path.join(process.env.ASK_KIT_CONFIG, "keys.env")).mode & 0o777, 0o600);
const toml = fs.readFileSync(path.join(process.env.CODEX_HOME, "config.toml"), "utf8");
assert.equal(toml.match(/\[mcp_servers\.ask\]/g).length, 1, "one ask block after two applies");
assert.match(toml, /tool_timeout_sec = 600/);
assert.match(toml, /\[mcp_servers\.other\]/, "the user's own servers are kept");
const cop = JSON.parse(fs.readFileSync(path.join(process.env.COPILOT_HOME, "mcp-config.json"), "utf8"));
assert.equal(cop.mcpServers.ask.type, "local");
console.log("ok");
