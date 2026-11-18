// Registering ask-kit's MCP server, `ask`, with each coding agent, in that agent's own way, and
// removing it again. Each entry returns {client, what, run()} so setup can show the change first.
//
//   Claude Code   `claude mcp add -s user ask -- node <ask-kit> serve`
//   Codex         a marked [mcp_servers.ask] block in config.toml, with a 600 s tool timeout
//   Copilot CLI   mcpServers.ask in ~/.copilot/mcp-config.json
//   Gemini CLI    mcpServers.ask in ~/.gemini/settings.json
//   opencode      mcp.ask in ~/.config/opencode/opencode.json
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ROOT } from "../config.mjs";
import { which } from "../platform.mjs";

const BIN = path.join(ROOT, "bin", "ask-kit.mjs");
export const SERVE = { command: process.execPath, args: [BIN, "serve"] };
const home = (...p) => path.join(os.homedir(), ...p);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Run a CLI to completion (Windows .cmd shims included); throws with its output on failure. */
function cli(bin, args) {
  const full = which(bin);
  if (!full) throw new Error(`${bin} is not on PATH`);
  const shell = process.platform === "win32" && /\.(cmd|bat)$/i.test(full);
  const r = spawnSync(shell ? `"${full}"` : full, args.map((a) => (shell && /[\s"]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a)), { encoding: "utf8", timeout: 30_000, shell });
  if (r.status !== 0) throw new Error(`${bin} ${args.slice(0, 3).join(" ")}: ${(r.stderr || r.stdout || r.error?.message || "").trim().slice(0, 300)}`);
  return r.stdout;
}

function claudeCode() {
  let exists = false;
  try {
    cli("claude", ["mcp", "get", "ask"]);
    exists = true;
  } catch {}
  return {
    client: "claude-code",
    what: `${exists ? "replace" : "add"} the user-scope MCP server "ask" in Claude Code`,
    run() {
      if (exists) cli("claude", ["mcp", "remove", "-s", "user", "ask"]);
      cli("claude", ["mcp", "add", "-s", "user", "ask", "--", SERVE.command, ...SERVE.args]);
    },
    remove() {
      if (exists) cli("claude", ["mcp", "remove", "-s", "user", "ask"]);
    },
  };
}

const TOML_MARK = ["# >>> ask-kit (managed by `ask-kit setup`; edits inside are replaced)", "# <<< ask-kit"];
function codex() {
  const file = path.join(process.env.CODEX_HOME || home(".codex"), "config.toml");
  const block = [
    TOML_MARK[0],
    "[mcp_servers.ask]",
    `command = ${JSON.stringify(SERVE.command)}`,
    `args = [${SERVE.args.map((a) => JSON.stringify(a)).join(", ")}]`,
    // Codex drops a tool call at 60 s unless told otherwise; an investigation can take minutes.
    "tool_timeout_sec = 600",
    "startup_timeout_sec = 30",
    TOML_MARK[1],
  ].join("\n");
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const managed = text.includes(TOML_MARK[0]);
  const re = new RegExp(`\\n*${esc(TOML_MARK[0])}[\\s\\S]*?${esc(TOML_MARK[1])}\\n?`);
  if (!managed && /^\[mcp_servers\.ask\]/m.test(text)) {
    return { client: "codex", what: `skip: ${file} already has an [mcp_servers.ask] that ask-kit did not write`, run() {}, remove() {} };
  }
  return {
    client: "codex",
    what: `${managed ? "update" : "add"} [mcp_servers.ask] in ${file} (tool_timeout_sec = 600)`,
    run() {
      const next = managed ? text.replace(re, `\n\n${block}\n`) : `${text.replace(/\n*$/, text ? "\n\n" : "")}${block}\n`;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, next);
    },
    remove() {
      if (managed) fs.writeFileSync(file, text.replace(re, "\n"));
    },
  };
}

/** A JSON config file whose `keyPath` object holds the agent's MCP servers. */
function jsonServer(client, file, keyPath, entry) {
  const read = () => {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      return {};
    }
  };
  return {
    client,
    what: `set ${keyPath}.ask in ${file}`,
    run() {
      const j = read();
      j[keyPath] = { ...(j[keyPath] ?? {}), ask: entry };
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(j, null, 2) + "\n");
    },
    remove() {
      const j = read();
      if (!j[keyPath]?.ask) return;
      delete j[keyPath].ask;
      fs.writeFileSync(file, JSON.stringify(j, null, 2) + "\n");
    },
  };
}

export const REGISTER = {
  "claude-code": claudeCode,
  codex,
  "copilot-cli": () =>
    jsonServer("copilot-cli", path.join(process.env.COPILOT_HOME || home(".copilot"), "mcp-config.json"), "mcpServers", { type: "local", ...SERVE, tools: ["*"] }),
  "gemini-cli": () => jsonServer("gemini-cli", home(".gemini", "settings.json"), "mcpServers", { ...SERVE, timeout: 600_000 }),
  opencode: () =>
    jsonServer("opencode", path.join(process.env.XDG_CONFIG_HOME || home(".config"), "opencode", "opencode.json"), "mcp", {
      type: "local",
      command: [SERVE.command, ...SERVE.args],
      enabled: true,
      timeout: 600_000,
    }),
};
