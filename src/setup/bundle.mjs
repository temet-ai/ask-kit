// The bundle: ask-kit's skills, agents and rule, rendered into each coding agent's own format and
// folder. Every file ask-kit writes is recorded with its hash in
// installed.json next to the config: a reinstall replaces only files still as ask-kit wrote
// them, and leaves a file the user edited (or one that was never ask-kit's) alone.
//
// Rules are written as their own file where the agent reads a folder of them (Claude Code rules,
// Copilot instructions) and as a marked block in the agent's one instructions file otherwise
// (Codex AGENTS.md, opencode AGENTS.md, Gemini GEMINI.md).
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CONFIG_DIR, ROOT } from "../config.mjs";

import { AGENTS_MD } from "../agentsmd.mjs";

const BUNDLE = path.join(ROOT, "bundle");
const MANIFEST = path.join(CONFIG_DIR, "installed.json");
const H = () => os.homedir();
const xdgConfig = () => process.env.XDG_CONFIG_HOME || path.join(H(), ".config");

/**
 * Where each agent keeps skills, agents and instructions. `verified: false` marks a format taken
 * from the agent's documentation but not yet checked against a real install.
 */
export const TARGETS = {
  "claude-code": {
    label: "Claude Code",
    base: () => process.env.CLAUDE_CONFIG_DIR || path.join(H(), ".claude"),
    skills: "skills",
    agents: { dir: "agents", format: "claude" },
    rule: { file: "rules/ask-kit.md", mode: "file" },
  },
  codex: {
    label: "Codex",
    base: () => process.env.CODEX_HOME || path.join(H(), ".codex"),
    skills: "skills",
    agents: null, // no user-level agent files checked yet; the tuner is reachable as a skill
    rule: { file: "AGENTS.md", mode: "block" },
  },
  "copilot-cli": {
    label: "GitHub Copilot CLI",
    base: () => process.env.COPILOT_HOME || path.join(H(), ".copilot"),
    skills: "skills",
    agents: { dir: "agents", format: "copilot" },
    rule: { file: "instructions/ask-kit.instructions.md", mode: "file", front: '---\napplyTo: "**"\n---\n' },
  },
  opencode: {
    label: "opencode",
    base: () => path.join(xdgConfig(), "opencode"),
    skills: "skill",
    agents: { dir: "agent", format: "opencode" },
    rule: { file: "AGENTS.md", mode: "block" },
    verified: false,
  },
  "gemini-cli": {
    label: "Gemini CLI",
    base: () => process.env.GEMINI_CLI_HOME || path.join(H(), ".gemini"),
    skills: "skills",
    agents: null,
    rule: { file: "GEMINI.md", mode: "block" },
    verified: false,
  },
};

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);
const readManifest = () => {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  } catch {
    return { files: {}, blocks: {} };
  }
};
const MARK = ["<!-- >>> ask-kit: written by `ask-kit init`; edits inside are replaced -->", "<!-- <<< ask-kit -->"];

/** {{ASK_KIT}} and {{AGENTS_MD}} filled in for this install. */
export function render(text) {
  const cmd = `${JSON.stringify(process.execPath).slice(1, -1)} ${path.join(ROOT, "bin", "ask-kit.mjs")}`;
  return text.replaceAll("{{ASK_KIT}}", cmd).replaceAll("{{AGENTS_MD}}", AGENTS_MD);
}

function frontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { fields: {}, body: text };
  const fields = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([A-Za-z_-]+):\s*(.*)$/);
    if (kv) fields[kv[1]] = kv[2];
  }
  return { fields, body: m[2] };
}
const toFront = (fields) => `---\n${Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join("\n")}\n---\n`;

/** One bundle agent in an agent's own format. */
function agentFile(text, format) {
  const { fields, body } = frontmatter(text);
  if (format === "claude") return toFront(fields) + body;
  // Copilot custom agents: name and description; a model name from Claude would not resolve there.
  if (format === "copilot") return toFront({ name: fields.name, description: fields.description }) + body;
  // opencode: the file name is the agent's name; it is a subagent the main agent can call.
  if (format === "opencode") return toFront({ description: fields.description, mode: "subagent" }) + body;
  return text;
}

/** Every file the bundle would write for one agent: [{path, content}] plus the rule. */
export function filesFor(agent) {
  const t = TARGETS[agent];
  const base = t.base();
  const out = [];
  const skillsDir = path.join(BUNDLE, "skills");
  for (const name of fs.readdirSync(skillsDir)) {
    const src = path.join(skillsDir, name, "SKILL.md");
    if (fs.existsSync(src)) out.push({ path: path.join(base, t.skills, name, "SKILL.md"), content: render(fs.readFileSync(src, "utf8")) });
  }
  if (t.agents) {
    for (const f of fs.readdirSync(path.join(BUNDLE, "agents")).filter((x) => x.endsWith(".md"))) {
      out.push({ path: path.join(base, t.agents.dir, f), content: agentFile(render(fs.readFileSync(path.join(BUNDLE, "agents", f), "utf8")), t.agents.format) });
    }
  }
  const rule = render(fs.readFileSync(path.join(BUNDLE, "rules", "ask.md"), "utf8"));
  return { base, files: out, rule: { path: path.join(base, t.rule.file), mode: t.rule.mode, content: (t.rule.front ?? "") + rule } };
}

/**
 * Install (or with dry, describe) the bundle for these agents. Returns one row per file:
 * {agent, path, action: "write" | "replace" | "unchanged" | "skip-edited" | "skip-not-ours" | "block", ...}.
 */
export function installBundle(agents, { dry = false, force = false } = {}) {
  const m = readManifest();
  const rows = [];
  for (const agent of agents) {
    if (!TARGETS[agent]) continue;
    const { base, files, rule } = filesFor(agent);
    // Only for agents that are set up here: their folder exists.
    if (!fs.existsSync(base)) {
      rows.push({ agent, path: base, action: "skip-no-agent" });
      continue;
    }
    for (const f of files) {
      const exists = fs.existsSync(f.path);
      const current = exists ? fs.readFileSync(f.path, "utf8") : null;
      const recorded = m.files[f.path];
      let action;
      if (!exists) action = "write";
      else if (current === f.content) action = "unchanged";
      else if (!recorded) action = force ? "replace" : "skip-not-ours";
      else if (sha(current) !== recorded) action = force ? "replace" : "skip-edited";
      else action = "replace";
      rows.push({ agent, path: f.path, action });
      if (!dry && (action === "write" || action === "replace" || action === "unchanged")) {
        if (action !== "unchanged") {
          fs.mkdirSync(path.dirname(f.path), { recursive: true });
          fs.writeFileSync(f.path, f.content);
        }
        m.files[f.path] = sha(f.content);
      }
    }
    if (rule.mode === "file") {
      const f = rule;
      const exists = fs.existsSync(f.path);
      const current = exists ? fs.readFileSync(f.path, "utf8") : null;
      const recorded = m.files[f.path];
      const action = !exists ? "write" : current === f.content ? "unchanged" : recorded && sha(current) === recorded ? "replace" : force ? "replace" : recorded ? "skip-edited" : "skip-not-ours";
      rows.push({ agent, path: f.path, action, rule: true });
      if (!dry && ["write", "replace", "unchanged"].includes(action)) {
        fs.mkdirSync(path.dirname(f.path), { recursive: true });
        if (action !== "unchanged") fs.writeFileSync(f.path, f.content);
        m.files[f.path] = sha(f.content);
      }
    } else {
      const block = `${MARK[0]}\n${rule.content.trim()}\n${MARK[1]}`;
      const text = fs.existsSync(rule.path) ? fs.readFileSync(rule.path, "utf8") : "";
      const has = text.includes(MARK[0]);
      rows.push({ agent, path: rule.path, action: has ? "block-replace" : "block-add", rule: true });
      if (!dry) {
        const re = new RegExp(`${esc(MARK[0])}[\\s\\S]*?${esc(MARK[1])}`);
        const next = has ? text.replace(re, block) : `${text.replace(/\n*$/, text ? "\n\n" : "")}${block}\n`;
        fs.mkdirSync(path.dirname(rule.path), { recursive: true });
        fs.writeFileSync(rule.path, next);
        m.blocks[rule.path] = true;
      }
    }
  }
  if (!dry) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
    fs.writeFileSync(MANIFEST, JSON.stringify(m, null, 2) + "\n");
  }
  return rows;
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Remove what ask-kit wrote: files still as it wrote them, and its marked blocks. */
export function uninstallBundle({ dry = false } = {}) {
  const m = readManifest();
  const rows = [];
  for (const [file, hash] of Object.entries(m.files)) {
    let current = null;
    try {
      current = fs.readFileSync(file, "utf8");
    } catch {}
    const action = current == null ? "gone" : sha(current) === hash ? "remove" : "skip-edited";
    rows.push({ path: file, action });
    if (!dry && action === "remove") {
      fs.rmSync(file);
      // A skill's folder goes with its SKILL.md when nothing else is in it.
      try {
        if (path.basename(file) === "SKILL.md" && !fs.readdirSync(path.dirname(file)).length) fs.rmdirSync(path.dirname(file));
      } catch {}
    }
    if (!dry && action !== "skip-edited") delete m.files[file];
  }
  for (const file of Object.keys(m.blocks)) {
    rows.push({ path: file, action: "block-remove" });
    if (dry) continue;
    try {
      const text = fs.readFileSync(file, "utf8");
      fs.writeFileSync(file, text.replace(new RegExp(`\\n*${esc(MARK[0])}[\\s\\S]*?${esc(MARK[1])}\\n?`), "\n"));
    } catch {}
    delete m.blocks[file];
  }
  if (!dry) fs.writeFileSync(MANIFEST, JSON.stringify(m, null, 2) + "\n");
  return rows;
}
