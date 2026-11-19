# Command line

```
ask-kit init [--force]           skills, agent and rule into every agent found; write the guide
ask-kit setup                    set up in the terminal
ask-kit questions                setup questions and suggestions as JSON (what the skill reads)
ask-kit apply <answers.json> [--dry-run]
ask-kit detect [--json]          what this machine has (agents, transcripts, logins, keys, local models, tools)
ask-kit doctor                   check sources, backends and tools
ask-kit ask "<question>" [--domain sessions|code] [--backend name] [--continue]
ask-kit report [--since 7d]      flagged asks, scripts used, routes worth a script
ask-kit gaps [--since 30d] [--json]   lookups agents did by hand instead of asking, by kit
ask-kit gallery                  shared domains
ask-kit add <repo> [--yes]       show a shared domain's files; --yes installs and enables it
ask-kit lines                    the one-line prompts for any agent
ask-kit uninstall [--dry-run]    remove what ask-kit installed (not your edits)
ask-kit serve [--domain d]       the MCP server your agents start
```

## ask-kit gaps

`ask-kit gaps` reads this machine's Claude Code, Codex, Copilot CLI, Gemini CLI and opencode
transcripts from the last 30 days (`--since 7d`, `12h`, `2w` or a date). In them it looks for
lookup chains: three or more lookups in a row inside one prompt's turn (reading files, `git`,
`gh`, MCP reads, web pages, logs, service state), with nothing edited after them in that turn.
A chain like that is an agent answering a question by hand. Each chain is put down to a kit by
what it touched: a program (`gh` is github, `docker` is docker, `psql` is postgres, `systemctl`
and `journalctl` are systemd, and any program a kit lists in `requires`), a kit's folder, the
session's repository (code), or an MCP server.

It prints three sections:

| Section | What it lists |
|---|---|
| Coverage | How many asks there were against chains answered by hand, as a share of the count and of the tokens. |
| Installed but skipped | For each kit you have, the chains that went to its sources by hand: how many, in how many sessions, their tokens, the areas they read and three prompts that started them. |
| No kit | Sources no installed kit covers, ranked by sessions times tokens, with the prompts; the terminal shows the first 12. |

Cost is the tokens of the model calls that made a chain's lookups, from the transcript's usage
records. Where ask-kit doesn't read per-call usage (Gemini CLI, opencode), it is the characters
of the tool results divided by four, and the Cost line says so. Dollars are list prices for
Claude models only.

Prompts that are mail between sessions, a fleet seat's brief, an interrupt, a resumed-session
notice or under 25 characters are not someone's question. They are counted, but no example comes
from them and the "No kit" list leaves them out. The report gives two counts: those from mail or
a fleet brief, and the rest.

ask-kit's own investigator sessions are left out. A resumed or forked Claude Code session copies
its parent's history; a chain is counted once, in the session that made it. Subagent transcripts
are not read.

The first run over 30 days of a busy machine takes about half a minute. Results per session are
kept in `<state>/index/gaps.json`, so a second run takes under a second. `--json` prints the
whole report as JSON.

## What init puts in each agent

The source for all of these is in the repository's `bundle/` folder: `bundle/skills/`,
`bundle/agents/ask-kit-tuner.md` and `bundle/rules/ask.md`.

| Agent | `ask` tool | Skills | Tuner agent | When-to-ask rule |
|---|---|---|---|---|
| Claude Code | `claude mcp add -s user` | `~/.claude/skills/` | `~/.claude/agents/` | `~/.claude/rules/ask-kit.md` |
| Codex | `config.toml` block, 600 s tool timeout | `~/.codex/skills/` | (as a skill) | block in `~/.codex/AGENTS.md` |
| Copilot CLI | `~/.copilot/mcp-config.json` | `~/.copilot/skills/` | `~/.copilot/agents/` | `~/.copilot/instructions/ask-kit.instructions.md` |
| opencode | `opencode.json` `mcp` | `~/.config/opencode/skill/` | `~/.config/opencode/agent/` | block in its `AGENTS.md` |
| Gemini CLI | `settings.json` | `~/.gemini/skills/` | (as a skill) | block in `~/.gemini/GEMINI.md` |

Each file is recorded with its hash in `installed.json`. A file you edit is never overwritten,
and `ask-kit uninstall` removes only what ask-kit wrote.

## Files

| What | Linux and macOS | Windows |
|---|---|---|
| Config, written by setup | `~/.config/ask-kit/config.json` | `%APPDATA%\ask-kit\config.json` |
| Keys you pasted (mode 0600) | `~/.config/ask-kit/keys.env` | `%APPDATA%\ask-kit\keys.env` |
| The guide for agents | `~/.config/ask-kit/AGENTS.md` | `%APPDATA%\ask-kit\AGENTS.md` |
| Your own domains | `~/.config/ask-kit/domains/` | `%APPDATA%\ask-kit\domains\` |
| Journals, REPL snapshots, warm sessions, transcript index | `~/.local/state/ask-kit/` | `%LOCALAPPDATA%\ask-kit\state\` |

`XDG_CONFIG_HOME` and `XDG_STATE_HOME` are honoured. `ASK_KIT_CONFIG` and `ASK_KIT_STATE` move
the two folders anywhere.

Every file, folder and environment variable is listed in
[Files and environment variables](reference/files-and-env.md), and every config key in
[Config file](reference/config.md). [Setup](internals/setup.md) explains what each command does
inside.
