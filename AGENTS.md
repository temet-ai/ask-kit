# Setting up ask-kit (for the agent reading this)

The person you work for pasted a line like "Read this file, then set up ask-kit for me". This
file is everything you need to do that on Linux, macOS or Windows, from nothing. Work through it
in order, tell the person briefly what you are doing, and ask them only the questions in step 4.

ask-kit gives coding agents (you included) one tool, `ask`: a question in plain words goes to a
cheap investigator model with a JavaScript REPL and ready-made scripts, which digs through this
machine's agent transcripts or the current repository outside your context, and answers with
evidence. It reads the transcripts Claude Code, Codex, GitHub Copilot CLI, Gemini CLI and
opencode already write; it needs no server and no account of its own.

## 1. Check what it needs

- **Node.js 22.13 or newer**: `node --version`. If it is missing or older, tell the person and
  offer the usual way for their system (macOS: `brew install node`; Windows:
  `winget install OpenJS.NodeJS.LTS`; Linux: their package manager, or `mise use -g node@lts`).
  Install it only on their yes.
- **git**: needed to fetch ask-kit and shared domains. ripgrep is bundled; nothing else is needed.

## 2. Install ask-kit

One command, the same on every system:

```sh
npm install -g --allow-git=root github:temet-ai/ask-kit
```

npm 12 refuses packages from git unless `--allow-git` is given; older npm ignores the flag. If
global npm installs are not allowed, clone instead and use
the full path wherever this file says `ask-kit`:

```sh
git clone https://github.com/temet-ai/ask-kit <folder>   # e.g. ~/.local/share/ask-kit, or %LOCALAPPDATA%\ask-kit
cd <folder> && npm install
node <folder>/bin/ask-kit.mjs --help
```

## 3. Put its skills, agent and rule where every agent finds them

```sh
ask-kit init
```

This writes, for each coding agent installed here, in that agent's own format: the skills
`ask-kit-setup`, `ask-kit-improve` and `ask-kit-domain`, the `ask-kit-tuner` agent where the
agent has custom agents, and a short rule saying when to call `ask`. It records each file's hash
and leaves alone any file the person has edited. It also writes ask-kit's own guide,
`~/.config/ask-kit/AGENTS.md` (Windows: `%APPDATA%\ask-kit\AGENTS.md`), with this machine's
paths: read that guide now; it is what you and other agents use from here on.

It prints anything missing (old Node, no git). Fix those with the person before going on.

## 4. Ask the person what to use

Run `ask-kit questions`. It prints what this machine has (agents and how many sessions each has
on disk, subscriptions that can run the investigator, API keys found by name, local model
servers) and five questions, each with options, a suggestion and why. Follow the ask-kit-setup
skill (installed in step 3; its text is also in `bundle/skills/ask-kit-setup/SKILL.md` of the
install). In short:

1. Say in two sentences what you found.
2. Ask the questions one at a time, the suggested option first. The one that matters is which
   model does the digging: an API key is cheapest and fastest (about a third of a cent per
   question on the suggested model); a subscription they already have (Claude, ChatGPT through
   Codex, Copilot) costs nothing extra but is slower; a local model is free and private but
   answers worse.
3. If they pick an API whose key was not found, ask where it is (an environment variable name, a
   file, or the key itself, which ask-kit stores with owner-only permissions). Never echo a key.
4. Write the answers as JSON, run `ask-kit apply <file> --dry-run`, show them the changes, and
   apply only on their yes.

## 5. Check and hand over

- `ask-kit doctor`: every source shows sessions, every API backend shows `ok`.
- One question from the shell: `ask-kit ask --domain sessions "what did I work on yesterday?"`.
  Show the answer.
- Tell them: restart the agents to load `ask`; follow-ups use `continue: true`; and to change
  anything later they paste `Read ~/.config/ask-kit/AGENTS.md, then <what they want>` into any
  agent. `ask-kit lines` prints the useful lines.

## If something fails

- `ask-kit detect` shows what was found; `ask-kit doctor` checks the config.
- An agent CLI (claude, codex, copilot) as the investigator must be signed in: run it once by
  hand.
- Codex drops tool calls at 60 s by default; setup sets `tool_timeout_sec = 600` for `ask` in its
  config.toml. Other agents' timeouts are long enough.
- Remove everything ask-kit installed: `ask-kit uninstall` (`--dry-run` first).
