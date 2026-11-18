# Setup, installation and reporting

This part of the code finds what a machine has, asks the questions, writes ask-kit's config,
registers the `ask` server with each coding agent, installs the skills, agent and rule, writes the
per-machine guide and reports on how `ask` is doing. The commands are `init`, `questions`,
`apply`, `setup`, `doctor`, `detect`, `uninstall` and `report`. For the user's view see
[Set it up](../setup.md) and [Command line](../command-line.md).

## Files

| File | What is in it |
|---|---|
| [bin/ask-kit.mjs](https://github.com/temet-ai/ask-kit/blob/main/bin/ask-kit.mjs) | The command switch in `main()`, and the functions `wizard()` (`setup`), `init()`, `uninstall()`, `doctor()`, `summary()` and `printDetect()`. |
| [src/setup/detect.mjs](https://github.com/temet-ai/ask-kit/blob/main/src/setup/detect.mjs) | `detect({counts})`: agents, subscription CLIs, API keys (by name), local model servers and tools. |
| [src/setup/questions.mjs](https://github.com/temet-ai/ask-kit/blob/main/src/setup/questions.mjs) | `questions(d)`, `investigatorChoices(d)`, `keyQuestion(preset)`. The answers format is in the header comment. |
| [src/setup/apply.mjs](https://github.com/temet-ai/ask-kit/blob/main/src/setup/apply.mjs) | `plan(answers, d)` (pure), `apply(answers, d, {dry})`, `backendName(id)`, and the private `backendFor`. |
| [src/setup/register.mjs](https://github.com/temet-ai/ask-kit/blob/main/src/setup/register.mjs) | `REGISTER`: one function per agent returning `{client, what, run(), remove()}`. `SERVE` is the command an agent starts. |
| [src/setup/bundle.mjs](https://github.com/temet-ai/ask-kit/blob/main/src/setup/bundle.mjs) | `TARGETS` (where each agent keeps skills, agents and rules), `filesFor`, `render`, `installBundle`, `uninstallBundle`, and the `MARK` and `MANIFEST` constants. |
| [src/providers.mjs](https://github.com/temet-ai/ask-kit/blob/main/src/providers.mjs) | `API_PRESETS`, `AGENT_CLIS`, `AGENTS`: the data detection and the questions are built from. |
| [src/agentsmd.mjs](https://github.com/temet-ai/ask-kit/blob/main/src/agentsmd.mjs) | `AGENTS_MD`, `agentsMd()` (the text), `writeAgentsMd()`. |
| [src/config.mjs](https://github.com/temet-ai/ask-kit/blob/main/src/config.mjs) | `CONFIG_DIR`, `STATE_ROOT`, `CONFIG_FILE`, `KEYS_FILE`, `loadConfig`, `saveConfig`, `storeKey`, `resolveKey`, `readEnvFile`. |
| [src/platform.mjs](https://github.com/temet-ai/ask-kit/blob/main/src/platform.mjs) | `which`, `spawnCli`, `runCli`, `rgPath`. |
| [src/report.mjs](https://github.com/temet-ai/ask-kit/blob/main/src/report.mjs) | `report({since})`. |
| [bundle/](https://github.com/temet-ai/ask-kit/tree/main/bundle) | `rules/ask.md`, `agents/ask-kit-tuner.md`, `skills/ask-kit-setup/SKILL.md`, `skills/ask-kit-improve/SKILL.md`, `skills/ask-kit-domain/SKILL.md`. |
| [AGENTS.md](https://github.com/temet-ai/ask-kit/blob/main/AGENTS.md) | The install instructions an agent reads from GitHub, before ask-kit is installed. |
| [test/setup.mjs](https://github.com/temet-ai/ask-kit/blob/main/test/setup.mjs), [test/bundle.mjs](https://github.com/temet-ai/ask-kit/blob/main/test/bundle.mjs) | The tests. |

## Where ask-kit keeps things

`src/config.mjs` decides, once at import. `src/platform.mjs` does not hold paths; it holds program
lookup and process starting.

| Constant | Linux and macOS | Windows | Overridden by |
|---|---|---|---|
| `CONFIG_DIR` | `$XDG_CONFIG_HOME/ask-kit`, else `~/.config/ask-kit` | `%APPDATA%\ask-kit` | `ASK_KIT_CONFIG` |
| `STATE_ROOT` | `$XDG_STATE_HOME/ask-kit`, else `~/.local/state/ask-kit` | `%LOCALAPPDATA%\ask-kit\state` | `ASK_KIT_STATE` |
| `CONFIG_FILE` | `CONFIG_DIR/config.json` | same | |
| `KEYS_FILE` | `CONFIG_DIR/keys.env` | same | |

Other files: `CONFIG_DIR/installed.json` (the bundle's record), `CONFIG_DIR/AGENTS.md` (the
guide), `CONFIG_DIR/domains/` (your domains) and `STATE_ROOT/` (journals, REPL snapshots, warm
sessions, the transcript index, `gallery/` clones).

The agents' own folders are separate and each has its own variable: `CLAUDE_CONFIG_DIR`,
`CODEX_HOME`, `COPILOT_HOME`, `GEMINI_CLI_HOME`, `OPENCODE_DB`, and for opencode's config
`XDG_CONFIG_HOME`, for its database `XDG_DATA_HOME`.

**`XDG_CONFIG_HOME`, `XDG_STATE_HOME` and `XDG_DATA_HOME` take precedence over `HOME`.** On a
machine where they are set (most Linux desktops), running ask-kit with a different `HOME` and
nothing else still reads and writes the real config, state, opencode config and opencode
database. To test without touching a real machine, set `ASK_KIT_CONFIG` and `ASK_KIT_STATE`
and every agent variable the test touches, as `test/setup.mjs` and `test/bundle.mjs` do. Also
note that `os.homedir()` reads `HOME` on Linux and macOS, so `~` in the key-file list of an API
preset follows `HOME` but not `XDG_CONFIG_HOME`.

## `detect`: what the machine has

`detect({counts})` in `src/setup/detect.mjs` returns `{agents, clis, apis, local, tools,
existing}`. It runs programs and probes ports, so it is not free of side effects.

- **agents:** for each entry of `AGENTS` it looks the binary up with `which()` (a search of `PATH`
  that handles `PATHEXT` on Windows). If the binary is found it runs `<bin> --version` with a
  6-second timeout. `onPath` is true only when that command exits with status 0. A binary that is
  found but fails (a version manager's shim with no version set) is reported with `broken` and
  `onPath: false`. It also records the transcript store (`adapter.where()` when
  `adapter.available()`) and, with `counts`, the number of sessions, which builds the transcript
  index cache.
- **clis:** the agent CLIs that can act as the investigator (`AGENT_CLIS`: `claude`, `codex`,
  `copilot`), whether the binary is on `PATH`, and whether it is signed in: `claude auth status`
  (JSON), `codex login status`. Copilot has no status command, so it is reported as `ok` with the status text "not checked".
- **apis:** for each non-local preset in `API_PRESETS`, whether its key variable is set in the
  environment, in one of the preset's `keyFiles`, or in `keys.env`. It stores where, never the value.
- **local:** `GET <baseUrl>/models` on Ollama and LM Studio, with an 800 ms timeout.
- **tools:** Node version (`nodeOk` means 22.13 or newer), `rgPath()`, `which("git")`, platform.
- **existing:** the parsed `config.json` if one exists.

`ask-kit detect` prints it (`--json` for the data). `ask-kit questions` runs it with counts and
prints `summary(d)`, the questions and `existing`.

## `questions`: the conversation

`questions(d)` builds five questions in this order: `sources`, `clients`, `investigator`,
`extras`, `domains`. Each has `id`, `type` (`multi`, `single`), `question`, `why`, `options` and
`suggested`. The terminal wizard and an agent running the `ask-kit-setup` skill ask the same
questions.

- `sources` lists agents that have a transcript store. `clients` lists agents that are on `PATH`
  and whose `AGENTS` entry has a `client` (opencode has `client: null`, so it is never offered).
- `investigatorChoices(d)` makes one choice per model: each API preset model, each agent CLI
  model, and each model a local server reports (embedding, reranking, OCR and whisper models are
  filtered out). The `rank` field orders them: ready API models first (OpenRouter before others),
  then CLIs (Claude, Codex, Copilot), then local models. The suggestion is the first ready choice.
- `extras` suggests up to two more ready choices, never a Copilot one.
- `domains` offers `sessions` and `code`, both suggested.
- `keyQuestion(preset)` is asked separately, only for an API without a key found.

Choice ids look like `openrouter:z-ai/glm-5.3-flash` or `claude-cli:haiku`.

## `apply` and `setup`: answers to config and registrations

`ask-kit apply <file|->` reads answers as JSON, runs `detect({counts: false})` and calls
`apply(answers, d, {dry})`. `ask-kit setup` (`wizard()`) asks the questions on a terminal, shows
`apply(..., {dry: true})`, and applies on a yes. `--dry-run` prints `{config, changes, applied: []}`
and writes nothing.

`plan(answers, d)` is pure apart from what the registrations read:

1. The backend list: `answers.investigator` first, then `answers.extras`. `backendName(id)` makes
   the key (`claude-haiku`, `codex`, `glm-5.3-flash`), `backendFor` the value:
   `{kind: "claude-cli", model}` for a CLI, or `{kind: "api", preset, model, key}` for an API. A
   pasted key becomes the marker `{value: true}`; a named variable or file is kept as `{env}` or
   `{file, var}`; otherwise the first key found by `detect` is used; with none it throws.
2. The config object:

   ```js
   { version: 1, sources, clients, backends: { default, list }, domains, router, setupAt }
   ```

   `domains` is `{ <name>: { enabled: true } }` for each name in `answers.domains` (default
   `sessions` and `code`). `router` is `{ backend: <name> }` for the first API backend in the
   list, or `null`.
3. `changes`: write the config, one `REGISTER[client]()` per chosen client that has a registrar,
   and one bundle install (computed with `installBundle(clients, {dry: true})`, listed only when
   something would change).

`apply()` then, in order: replaces each `{value: true}` key by `storeKey()` (which writes
`keys.env`, mode 0600, and returns `{file, var}`); `saveConfig()` (temporary file, mode 0600, then
rename); `writeAgentsMd()`; and runs each change, catching its error into
`applied: [{client, what, ok, error?}]`. A failed registration does not undo the config.

Config never holds a key. `resolveKey(ref)` reads `{env}` or `{file, var}` at use.

## Registering `ask`: `REGISTER`

`SERVE` is `{command: process.execPath, args: [<root>/bin/ask-kit.mjs, "serve"]}`: the absolute
path of the Node that ran setup. Each registrar returns an object with `what` (shown to the user),
`run()` and `remove()`. The entries are built when `plan` runs, so some read the machine at that
point.

| Agent | What it writes |
|---|---|
| Claude Code | Runs the `claude` CLI: `claude mcp get ask` to see if it exists, then `claude mcp add -s user ask -- <node> <bin> serve` (after `remove` when it exists). |
| Codex | A marked block in `$CODEX_HOME/config.toml` (default `~/.codex`): `[mcp_servers.ask]` with `tool_timeout_sec = 600` and `startup_timeout_sec = 30`. The markers are `# >>> ask-kit ...` and `# <<< ask-kit`. If an `[mcp_servers.ask]` exists outside the markers, it is left alone and the entry says skip. |
| Copilot CLI | `mcpServers.ask` in `$COPILOT_HOME/mcp-config.json` (default `~/.copilot`). |
| Gemini CLI | `mcpServers.ask` in `~/.gemini/settings.json`, with a 600 s timeout. It uses the home folder directly, not `GEMINI_CLI_HOME`. |
| opencode | `mcp.ask` in `$XDG_CONFIG_HOME/opencode/opencode.json` (default `~/.config/opencode`). |

`jsonServer()` reads the file (an unreadable or missing file counts as `{}`), sets the key and
writes it back, with two-space indentation.

## The bundle: skills, agent and rule

`bundle/` holds one source of each file. `installBundle(agents, {dry, force})` renders it into
each agent's own format and folder, driven by `TARGETS`:

| Agent | Base folder | Skills | Agent file | Rule |
|---|---|---|---|---|
| Claude Code | `CLAUDE_CONFIG_DIR` or `~/.claude` | `skills/` | `agents/` (as is) | `rules/ask-kit.md`, a file |
| Codex | `CODEX_HOME` or `~/.codex` | `skills/` | none | a marked block in `AGENTS.md` |
| Copilot CLI | `COPILOT_HOME` or `~/.copilot` | `skills/` | `agents/` (name and description only) | `instructions/ask-kit.instructions.md`, with `applyTo: "**"` front matter |
| opencode | `$XDG_CONFIG_HOME/opencode` or `~/.config/opencode` | `skill/` | `agent/` (description, `mode: subagent`) | a marked block in `AGENTS.md` |
| Gemini CLI | `GEMINI_CLI_HOME` or `~/.gemini` | `skills/` | none | a marked block in `GEMINI.md` |

opencode and Gemini have `verified: false`: the format comes from the agent's documentation.

`render(text)` replaces `{{ASK_KIT}}` (the Node path plus `bin/ask-kit.mjs`) and `{{AGENTS_MD}}`
(the guide's path) in every file, so a skill names the exact command for this machine.
`filesFor(agent)` reads `bundle/skills/*/SKILL.md`, `bundle/agents/*.md` and `bundle/rules/ask.md`.

### Hash tracking in `installed.json`

`MANIFEST` is `CONFIG_DIR/installed.json`: `{ files: { <path>: <hash> }, blocks: { <path>: true } }`.
The hash is the first 16 hex digits of the SHA-256 of the content ask-kit wrote. For each file
`installBundle` compares the file on disk with the new content and the recorded hash:

| State | Action |
|---|---|
| File missing | `write` |
| Content equals the new content | `unchanged` (the hash is recorded, which adopts a matching file) |
| Differs, no hash recorded | `skip-not-ours`, or `replace` with `force` |
| Differs, hash matches the file on disk | `replace`: still as ask-kit wrote it, so update it |
| Differs, hash does not match | `skip-edited`, or `replace` with `force` |

An agent whose base folder does not exist gets one row, `skip-no-agent`, and nothing is written.

Rules in `file` mode use the same table. Rules in `block` mode are written between
`<!-- >>> ask-kit: written by ... -->` and `<!-- <<< ask-kit -->`. The block is added when the
markers are absent (`block-add`) and replaced in place when present (`block-replace`), whatever
was edited inside it; the file's path goes under `blocks` in the manifest. Text outside the
markers is never touched.

`uninstallBundle({dry})` removes each recorded file whose hash still matches (`remove`), leaves an
edited one (`skip-edited`), reports a missing one (`gone`), deletes an emptied skill folder, and
strips each recorded block. It saves the manifest, dropping removed entries.

## `init`: put the bundle in place without configuring anything

`init()` in `bin/ask-kit.mjs`:

1. `writeAgentsMd()`.
2. `detect({counts: false})`.
3. `present` = the `TARGETS` agents whose detection has `onPath` true.
4. `installBundle(present, {force})`.
5. Prints a line per agent with its file count, and the files it left alone.
6. Prints "not found here" for every agent in `TARGETS` that is not in `present`, **or** whose
   base folder does not exist (the `skip-no-agent` row).

It writes the bundle, `installed.json` and `AGENTS.md`. It does not write `config.json` and does
not register `ask`; that is `setup` or `apply`.

### Why `init` and `questions` can disagree about an agent

Both start from the same field, `onPath`, which is the result of `which(bin)` followed by a
successful `<bin> --version`. They use it differently.

- `questions` shows it as `installed` in `found.agents`.
- `init` also needs the agent's base folder (`TARGETS[agent].base()`: `~/.copilot` or
  `COPILOT_HOME` for Copilot). When it is missing, `installBundle` returns `skip-no-agent` and
  `init` prints "not found here", although `installed` is true.

A Copilot CLI that is on `PATH` but has no `~/.copilot` folder yet (it has never been started, or
`HOME` or `COPILOT_HOME` points elsewhere) gives exactly this pair of messages. A shell function
wrapping `command copilot` does not matter to either check, because both look for an executable
file on `PATH` from Node, not in the shell. A `--version` that takes longer than 6 seconds on one
run would also make `onPath` false in one command and true in the other.

The message "not found here" does not say which of the two causes applies.

## `doctor`

`doctor()` loads the config (it throws "not set up yet" without one), writes `AGENTS.md`, and prints:

- Node version and platform, ripgrep and git;
- for each source in `config.sources`, the session count, or `missing (<where>)`;
- for each backend: for an `api` backend, a `GET <baseUrl>/models` with the key (8-second timeout),
  reporting the HTTP status, an unknown model, or `ok`; for Ollama the model's context length
  against the context ask-kit asks for (`contextTokens`, default 32,768 in `src/ollama.mjs`); for a CLI backend, "checked on
  first ask";
- the domain names and the router (`router.backend`, or "keyword rules").

It lists every key of `config.domains`, including those with `enabled: false`.

## `uninstall`

`uninstall()` goes through `config.clients`, calls each `REGISTER[client]().remove()` (for Claude
Code `claude mcp remove -s user ask`; for Codex it strips the marked block; for JSON files it
deletes `ask`), then `uninstallBundle()`. With `--dry-run` it prints what it would do. The config,
keys and journals stay. Without a config file there is nothing in `clients`, so no registration is
removed.

## The guide: `src/agentsmd.mjs`

`agentsMd()` builds a Markdown file with this machine's real values: the command
(`process.execPath` plus `bin/ask-kit.mjs`), a "Now" section from `config.json` (sources,
clients, backends, domains, router; or "Not set up yet"), the file locations from `config.mjs`,
the domain folders from `domainDirs()`, the domains from `listDomains()`, and the task list an
agent matches a request against. `writeAgentsMd()` rewrites the file only when the text changed,
creates `CONFIG_DIR` with mode 0700, and never throws.

It runs in `init`, `apply`, `doctor`, `ask-kit add` and in `serve`, which means every time an agent
starts the MCP server. The skills and the rule point agents at this file through `{{AGENTS_MD}}`.

## `ask-kit report`

`report({since})` in `src/report.mjs` reads the journals under `STATE_ROOT`. The folder walk skips
`warm`, `drafts`, `gallery` and `index`. The first path segment is the domain name. `since` is
`<n>h`, `<n>d` or a date (default `7d`).

- A line with `type: "ask"` is an ask. Any other line with a `code` field is a cell.
- For cells it counts script runs per `<domain>/<script>` (with `(draft)` for drafts, and failures
  where `ok` is false and the script was not just saved). A cell that ran no script is a hand-written
  cell; `shapeOf` blanks string and number literals, `const` names and whitespace, keeps 90
  characters, and counts equal shapes.
- Each ask gets signals: `failed: <error>` or `cancelled`; `cut off` or `out of steps or time`
  (`partial`); `answered at the step limit` (`atLimit`); `slow` over 90 s; `costly` over $0.02;
  `missteps` over 2; `empty answer`; and `re-asked` when the same session asks again within 3
  minutes without `continue` (`re-asked on another backend` when the backend differs).
- The result: totals, `medianSeconds`, `flaggedAsks`, `scripts` by runs, and `worthAScript`, the
  shapes written by hand three or more times (at most 10).

The journal fields it reads (`ok`, `partial`, `cutAtLength`, `atLimit`, `ms`, `costUsd`, `missteps`,
`answerChars`, `session`, `continued`, `backend`, `question`, `cells` or `turns`) are written by
`registerAsk` in `src/ask.mjs` through the `keep` callback in `src/server.mjs`. Renaming one
there changes the report. See [the journal](../reference/journal.md).

## What to look at when changing it

- A new coding agent: `AGENTS` and, if it can run the investigator, `AGENT_CLIS` in
  `src/providers.mjs`; `TARGETS` in `bundle.mjs`; `REGISTER` in `register.mjs`; an adapter in
  `src/transcripts/`. See [add an agent](../guides/add-an-agent.md).
- A new API preset: `API_PRESETS` in `providers.mjs`. `detect` and `questions` pick it up from
  there. See [add a backend](../guides/add-a-backend.md).
- A new question: add it to `questions()`, handle the answer in `plan()`, document it in the
  header of `questions.mjs`, and update the `ask-kit-setup` skill, which tells agents what the
  questions mean.
- Anything that writes outside `CONFIG_DIR` and `STATE_ROOT` must use the agent's own
  environment variable, as `TARGETS` does, so tests can redirect it.
- Tests. `test/setup.mjs` gives `questions` and `plan` a made-up detection result. It asserts the
  question ids, the suggestions, that no key means a Codex subscription is suggested, that a
  missing key throws, that config never holds a key, that `keys.env` is mode 0600, and that
  applying twice leaves one `[mcp_servers.ask]` block and keeps the user's other servers.
  `test/bundle.mjs` runs `installBundle` against throwaway agent homes and asserts each action in
  the table above, the per-agent formats, an idempotent second run, `skip-edited` and
  `skip-not-ours`, block replacement, `uninstallBundle` keeping edited files, and the guide
  containing the machine's config path. Nothing tests `detect`, `init()`, `doctor()`, `report`,
  `register.mjs` for Claude Code, Gemini or opencode, or `ask-kit uninstall`.

### Things to watch for

- **`apply` rebuilds the config.** `plan()` writes a new object from the answers. It does not
  merge with the existing file, so running `setup` or `apply` again drops `router.model`, a
  domain's `backend`, the `from` and `commit` that `ask-kit add` recorded, a backend's
  `baseUrl` or `contextTokens`, and any domain not listed in `answers.domains`. The `questions`
  output includes `existing`, so an agent can carry values over, but the code does not.
- **opencode is never registered by `setup`.** `REGISTER.opencode` exists, but
  `AGENTS.opencode.client` is `null`, so the `clients` question never offers it. `init` does
  install its bundle.
- **Gemini registration ignores `GEMINI_CLI_HOME`**, while the bundle and the transcript adapter
  honour it.
- **`render()` and `agentsMd()` build the command differently.** `render()` passes `process.execPath`
  through `JSON.stringify(...).slice(1, -1)`, which doubles backslashes on Windows, and neither
  quotes a path with spaces.
- **The guide's table is split.** In `agentsMd()` the line "Domains available now ..." sits between
  table rows, so the "Journals" and "ask-kit itself" rows render as plain text.
