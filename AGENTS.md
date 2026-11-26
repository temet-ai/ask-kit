# ask-kit (for the agent reading this)

This file has two parts. If the person you work for pasted a line like "Read this file, then set
up ask-kit for me", follow steps 1 to 5 and stop before "Working on this repository". If you are
changing ask-kit's own code in a checkout of this repository, skip to
[Working on this repository](#working-on-this-repository).

# Setting up ask-kit

Steps 1 to 5 are everything you need to set ask-kit up on Linux or macOS, from nothing.
Work through them in order, tell the person briefly what you are doing, and ask them only the
questions in step 4.

ask-kit gives coding agents (you included) one tool, `ask`: a question in plain words goes to a
cheap investigator model with a JavaScript REPL and ready-made scripts, which digs through this
machine's agent transcripts or the current repository outside your context, and answers with
evidence. It reads the transcripts Claude Code, Codex, GitHub Copilot CLI, Gemini CLI and
opencode already write; it needs no server and no account of its own.

## 1. Check what it needs

- **Node.js 26**: `node --version`. If it is missing or a different major version, tell the
  person and offer Node 26 through their package manager, or `mise use -g node@26`.
  Install it only on their yes.
- **git**: needed to fetch ask-kit and shared domains. ripgrep is bundled; nothing else is needed.

## 2. Install ask-kit

One command, the same on every system:

```sh
npm install -g @temet-ai/ask-kit
```

If it fails with `EACCES` or "permission denied", npm's global folder belongs to root. This is
usual on Linux when Node came from the system package manager (`npm prefix -g` prints `/usr`).
Don't use sudo; install into the person's home instead:

```sh
npm install -g --prefix ~/.local @temet-ai/ask-kit
```

`ask-kit` is then `~/.local/bin/ask-kit`. If `command -v ask-kit` finds nothing, `~/.local/bin`
is not on PATH: use the full path for now and tell the person to add it to PATH.

If npm can't install at all, clone instead and use the full path wherever this file says
`ask-kit`:

```sh
git clone https://github.com/temet-ai/ask-kit <folder>   # e.g. ~/.local/share/ask-kit
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
`~/.config/ask-kit/AGENTS.md`, with this machine's
paths: read that guide now; it is what you and other agents use from here on.

It prints anything missing (old Node, no git). Fix those with the person before going on.

## 4. Ask the person what to use

Run `ask-kit questions`. It prints what this machine has (agents and how many sessions each has
on disk, subscriptions that can run the investigator, API keys found by name, local model
servers) and six questions, each with options, a suggestion and why. Follow the ask-kit-setup
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

# Working on this repository

This part is for an agent changing ask-kit itself. `CONTRIBUTING.md` has the same commands for
people, and releasing.

## Commands

Node.js 26, ESM, no build step, no linter, no formatter. Keep each file's style:
two-space indent, double quotes, long lines.

```sh
npm ci
npm test                    # every test/*.mjs through test/run.mjs, about 45 s, no model, no network
node test/run.mjs router    # only the test files whose names contain "router"
node test/<name>.mjs        # one test file directly; prints ok
node --check <file>         # syntax check after an edit
npm run test:machine        # test/adapters.mjs against this machine's real transcripts; not in CI
node bin/ask-kit.mjs --help # run this checkout
```

- `ask-kit` on PATH is the global npm install. Run this checkout as `node bin/ask-kit.mjs`.
- Tests are plain Node scripts using `node:assert/strict`. A new file under `test/` runs by being
  there. CI runs `npm test` on Linux and macOS with Node 26.
- `serve`, `ask`, `init`, `setup`, `apply`, `kit link|enable|disable|install` and `kit test` write
  the live `~/.config/ask-kit` (config.json, and AGENTS.md rewritten with this checkout's paths).
  When trying them from this checkout, set `ASK_KIT_CONFIG` and `ASK_KIT_STATE` to a scratch
  folder. For a throwaway home, also set `XDG_CONFIG_HOME`, `XDG_DATA_HOME` and `XDG_STATE_HOME`.
- `kit test` and everything in `bench/` call real models and cost money. Run them only when the maintainer
  asks for that specific run, once, through `.claude/skills/ask-kit-kit-test/scripts/kit-test.sh`.
  A change is done when its offline test passes; the `ask-kit-offline-test` skill shows how to
  write one (fixture kit, scripted backend on 127.0.0.1, `ask` driven over MCP).

### Files that must be regenerated or kept in step

- After changing anything in `bundle/`, run `node bin/ask-kit.mjs plugin build` to refresh the
  Claude Code plugin's copies in `plugin/`. `test/plugin.mjs` fails until you do.
- The version must match in `package.json`, `server.json` (twice), `.claude-plugin/plugin.json`
  and `gemini-extension.json` (twice). `test/plugin.mjs` checks it. A tag `vX.Y.Z` runs
  `.github/workflows/release.yml`, which publishes to npm and the MCP Registry.
- After changing a dependency: `node scripts/notices.mjs > THIRD-PARTY-NOTICES.md`.
- A change to what ask-kit stores or sends updates "What it stores and sends" in `README.md` and
  `docs/user-guide/privacy.md` in the same commit.

## Architecture

### The processes of one ask

```
the agent (Claude Code, Codex, ...)
  └─ node bin/ask-kit.mjs serve          MCP server with one tool: ask
       └─ src/router.mjs                 picks a domain; starts and keeps one child per domain
            └─ node src/server.mjs       outer face of one domain; tool: ask (registerAsk in src/ask.mjs)
                 └─ the investigator     claude -p, codex exec, copilot -p, or the API loop in ask.mjs
                      └─ node src/server.mjs   inner face, ASK_KIT_INNER=1; tools: repl, help, reset, load
                           └─ node:vm context with the domain's globals, toolkit and scripts
```

- `src/server.mjs` is both faces of a domain server. Without `ASK_KIT_INNER` it registers only
  `ask`; with `ASK_KIT_INNER=1` it is the investigator's REPL. Neither face registers the other's
  tools.
- `src/router.mjs` chooses the domain from the caller's `about`, a follow-up (`continue: true`), a
  router model or keyword rules. Its caller side uses `@modelcontextprotocol/server` (SDK v2,
  protocol revision 2026-07-28) so a slow ask can be answered with an MCP task (`taskBoard`);
  everything below it uses `@modelcontextprotocol/sdk` 1.x.
- `src/ask.mjs` holds the backends (three agent CLIs and an OpenAI-compatible API loop), the warm
  session, follow-ups, escalate and hedge for slow asks, cost and step accounting, and the journal
  row each ask writes. `ask-kit report` (`src/report.mjs`) reads those journals.
- Child processes get their environment through `childEnv`/`replEnv` in `src/ask.mjs`, which strip
  `ASK_KIT_SESSION`, `ASK_KIT_CALLER`, `ASK_KIT_INHERIT` and the agents' session ids. A child that
  keeps the caller's `ASK_KIT_SESSION` writes into the caller's REPL state.
- The investigator's prefix (instructions, scripts, API, server code, backend) is fingerprinted. A
  change re-warms on the next question, so nothing needs restarting.
- A REPL cell is rewritten by `src/core/rewrite.mjs` so its top-level names stay global between
  cells; `src/core/toolkit.mjs` holds the helpers every cell can use.

### Domains and kits

A domain is one thing `ask` can answer about. Each has a `domain.mjs` (its globals and the words
of its `ask` tool), `instructions.md` (the investigator's system prompt), `api.d.ts` (the typed API
the investigator reads) and `scripts/`. Two are built in under `domains/`: `code` (the `repo`
global over ripgrep, file reads and git, and the code map in `domains/code/map.mjs` and
`scan.mjs`, which `scripts/map-check.mjs` checks against ripgrep) and `sessions` (the `history` global over
`src/transcripts/`, one adapter per agent's transcript format).

A kit is a folder with an `ask-kit.toml` manifest that points at sources: a folder, a CLI, an MCP
server, an HTTP API or a JS module. `src/kits.mjs` turns each source into a REPL global and
generates the API and, when the kit has none, the instructions. `kits/_host/` holds what the host
gives every kit. The real kits are separate repositories under
`temet-ai/ask-kit-<name>` on GitHub, linked into `~/.config/ask-kit/kits`. Read them for
shape; don't edit or commit to them as part of host work.

Investigators act in their domain as well as read (kits send, comment, restart). The host refuses
only what prints a secret or never ends, and an ask gets the calls that change things only when
its caller asked for a change (`src/actions.mjs`). Don't add a read-only mode.

### Setup, bundle and plugin

`src/setup/` detects what the machine has, asks the setup questions, and registers the `ask` MCP
server in each agent's own config. `bundle/` holds the templates `ask-kit init` installs into each
agent (three skills, the `ask-kit-tuner` agent, the when-to-ask rule), tracked by hash so edited
files are left alone. `plugin/`, `.claude-plugin/` and `gemini-extension.json` package the same
things as a Claude Code plugin and a Gemini CLI extension. `src/nudge.mjs` is the plugin's
PostToolUse hook, and `src/warm.mjs` its async SessionStart hook, which runs the warm-ups (the
code map, and any kit's `[warm]` script) in a detached process.

### Where to read before changing something

`docs/user-guide/internals/README.md` has the full source map and a reading order.
`internals/ask-lifecycle.md` covers `src/ask.mjs`, `internals/repl.md` covers `src/server.mjs`,
`docs/design/kits.md` and `docs/user-guide/kits.md` cover kits, and
`docs/user-guide/reference/journal.md` lists the journal row fields. The specialist agents in
`.claude/agents/` (host code, investigator instructions, docs) carry the same pointers.

## Rules every change keeps

- Test data uses made-up names taken from Terry Pratchett's Discworld (`Sam Vimes`,
  `ankh-morpork/watch`, `WATCH-12`) and the hosts `example.com` or `.invalid`. Real transcripts
  never enter the repository; write a synthetic fixture under `test/fixtures/`.
- ask-kit never writes to another agent's transcript files.
- Never print an API key or a database URL in output, tests or commit messages.
- Commits use the email `129885267+dawiddutoit@users.noreply.github.com` (check
  `git config user.email` in a fresh clone or worktree) and carry no Claude attribution lines.
