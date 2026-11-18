// What this machine has: coding agents (on PATH, and whether their transcripts are here), agent
// CLIs that could do the investigating, API keys (by name only, never their values) and local
// model servers. Setup builds its questions from this.
import fs from "node:fs";
import { AGENTS, AGENT_CLIS, API_PRESETS } from "../providers.mjs";
import { ADAPTERS } from "../transcripts/index.mjs";
import { loadConfig, readEnvFile, CONFIG_FILE, KEYS_FILE } from "../config.mjs";
import { runCli, which as whichSync, rgPath } from "../platform.mjs";

const sh = async (cmd, args, ms = 6000) => {
  const r = await runCli(cmd, args, { timeoutMs: ms });
  const full = String(r.out || r.err || "").trim();
  return { ok: r.code === 0, full, out: full.split("\n")[0].slice(0, 160) };
};
const which = async (bin) => whichSync(bin);

async function probe(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(800) });
    if (!res.ok) return null;
    const j = await res.json();
    return (j.data ?? j.models ?? []).map((m) => m.id ?? m.name).filter(Boolean);
  } catch {
    return null;
  }
}

export async function detect({ counts = true } = {}) {
  const agents = {};
  for (const [name, a] of Object.entries(AGENTS)) {
    const path = await which(a.bin);
    const adapter = ADAPTERS[a.source];
    const store = adapter?.available() ? adapter.where() : null;
    let sessions = null;
    if (store && counts) {
      try {
        sessions = (await adapter.sessions()).length;
      } catch {}
    }
    // On PATH and runs: a version manager's shim with no version set is not an installed agent.
    const v = path ? await sh(a.bin, ["--version"]) : null;
    agents[name] = { label: a.label, onPath: !!v?.ok, path, version: v?.ok ? v.out : null, ...(v && !v.ok ? { broken: v.out } : {}), transcripts: store, sessions };
  }

  // Signed in? Only where the CLI has a cheap way to say so. Never the account itself.
  const claudeAuth = async () => {
    const r = await sh("claude", ["auth", "status"]);
    try {
      const j = JSON.parse(r.full);
      return { ok: !!j.loggedIn, out: j.loggedIn ? `signed in (${[j.authMethod, j.subscriptionType].filter(Boolean).join(", ")})` : "not signed in: run `claude` once" };
    } catch {
      return r;
    }
  };
  const auth = {
    "claude-cli": agents["claude-code"].onPath ? await claudeAuth() : null,
    "codex-cli": agents.codex.onPath ? await sh("codex", ["login", "status"]) : null,
    "copilot-cli": agents["copilot-cli"].onPath ? { ok: true, out: "not checked: Copilot CLI has no status command; it asks to sign in on first use" } : null,
  };
  const clis = {};
  for (const [kind, c] of Object.entries(AGENT_CLIS)) {
    const onPath = !!(await which(c.bin));
    clis[kind] = { label: c.label, available: onPath, signedIn: onPath ? auth[kind]?.ok ?? null : null, status: auth[kind]?.out ?? null };
  }

  const pasted = readEnvFile(KEYS_FILE);
  const apis = {};
  for (const [name, p] of Object.entries(API_PRESETS)) {
    if (p.local || !p.keyEnv) continue;
    const where = [];
    if (process.env[p.keyEnv]) where.push({ env: p.keyEnv });
    for (const f of p.keyFiles ?? []) if (readEnvFile(f)[p.keyEnv]) where.push({ file: f, var: p.keyEnv });
    if (pasted[p.keyEnv]) where.push({ file: KEYS_FILE, var: p.keyEnv });
    apis[name] = { label: p.label, keyFound: where.length > 0, keyRefs: where };
  }

  const local = {};
  for (const [name, p] of Object.entries(API_PRESETS)) {
    if (!p.local) continue;
    const models = await probe(`${p.baseUrl}/models`);
    local[name] = { label: p.label, running: !!models, baseUrl: p.baseUrl, models: models ?? [] };
  }

  let existing = null;
  try {
    existing = fs.existsSync(CONFIG_FILE) ? loadConfig() : null;
  } catch {}
  // What the code domain needs: ripgrep (bundled through @vscode/ripgrep when the system has none)
  // and git for history. Node's own version decides node:sqlite (opencode).
  const tools = {
    node: process.version,
    nodeOk: Number(process.versions.node.split(".")[0]) > 22 || (Number(process.versions.node.split(".")[0]) === 22 && Number(process.versions.node.split(".")[1]) >= 13),
    ripgrep: rgPath(),
    git: whichSync("git"),
    platform: `${process.platform}-${process.arch}`,
  };
  return { agents, clis, apis, local, tools, existing: existing ? { file: CONFIG_FILE, config: existing } : null };
}
