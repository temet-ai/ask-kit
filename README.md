# ask-kit

Your coding agent spends most of its context digging: grepping old sessions, reading files,
re-running searches. ask-kit gives it one tool, `ask`, that hands the digging to a cheap model
outside the agent's context and returns a short answer with evidence.

```
you (in Claude Code, Codex or Copilot):  why did the retry test stop flaking last week?

ask → A Codex session ran the suite, found the retry test's timeout was too tight for CI and
      widened it in test/retry.test.js (codex 5ca1ab1e #12, #19). A Claude Code session the next
      day confirmed the suite passed ten runs in a row (claude-code d15c0de1 #7).
      [sessions · glm-5.3-flash · 16s · $0.0022]
```

(An illustration of the answer's shape; [Measured](#measured-2026-11-18-one-machine-1500-sessions-on-disk)
has real timings.)

The tool is an [MCP](https://modelcontextprotocol.io) server, so any agent that takes MCP
servers can call it.

It answers about two things:

- **sessions**: your past work, read straight from the transcripts your agents already write
  (Claude Code, Codex, GitHub Copilot CLI, Gemini CLI, opencode). No proxy, no database.
- **code**: the repository the agent is in, with `path:line` citations.

## Set it up

Paste one line into the coding agent you already use (Claude Code, Codex, Copilot, Gemini CLI,
opencode), on Linux, macOS or Windows:

```
Read https://github.com/temet-ai/ask-kit/blob/main/AGENTS.md, then set up ask-kit for me.
```

[AGENTS.md](AGENTS.md) walks the agent through everything from nothing: checking Node, installing
(`npm install -g --allow-git=root github:temet-ai/ask-kit`), then `ask-kit init`, which puts ask-kit's skills,
its tuner agent and a when-to-ask rule into **every** agent on the machine, in each one's own
format, and writes a guide with this machine's paths to `~/.config/ask-kit/AGENTS.md`. From then
on, any agent changes ask-kit from one line:

```
Read ~/.config/ask-kit/AGENTS.md, then switch ask's default model to codex.
Read ~/.config/ask-kit/AGENTS.md, then add this domain: github.com/<owner>/<repo>
```

`ask-kit lines` prints them all. Setting up, the agent looks at what the machine has and asks you
a few questions:

- whose past sessions to read (it lists each agent's transcripts with session counts),
- which agents should get `ask`,
- which model does the digging. It offers what you actually have: an API key it found
  (OpenRouter, OpenAI, Anthropic, Gemini, DeepSeek), a subscription you already pay for (Claude
  Code, Codex on a ChatGPT plan, Copilot), or a local model (Ollama, LM Studio),
- whether to answer about sessions, code or both.

It shows what it will change before writing anything. Prefer the terminal? `ask-kit setup` asks
the same questions.

What lands in each agent:

| Agent | `ask` tool | Skills | Tuner agent | When-to-ask rule |
|---|---|---|---|---|
| Claude Code | `claude mcp add -s user` | `~/.claude/skills/` | `~/.claude/agents/` | `~/.claude/rules/ask-kit.md` |
| Codex | `config.toml` block, 600 s tool timeout | `~/.codex/skills/` | (as a skill) | block in `~/.codex/AGENTS.md` |
| Copilot CLI | `~/.copilot/mcp-config.json` | `~/.copilot/skills/` | `~/.copilot/agents/` | `~/.copilot/instructions/ask-kit.instructions.md` |
| opencode | `opencode.json` `mcp` | `~/.config/opencode/skill/` | `~/.config/opencode/agent/` | block in its `AGENTS.md` |
| Gemini CLI | `settings.json` | `~/.gemini/skills/` | (as a skill) | block in `~/.gemini/GEMINI.md` |

The rule tells the agent when to call `ask` instead of searching itself. The skills:
`ask-kit-setup` (this conversation), `ask-kit-improve` (tune ask from its journal),
`ask-kit-domain` (add, write or share a domain). The tuner agent does the tuning work for
`ask-kit-improve`. Every file ask-kit writes is recorded with its
hash in `installed.json`; a file you edit is never overwritten, and
`ask-kit uninstall` removes only what ask-kit wrote. The opencode and Gemini formats follow their
docs and have not yet been checked on a real install.

The config records where a key is (an environment variable or a file), not the key. A key you
paste goes to `~/.config/ask-kit/keys.env`, mode 0600.

To install by hand instead: `npm install -g --allow-git=root github:temet-ai/ask-kit`,
`ask-kit init`, then `ask-kit setup`. It needs Node.js 22.13 or newer and git. (npm 12 refuses
packages from git without `--allow-git`; older npm ignores the flag.)

After setup, `ask-kit doctor` checks every source and model, and
`ask-kit ask --domain sessions "what did I work on yesterday?"` asks from the shell. Restart your
agents so they load the `ask` tool; then ask them in plain words ("ask what we decided about the
retry timeout"), and they call it. Follow-ups pass `continue: true`.

## How it works

The calling agent pays for one tool call and the answer. Behind the tool:

1. **An investigator with a REPL, not a pile of tools.** The model writes JavaScript cells that
   run in a Node `vm` holding the domain's API (`history` over transcripts, `repo` over code), a
   toolkit and ready-made scripts. One cell can search, filter and join what would otherwise take
   a dozen tool round-trips.
2. **Scripts for the common questions.** `find-sessions`, `session-digest`, `grep`,
   `session-tools`, `session-changes`, `recent`; for code `where`, `knobs`, `history`, `outline`,
   `overview`. An investigation can save its own variant as a draft.
3. **Warm once, fork per question.** The instructions, API and scripts are a fixed prefix built
   once. With Claude Code or Codex as the investigator, a warm session is forked for each
   question; with an API, the provider's prompt cache serves the same prefix. Editing any of
   those files re-warms on the next question.
4. **Follow-ups keep their state.** REPL variables are snapshotted after every cell, so
   `continue: true` reaches an investigator that still holds what it found.
5. **One `ask`, routed.** A one-word call to the cheap model (or keyword rules, or the
   caller's `about`) picks the domain.
6. **A journal.** Every ask and every cell is logged under `~/.local/state/ask-kit/` with its time,
   cost, steps and scripts, which is what you tune from.

The investigator only reads: transcripts through `history`, code through ripgrep, file reads and
an allowlist of git subcommands. When an agent CLI is the investigator, its own tools are turned
off or sandboxed read-only and it is told to use only the REPL.

## Measured (2026-11-18, one machine, ~1,500 sessions on disk)

glm-5.3-flash through OpenRouter is the model setup suggests when you have an OpenRouter key.
"Routed" means the domain was picked by the router, not named in the call.

| Question | Investigator | Time | Cost |
|---|---|---|---|
| What did a Codex session find and change | glm-5.3-flash (OpenRouter) | 16 s | $0.0022 |
| Which sessions worked on X in the last week | glm-5.3-flash, routed | 53 s | $0.0083 |
| Follow-up on that (`continue: true`) | glm-5.3-flash | 17 s | $0.0035 |
| Which Copilot session did a piece of work, under which ticket | Claude Code, haiku | 23 s | $0.0025 |
| same | Codex (ChatGPT plan) | 36 s | in the plan |
| same | Copilot CLI | 134 s | Copilot premium requests |
| How does routing work in this repo | deepseek-v4.1-flash (code) | 110 s | $0.0033 |

## Commands

```
ask-kit init [--force]           skills, agent and rule into every agent found; write the guide
ask-kit setup                    set up in the terminal
ask-kit questions                setup questions and suggestions as JSON (what the skill reads)
ask-kit apply <answers.json> [--dry-run]
ask-kit detect [--json]          what this machine has (agents, transcripts, logins, keys, local models, tools)
ask-kit doctor                   check sources, backends and tools
ask-kit ask "<question>" [--domain sessions|code] [--backend name] [--continue]
ask-kit report [--since 7d]      flagged asks, scripts used, routes worth a script
ask-kit gallery                  shared domains
ask-kit add <repo> [--yes]       show a shared domain's files; --yes installs and enables it
ask-kit lines                    the one-line prompts for any agent
ask-kit uninstall [--dry-run]    remove what ask-kit installed (not your edits)
ask-kit serve [--domain d]       the MCP server your agents start
```

## Domains: add, write, share

A domain is a folder with `domain.mjs` (its globals, prompts and tool words), `api.d.ts`,
`instructions.md` and `scripts/`. Your own go in `~/.config/ask-kit/domains/<name>/`. See
`src/domains.mjs` for the contract and `domains/code` for an example; the `ask-kit-domain` skill
walks an agent through writing one.

To share a domain, put its folder and a `RECIPE.md` (what it answers,
what it reads and runs, a brief another agent could rebuild it from) in a public GitHub repo
with the topic `ask-kit-domain`. It shows in `ask-kit gallery`, and others add it with one line.
`ask-kit add` always shows the files first: a domain is code that runs with your rights.

## Status

Early. Tested on Linux with real transcripts. Fixtures for all five transcript formats run in CI
on Linux, macOS and Windows. The Gemini CLI reader follows its documented session format but has
not met a real store yet. Model ids for the OpenAI, Anthropic and Gemini presets are suggestions; `ask-kit doctor`
checks them against the provider's model list. There are no releases yet: install from `main`.

ask-kit grew out of mike-ask, a private tool that does the same over the traffic recorded by
[mike](https://github.com/temet-ai/mike), a proxy that captures every Claude Code request.
ask-kit needs neither.

## What it stores and sends

- **Sends**: your question, and the transcript and code excerpts the investigator reads, to the
  model you chose (an API provider, an agent CLI's own service, or a local model server). When a
  router model is set, picking the domain is one more short call to it, with the question only.
  `ask-kit gallery` queries GitHub's search API; `ask-kit doctor` lists each provider's models.
  Nothing else: no telemetry.
- **Stores**: the config, the guide and `keys.env` under `~/.config/ask-kit/`; journals of every
  ask and cell, REPL snapshots, warm investigator sessions and a transcript index under
  `~/.local/state/ask-kit/` (Windows: `%APPDATA%\ask-kit` and `%LOCALAPPDATA%\ask-kit\state`).
  The skills, agent and rule it installs are listed in `installed.json`.
- With an agent CLI as the investigator, its questions are sessions of that CLI: the excerpts go
  to that CLI's service under its own terms, and the sessions appear in its history.

## Contributing

Bug reports and small fixes are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md). Report security
problems privately as [SECURITY.md](SECURITY.md) says.

## Licence

MIT, see [LICENSE](LICENSE). Third-party licences are in
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
