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
ask-kit gallery                  shared domains
ask-kit add <repo> [--yes]       show a shared domain's files; --yes installs and enables it
ask-kit lines                    the one-line prompts for any agent
ask-kit uninstall [--dry-run]    remove what ask-kit installed (not your edits)
ask-kit serve [--domain d]       the MCP server your agents start
```

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
