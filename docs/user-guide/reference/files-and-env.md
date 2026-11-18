# Files and environment variables

Every file and folder ask-kit reads or writes, and every environment variable it reads.

Sources:
[`src/config.mjs`](https://github.com/temet-ai/ask-kit/blob/main/src/config.mjs) (`CONFIG_DIR`,
`STATE_ROOT`, `callerSession`),
[`src/setup/bundle.mjs`](https://github.com/temet-ai/ask-kit/blob/main/src/setup/bundle.mjs)
(`TARGETS`, `installBundle`),
[`src/setup/register.mjs`](https://github.com/temet-ai/ask-kit/blob/main/src/setup/register.mjs)
(`REGISTER`),
[`src/server.mjs`](https://github.com/temet-ai/ask-kit/blob/main/src/server.mjs) and
[`src/ask.mjs`](https://github.com/temet-ai/ask-kit/blob/main/src/ask.mjs) (state files),
and the adapters in
[`src/transcripts/`](https://github.com/temet-ai/ask-kit/tree/main/src/transcripts).

## The two folders

ask-kit keeps its own files in two folders.

| Folder | Linux and macOS | Windows |
|---|---|---|
| Config folder (`CONFIG_DIR`) | `$XDG_CONFIG_HOME/ask-kit`, else `~/.config/ask-kit` | `%APPDATA%\ask-kit`, else `~\AppData\Roaming\ask-kit` |
| State folder (`STATE_ROOT`) | `$XDG_STATE_HOME/ask-kit`, else `~/.local/state/ask-kit` | `%LOCALAPPDATA%\ask-kit\state`, else `~\AppData\Local\ask-kit\state` |

`ASK_KIT_CONFIG` and `ASK_KIT_STATE` replace these paths on every system. macOS uses the Linux
paths. Folders are created with mode `0700` and the files below with `0600` where noted.

## Config folder

| Path | Written by | Read by | Contents |
|---|---|---|---|
| `config.json` | `ask-kit setup`, `apply`, `add` | every server and command | The [config](config.md). Written through a temporary file and a rename, mode `0600`. |
| `keys.env` | setup, when you paste a key | key lookup | `NAME=value` lines, mode `0600`. Config refers to it with `{ "file", "var" }`. |
| `AGENTS.md` | `init`, `setup`, `apply`, `doctor`, `serve`, `add` | agents | ask-kit's guide for agents, rewritten when its text changes, with this machine's paths and current config. Edits are overwritten. |
| `installed.json` | `init`, `setup`, `apply` | `init`, `uninstall` | `{ "files": { "<path>": "<hash>" }, "blocks": { "<path>": true } }`: the first 16 hex characters of the SHA-256 of each file ask-kit wrote, and the files holding a marked block. A file whose hash differs is one you edited, and ask-kit leaves it alone. |
| `domains/<name>/` | you, or `ask-kit add --yes` | every server | Your own domains. A folder here wins over a built-in domain of the same name. Needs a `domain.mjs`. |

## State folder

Per domain `<d>`, the state folder is `<STATE_ROOT>/<d>/`. The `code` domain adds one level per
repository: `<STATE_ROOT>/code/<repository path>/`, where the path is the root with leading
slashes removed and every other run of characters outside `A-Z a-z 0-9 . _ -` turned into `-`
(cut at 120 characters). In the table, `<state>` means that folder.

| Path | Written by | Contents |
|---|---|---|
| `<state>/<session>.jsonl` | every server | The [journal](journal.md) of one session: one line per ask and per cell. |
| `<state>/<session>.snapshot` | the REPL, after every cell | The REPL's variables, serialized with `v8.serialize` (mode `0600`, at most 64 MB). A follow-up, a restart or a fork restores it. |
| `<state>/drafts/<session>/<name>.mjs` | `scripts.draft` | Draft scripts an investigator saved. |
| `<state>/warm/<backend>.json` | `claude-cli` and `codex-cli` asks | The warm session: `{ fingerprint, sessionId, warmCostUsd, warmMs }`. A new fingerprint (instructions, scripts, API file, server code or backend config changed) re-warms. |
| `<state>/warm/last-<caller>.json` | every ask | Per backend, the investigator to continue: for `api`, `{ askId, messages }` holding the whole conversation; for the CLIs, the CLI's session id. |
| `<state>/warm/cwd/` | every ask | The working directory the agent CLIs run in. Their own transcripts land under it, and the sessions domain leaves any session there out. |
| `<state>/warm/mcp-*.json`, `copilot-mcp-*.json` | `claude-cli`, `copilot-cli` asks | A per-ask MCP config naming the REPL server. Removed when the ask ends. |
| `<STATE_ROOT>/router/<caller>.jsonl` | the router | One line per routed ask: `at`, `question` (500 characters), `domain`, `how`, `routeMs`, `routeError`. |
| `<STATE_ROOT>/router/last-<caller>.json` | the router | `{ domain, at }`: the domain that answered last, for follow-ups. |
| `<STATE_ROOT>/index/<source>.json` | the transcript adapters | A cache of each session file's metadata (modification time, size, id, title), so a listing does not re-read every transcript. Safe to delete. |
| `<STATE_ROOT>/gallery/<owner>-<repo>/` | `ask-kit add` | A shallow clone of a shared domain, replaced on each add. |

`<session>` is the file-safe form of the session id the server runs under. A calling agent's own
server uses the caller's session id. An investigator's REPL uses `ask-<uuid>` for `api` and
Copilot CLI asks. `<caller>` is the file-safe form of the calling agent's session id.

`ask-kit report` reads every `.jsonl` file under the state folder except in folders named `warm`,
`drafts`, `gallery` and `index`.

Deleting the state folder loses journals, snapshots, warm sessions and drafts. Nothing else.

## Files in the agents

`ask-kit init` and `setup` write into each agent's own folder. The base folder moves with the
variable shown.

| Agent | Base folder | Skills | Tuner agent | When-to-ask rule |
|---|---|---|---|---|
| Claude Code | `$CLAUDE_CONFIG_DIR`, else `~/.claude` | `skills/<name>/SKILL.md` | `agents/ask-kit-tuner.md` | `rules/ask-kit.md` |
| Codex | `$CODEX_HOME`, else `~/.codex` | `skills/<name>/SKILL.md` | none | marked block in `AGENTS.md` |
| Copilot CLI | `$COPILOT_HOME`, else `~/.copilot` | `skills/<name>/SKILL.md` | `agents/ask-kit-tuner.md` | `instructions/ask-kit.instructions.md` |
| opencode | `$XDG_CONFIG_HOME/opencode`, else `~/.config/opencode` | `skill/<name>/SKILL.md` | `agent/ask-kit-tuner.md` | marked block in `AGENTS.md` |
| Gemini CLI | `$GEMINI_CLI_HOME`, else `~/.gemini` | `skills/<name>/SKILL.md` | none | marked block in `GEMINI.md` |

The skills are `ask-kit-setup`, `ask-kit-improve` and `ask-kit-domain`. A base folder that does
not exist is skipped, so an agent you have not run is left alone. The source files are in
[`bundle/`](https://github.com/temet-ai/ask-kit/tree/main/bundle). `{{ASK_KIT}}` and
`{{AGENTS_MD}}` in them are replaced with this install's command and guide path.

The `ask` MCP server is registered in a different file for each agent:

| Agent | Registration |
|---|---|
| Claude Code | `claude mcp add -s user ask -- <node> <ask-kit>/bin/ask-kit.mjs serve` (the CLI writes its own config) |
| Codex | A block between `# >>> ask-kit` and `# <<< ask-kit` in `$CODEX_HOME/config.toml`, with `tool_timeout_sec = 600` and `startup_timeout_sec = 30` |
| Copilot CLI | `mcpServers.ask` in `$COPILOT_HOME/mcp-config.json` |
| Gemini CLI | `mcpServers.ask` in `~/.gemini/settings.json`, with `timeout` 600000 |
| opencode | `mcp.ask` in `$XDG_CONFIG_HOME/opencode/opencode.json`, with `timeout` 600000 |

## Transcripts read

The sessions domain reads these. It never writes them.

| Source | Where | Moved by |
|---|---|---|
| `claude-code` | `<base>/projects/<encoded cwd>/<session>.jsonl`, top level only | `CLAUDE_CONFIG_DIR` |
| `codex` | `<base>/sessions/YYYY/MM/DD/rollout-*.jsonl` and `<base>/archived_sessions/rollout-*.jsonl` | `CODEX_HOME` |
| `copilot-cli` | `<base>/session-state/<id>/events.jsonl` | `COPILOT_HOME` |
| `gemini-cli` | `<base>/tmp/<project hash>/chats/session-*.json` | `GEMINI_CLI_HOME` |
| `opencode` | `opencode.db` (SQLite, read-only, through `node:sqlite`) in `~/.local/share/opencode/` | `OPENCODE_DB`, `XDG_DATA_HOME` |

`~` is `os.homedir()` on every system.

The investigator CLIs ask-kit starts (`claude -p`, `codex exec`, `copilot -p`) write their own
transcripts in those same stores.

## Other files read

| Path | Read by |
|---|---|
| `~/.config/openrouter/active.env` | `ask-kit detect` and `setup`, looking for `OPENROUTER_API_KEY` |
| Any file named by a `{ "file" }` key reference | key lookup |
| The files of the repository under question | the `code` domain, through `repo` |

## Environment variables

### Where ask-kit keeps things

| Variable | Meaning |
|---|---|
| `ASK_KIT_CONFIG` | Replaces the config folder. The tests and the benchmark set it. It is passed on to the investigator's server. |
| `ASK_KIT_STATE` | Replaces the state folder. Passed on the same way. |
| `XDG_CONFIG_HOME`, `XDG_STATE_HOME` | Linux and macOS: base of the config and state folders. `XDG_CONFIG_HOME` also moves opencode's folder. |
| `APPDATA`, `LOCALAPPDATA` | Windows: base of the config and state folders. |
| `XDG_DATA_HOME` | Base of opencode's database (`$XDG_DATA_HOME/opencode/opencode.db`). |

### Which agent's files to use

| Variable | Meaning |
|---|---|
| `CLAUDE_CONFIG_DIR` | Claude Code's folder: its transcripts, skills, agents and rules. |
| `CODEX_HOME` | Codex's folder: transcripts, `config.toml`, `AGENTS.md`, skills. |
| `COPILOT_HOME` | Copilot CLI's folder: transcripts, `mcp-config.json`, skills, agents, instructions. |
| `GEMINI_CLI_HOME` | Gemini CLI's folder for transcripts, skills and `GEMINI.md`. Not used for the `settings.json` registration. |
| `OPENCODE_DB` | Path of opencode's database. |

### Which server runs, and for whom

ask-kit sets most of these itself when it starts a server. You set them to run a server by hand.

| Variable | Meaning |
|---|---|
| `ASK_KIT_DOMAIN` | The domain a server runs (`sessions` when unset). `ask-kit serve --domain` and the router set it. |
| `ASK_KIT_INNER` | `1` starts the investigator's face of the server: the REPL tools, and no `ask`. |
| `ASK_KIT_SESSION` | The calling session's id. `ask-kit ask` sets `shell-<pid>` when it is unset. The benchmark sets one per run. |
| `ASK_KIT_CALLER` | In an investigator's server: the session it acts for, 1 to 120 characters of `A-Z a-z 0-9 . _ : -`. A snapshot made for a caller is restored only for that caller. |
| `ASK_KIT_INHERIT` | In an investigator's server: the session whose saved variables it starts from when it has none (a fork of a warm session). |
| `ASK_KIT_CODE_ROOT` | The repository the `code` domain reads. Default: the git top level of the working directory. |
| `CLAUDE_CODE_SESSION_ID`, `CODEX_THREAD_ID`, `CODEX_SESSION_ID`, `COPILOT_SESSION_ID` | Read as the calling session's id when `ASK_KIT_SESSION` is not set. Agents set them. ask-kit removes all of them, and `ASK_KIT_INNER`, `ASK_KIT_CALLER` and `ASK_KIT_INHERIT`, from the environment of the investigator CLIs it starts. |

If none of the session variables is set, the caller's id is `client-<pid of the parent process>`.

### Timing and logging

| Variable | Meaning |
|---|---|
| `MCP_TOOL_TIMEOUT` | The calling agent's tool timeout in milliseconds, when it sets one. An ask ends 15 seconds before it. ask-kit never sets it. |
| `ASK_KIT_DEBUG` | Any value: the Ollama path writes each reply, cut short, to stderr. |

### Keys and services

| Variable | Meaning |
|---|---|
| `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `DEEPSEEK_API_KEY` | The key of each preset, used when a backend's `key` gives none and found by `detect`. |
| any name in a `{ "env" }` key reference | The variable that reference names. |
| `GITHUB_TOKEN` | Sent as a bearer token by `ask-kit gallery`, which avoids the unauthenticated rate limit. |
| `PATH`, `PATHEXT` | Finding `claude`, `codex`, `copilot`, `gemini`, `opencode`, `rg` and `git`. `PATHEXT` on Windows. |

### Benchmark only

| Variable | Meaning |
|---|---|
| `BENCH_QUESTIONS` | A question file to load instead of `bench/questions.json` and the private set. See [Run the benchmark](../guides/run-the-benchmark.md). |

Related: [Config file reference](config.md), [Command line and files](../command-line.md),
[What it stores and sends](../privacy.md).
