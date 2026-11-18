# Set it up

ask-kit is set up by a conversation with the agent you already use. Paste this one line into
Claude Code, Codex, Copilot CLI, Gemini CLI or opencode, on Linux, macOS or Windows:

```
Read https://github.com/temet-ai/ask-kit/blob/main/AGENTS.md, then set up ask-kit for me.
```

[AGENTS.md](https://github.com/temet-ai/ask-kit/blob/main/AGENTS.md) is written for the agent.
It works through these steps and tells you what it is doing.

## 1. It checks what is needed

Node.js 22.13 or newer, and git. If Node is missing or too old, the agent says so and offers the
usual way to install it on your system (`brew install node`, `winget install OpenJS.NodeJS.LTS`,
your package manager or `mise use -g node@lts`). It installs nothing without your yes. ripgrep is
bundled.

## 2. It installs ask-kit

```sh
npm install -g github:temet-ai/ask-kit
ask-kit init
```

`ask-kit init` finds every coding agent on the machine and puts three things into each, in that
agent's own format:

- the skills `ask-kit-setup`, `ask-kit-improve` and `ask-kit-domain`,
- the `ask-kit-tuner` agent, where the agent has custom agents (Codex and Gemini get it as a
  skill),
- a short rule saying when to call `ask` instead of searching itself.

| Agent | `ask` tool | Skills | Tuner agent | When-to-ask rule |
|---|---|---|---|---|
| Claude Code | `claude mcp add -s user` | `~/.claude/skills/` | `~/.claude/agents/` | `~/.claude/rules/ask-kit.md` |
| Codex | `config.toml` block, 600 s tool timeout | `~/.codex/skills/` | (as a skill) | block in `~/.codex/AGENTS.md` |
| Copilot CLI | `~/.copilot/mcp-config.json` | `~/.copilot/skills/` | `~/.copilot/agents/` | `~/.copilot/instructions/ask-kit.instructions.md` |
| opencode | `opencode.json` `mcp` | `~/.config/opencode/skill/` | `~/.config/opencode/agent/` | block in its `AGENTS.md` |
| Gemini CLI | `settings.json` | `~/.gemini/skills/` | (as a skill) | block in `~/.gemini/GEMINI.md` |

It also writes ask-kit's own guide, with this machine's paths, to `~/.config/ask-kit/AGENTS.md`
(Windows: `%APPDATA%\ask-kit\AGENTS.md`). The agent reads it next, and so does any agent you ask
to change ask-kit later.

Every file `init` writes is recorded with its hash in `installed.json`. A file you have edited is
never overwritten, and `ask-kit uninstall` removes only what ask-kit wrote.

## 3. It asks you a few questions

The agent runs `ask-kit questions`, which lists what the machine has: each agent's transcripts
with how many sessions are on disk, the subscriptions that can run an investigator, API keys
found by name, and local model servers. Then it asks, one at a time, with a suggestion first:

- whose past sessions to read,
- which agents should get `ask`,
- which model does the digging (see [Choose the model that digs](models.md)),
- whether to answer about sessions, code or both.

If you pick an API whose key it did not find, it asks where the key is: an environment variable,
a file, or the key itself. The config records where a key is, never the key. A key you paste goes
to `~/.config/ask-kit/keys.env` with owner-only permissions.

It writes your answers to a file, runs `ask-kit apply <file> --dry-run`, shows you the changes,
and applies them only on your yes.

## 4. It checks and hands over

- `ask-kit doctor` checks that every source has sessions and every API backend answers.
- `ask-kit ask --domain sessions "what did I work on yesterday?"` asks one question from the
  shell, so you see an answer before you rely on it.

Restart your agents so they load the `ask` tool.

## Change it later

Any agent changes ask-kit from one line, starting with the guide `init` wrote:

```
Read ~/.config/ask-kit/AGENTS.md, then switch ask's default model to codex.
Read ~/.config/ask-kit/AGENTS.md, then add this domain: github.com/<owner>/<repo>
```

`ask-kit lines` prints the useful ones.

## Without an agent

`ask-kit setup` asks the same questions in the terminal:

```sh
npm install -g github:temet-ai/ask-kit
ask-kit init
ask-kit setup
```

If global npm installs are not allowed, clone the repository, run `npm install` in it, and use
`node <folder>/bin/ask-kit.mjs` wherever this guide says `ask-kit`.
