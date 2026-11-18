// ~/.config/ask-kit/AGENTS.md: ask-kit's whole interface as files, written for an agent.
// ask-kit rewrites it on every run (init, setup, apply, doctor, serve)
// with this machine's real paths and current config, so one line pasted into any agent works:
// "Read ~/.config/ask-kit/AGENTS.md, then <what you want>".
import fs from "node:fs";
import path from "node:path";
import { CONFIG_DIR, CONFIG_FILE, KEYS_FILE, ROOT, STATE_ROOT, loadConfig } from "./config.mjs";
import { domainDirs, listDomains } from "./domains.mjs";

export const AGENTS_MD = path.join(CONFIG_DIR, "AGENTS.md");

export function agentsMd() {
  let c = null;
  try {
    c = loadConfig({ required: false });
  } catch {}
  const cmd = `${process.execPath} ${path.join(ROOT, "bin", "ask-kit.mjs")}`;
  const now = c
    ? [
        `- Transcripts read: ${c.sources?.join(", ") || "none"}`,
        `- Agents with \`ask\`: ${c.clients?.join(", ") || "none"}`,
        `- Investigator models (backend names): ${Object.entries(c.backends?.list ?? {}).map(([n, b]) => `${n}${n === c.backends.default ? " (default)" : ""} = ${b.kind}${b.preset ? ` ${b.preset}` : ""}${b.model ? ` ${b.model}` : ""}`).join("; ")}`,
        `- Domains: ${Object.entries(c.domains ?? {}).map(([n, d]) => `${n}${d.enabled === false ? " (off)" : ""}${d.backend ? ` on ${d.backend}` : ""}`).join(", ")}`,
        `- Router: ${c.router?.backend ? `one-word call to ${c.router.backend}` : "keyword rules (no API backend)"}`,
      ].join("\n")
    : "Not set up yet. Run the setup conversation below.";
  return `# ask-kit

<!-- Written by ask-kit on every run. Edits here are overwritten; change the files it names. -->

ask-kit gives coding agents one tool, \`ask\`: a question in plain words goes to a cheap
investigator model with a JavaScript REPL and ready-made scripts, which digs through this
machine's agent transcripts (sessions) or the current repository (code) outside the calling
agent's context, and answers with evidence. This file is its whole interface: everything it
does is set by the files below, and you change ask-kit by changing them or running its command.

The command: \`${cmd}\` (below: \`ask-kit\`).

## Now

${now}

## Files

| What | Where |
|---|---|
| Config: sources, backends, domains, router | \`${CONFIG_FILE}\` |
| Pasted API keys (mode 0600; the config only names where a key is) | \`${KEYS_FILE}\` |
| What ask-kit installed into each agent, with hashes | \`${path.join(CONFIG_DIR, "installed.json")}\` |
| Your own domains (win over built-ins of the same name) | \`${domainDirs()[0]}\` |
| Built-in domains | \`${domainDirs()[1]}\` |

Domains available now (yours and built-in): ${listDomains().join(", ")}.
| Journals (one JSON line per ask and per cell), REPL snapshots, warm sessions | \`${STATE_ROOT}\` |
| ask-kit itself | \`${ROOT}\` |

A domain is a folder: \`domain.mjs\` (globals and words), \`api.d.ts\` (the typed API the
investigator reads), \`instructions.md\`, \`scripts/*.mjs\`. Editing any of them re-warms the
investigator on its next question; nothing needs restarting.

## Doing things

Match the request to one of these. Show the user what will change before changing it.

- **Set up, or change what it uses** (models, transcripts, agents, domains): run
  \`ask-kit questions\`, ask the user the questions it prints (options, suggestion and why
  included), write the answers as JSON, show \`ask-kit apply <file> --dry-run\`, then apply. The
  ask-kit-setup skill has the details. Restart the agents afterwards so they load \`ask\`.
- **Ask something from the shell**: \`ask-kit ask [--domain sessions|code] [--backend name] "question"\`;
  \`--continue\` follows up.
- **Check it**: \`ask-kit doctor\`.
- **It answered badly, or is slow**: \`ask-kit report --since 7d\`, then the ask-kit-improve skill
  (or the ask-kit-tuner agent).
- **Add a domain someone shared** (a GitHub repo with the topic \`ask-kit-domain\`):
  \`ask-kit add <repo>\` shows its files; it is code that runs with the user's rights, so tell the
  user what it reads and runs, and only on their yes run \`ask-kit add <repo> --yes\`.
  \`ask-kit gallery\` lists shared domains.
- **Write or share a domain**: the ask-kit-domain skill.
- **Put the skills, agents and rule into an agent installed later**: \`ask-kit init\`.
- **Remove it**: \`ask-kit uninstall\` (registrations, and the skills, agents and rule it wrote,
  except files the user has edited).

## Lines to paste into any agent

- \`Read ${AGENTS_MD}, then set up ask-kit for me.\`
- \`Read ${AGENTS_MD}, then switch ask's default model to <name>.\`
- \`Read ${AGENTS_MD}, then add this domain: github.com/<owner>/<repo>\`
- \`Read ${AGENTS_MD}, then write a RECIPE.md for my <name> domain the way the ask-kit-domain skill describes, push it to a public GitHub repo and add the topic ask-kit-domain.\`

## Rules

- Never print, copy or move an API key. Config holds only references (\`{env}\` or \`{file, var}\`).
- Investigators are read-only. A domain you write must be too unless the user asks otherwise.
- Prefer a script over a longer instruction: a script is tested by every question that uses it.
`;
}

/** Write AGENTS.md when it changed. Never throws: it is a convenience, not a step that can fail a run. */
export function writeAgentsMd() {
  try {
    const text = agentsMd();
    let old = null;
    try {
      old = fs.readFileSync(AGENTS_MD, "utf8");
    } catch {}
    if (old !== text) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
      fs.writeFileSync(AGENTS_MD, text);
    }
  } catch {}
  return AGENTS_MD;
}
