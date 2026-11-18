# Backends and config

A backend is a named model that can act as the investigator: a chat API that ask-kit drives
itself, or an agent CLI you already have. The config file lists them, and each ask runs on one.
This page covers where backends are defined, where their keys live, how one is picked, and how the
CLI investigators are kept to the REPL.

## Files

| File | What is in it |
|---|---|
| [src/providers.mjs](https://github.com/temet-ai/ask-kit/blob/main/src/providers.mjs) | `API_PRESETS` (chat APIs: base URL, key variable, suggested models), `AGENT_CLIS` (claude, codex, copilot), `AGENTS` (agents whose transcripts and MCP settings ask-kit knows). |
| [src/config.mjs](https://github.com/temet-ai/ask-kit/blob/main/src/config.mjs) | `CONFIG_DIR`, `STATE_ROOT`, `CONFIG_FILE`, `KEYS_FILE`, `loadConfig`, `saveConfig`, `storeKey`, `resolveKey`, `readEnvFile`, `callerSession`, `slug`. |
| [src/ollama.mjs](https://github.com/temet-ai/ask-kit/blob/main/src/ollama.mjs) | `ollamaChat` (OpenAI request in, OpenAI reply out, over Ollama's `/api/chat`), `OLLAMA_DEFAULT_CTX`, `ollamaContextLength`. |
| [src/ask.mjs](https://github.com/temet-ai/ask-kit/blob/main/src/ask.mjs) | `registerAsk`: `DEFAULT`, `endpoint`, `askApi`, `claudeArgs`, `CLAUDE_DENY`, `codexArgs`, `askCopilot`'s flags. |
| [src/platform.mjs](https://github.com/temet-ai/ask-kit/blob/main/src/platform.mjs) | `which`, `spawnCli`, `runCli`: starting CLIs, including Windows `.cmd` shims. |
| [src/setup/apply.mjs](https://github.com/temet-ai/ask-kit/blob/main/src/setup/apply.mjs) | `backendFor`, `backendName`, `plan`: how setup turns an answer into a config entry. |
| [src/setup/questions.mjs](https://github.com/temet-ai/ask-kit/blob/main/src/setup/questions.mjs) | `investigatorChoices`: which presets and models setup offers. |
| [src/setup/detect.mjs](https://github.com/temet-ai/ask-kit/blob/main/src/setup/detect.mjs) | Finds API keys (`keyEnv`, `keyFiles`, `keys.env`), CLIs on PATH and local model servers. |

## The config file

Setup writes `~/.config/ask-kit/config.json` (`CONFIG_FILE`). `ASK_KIT_CONFIG` moves the folder and
`ASK_KIT_STATE` moves the state folder; the tests use both. On Windows the folders are under
`%APPDATA%` and `%LOCALAPPDATA%`. `loadConfig` throws a "not set up yet" error when the file is
missing. `saveConfig` writes a temporary file and renames it, mode 0600.

The fields the code reads:

```json
{
  "version": 1,
  "sources": ["claude-code", "codex"],
  "clients": ["claude-code"],
  "backends": {
    "default": "glm-5.3-flash",
    "list": {
      "glm-5.3-flash": { "kind": "api", "preset": "openrouter", "model": "z-ai/glm-5.3-flash",
                         "providerOrder": ["DeepInfra"], "key": { "file": "~/.config/ask-kit/keys.env", "var": "OPENROUTER_API_KEY" } },
      "claude-haiku": { "kind": "claude-cli", "model": "haiku" }
    }
  },
  "domains": { "sessions": { "enabled": true }, "code": { "enabled": true, "backend": "claude-haiku" } },
  "router": { "backend": "glm-5.3-flash" }
}
```

The shape above comes from `plan()` in `src/setup/apply.mjs` and from the places that read it.
[Config reference](../reference/config.md) lists every field.

### Backend entry fields

Every entry has `kind`. The other fields, as `src/ask.mjs` reads them:

| Field | Kinds | Effect |
|---|---|---|
| `kind` | all | `api`, `claude-cli`, `codex-cli` or `copilot-cli`; picks the function in `KINDS`. |
| `model` | all | Sent as `model` (api), `--model` (claude), `-m` (codex), `--model` (copilot). Empty means the CLI's own default. |
| `bin` | CLIs | Program to run instead of `claude`, `codex` or `copilot`. |
| `preset` | api | A key of `API_PRESETS`. |
| `baseUrl` | api | Overrides the preset's base URL. `custom` has none, so it must be set. |
| `key` | api | A key reference; see below. |
| `noKey` | api | Allows a non-local endpoint with no key. |
| `nativeTools` | api | `false` switches the loop to code-block mode. Default is native tool calls. |
| `explicitCache` | api | Sends the system prompt with `cache_control: ephemeral`. |
| `providerOrder` | api | OpenRouter only: `provider: { order, allow_fallbacks: true }`. |
| `contextTokens` | api, Ollama | `num_ctx` for Ollama; default `OLLAMA_DEFAULT_CTX` (32768). |
| `isolate` | codex-cli | `false` keeps the user's own Codex config and rules; see below. |

## Keys

Config never holds a key. A backend's `key` is a reference that `resolveKey` in `config.mjs`
resolves at the time of the call:

- `{ "env": "NAME" }`: the environment variable, if it is set.
- `{ "file": "path", "var": "NAME" }`: the variable in that env-style file (`readEnvFile` accepts
  `NAME=value` and `export NAME=value`, with optional quotes, and expands `~`).
- Both: the environment wins.

When a backend has no `key`, `endpoint()` in `ask.mjs` falls back to the preset's `keyEnv`
variable (`OPENROUTER_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`,
`DEEPSEEK_API_KEY`). With no key and a non-local preset (and no `noKey`) it throws
`no API key for <label>: ... is empty`.

`keys.env` (`KEYS_FILE`, `~/.config/ask-kit/keys.env`) holds keys the user pasted during setup.
`storeKey(name, value)` writes `NAME=value` lines with mode 0600 and returns the
`{ file, var }` reference that config keeps. Keys that were found elsewhere (an environment
variable, or a preset's `keyFiles`, which for OpenRouter is `~/.config/openrouter/active.env`) stay
where they were; `detect.mjs` records where, and setup stores that reference.

The router resolves its key the same way (`byModel` in `src/router.mjs`).

## How a backend is chosen

In `registerAsk`:

```js
const DEFAULT = [domainCfg.backend, D.defaultBackend, config.backends.default, NAMES[0]].find((b) => b && BACKENDS[b]);
```

1. `config.domains.<name>.backend`, to put one domain on a different model.
2. The domain module's `defaultBackend`.
3. `config.backends.default`.
4. The first name in `backends.list`.

A caller's `backend` argument overrides all of them for that ask. The router passes it through
without checking; the domain server validates it against the list (`z.enum(NAMES)`). A
follow-up with `continue: true` uses the saved state of the backend that is chosen, so a
different `backend` on a follow-up has nothing to continue
(`nothing to continue: no earlier <backend> question in this session`).

The router's own model is separate: `config.router.backend` must name an `api` backend, and
`config.router.model` can override its model. `plan()` sets `router.backend` to the first API
backend in the list, or `null` when there is none.

## API backends

`API_PRESETS` has `openrouter`, `openai`, `anthropic` (through its OpenAI-compatible endpoint),
`gemini`, `deepseek`, `ollama`, `lmstudio` and `custom`. Each has `label`, `baseUrl`, `keyEnv` and
a `models` list (suggestions, cheapest first). Two flags change behaviour in `ask.mjs`:

- `reportsCost` (OpenRouter only): `costUsd` is taken from `usage.cost` in the replies. Other
  presets report `costUsd: null`, so the footer shows no cost.
- `local` (Ollama and LM Studio): no key needed.

The loop posts to `<baseUrl>/chat/completions`. The body has `model`, `messages`,
`temperature: 0`, `max_tokens: 4000`, and with native tools `tools`, `tool_choice: "auto"` and
`parallel_tool_calls: false`. [Life of one ask](ask-lifecycle.md#the-api-loop) has the loop.

### Ollama

Ollama's `/v1` endpoint takes no context size, so prompts are cut at its 4096-token default, and
the investigator's fixed prefix is about 7000 tokens. When `preset` is `ollama`, `askApi` calls
`ollamaChat` instead of `fetch`. It translates the OpenAI request to Ollama's `/api/chat`
(arguments parsed to objects, `think: false` so the answer is not written into `thinking`,
`options.num_ctx`, `num_predict` from `max_tokens`) and the reply back to the OpenAI shape
(`finish_reason` is `length` when Ollama reports `done_reason: "length"`; usage maps to
`prompt_tokens` and `completion_tokens`). `ASK_KIT_DEBUG` prints each raw reply to stderr.
`ollamaContextLength` reads a model's maximum from `/api/show`; `ask-kit doctor` uses it to warn
when the model's maximum is below the context ask-kit requests. LM Studio uses the plain `fetch` path.

## How the CLI investigators are limited

A CLI investigator must work through the REPL and nothing else. Each kind does that with its own flags
(all in `src/ask.mjs`):

**claude-cli** (`claudeArgs`):

- `--strict-mcp-config --mcp-config <file>`: only the `repl` server, from a temporary JSON file
  written per call and deleted afterwards. The user's own MCP servers are not loaded.
- `--disallowedTools` with `CLAUDE_DENY`: `Bash`, `Read`, `Grep`, `Glob`, `Edit`, `Write`,
  `NotebookEdit`, `WebFetch`, `WebSearch`, `Agent`, `Task`, `Skill`, `TodoWrite`.
- `--append-system-prompt-file <instructions>` and `--permission-mode bypassPermissions`, so the
  REPL tools run without a prompt that nobody could answer.
- The working directory is `STATE_DIR/warm/cwd`, an empty folder.

**codex-cli** (`codexArgs`):

- `-s read-only` and `-C <warm cwd>`, `approval_policy="never"`.
- `--ignore-user-config --ignore-rules`, unless the backend has `isolate: false`: the user's own
  `config.toml` would otherwise add their MCP servers and instructions. Authentication is in
  `auth.json` and is kept.
- The `repl` server is defined with `-c mcp_servers.repl.*` (command, args, environment),
  `tool_timeout_sec=180` and `default_tools_approval_mode="approve"`.
- The prompt tells it to use only the `repl` tool. Nothing stops Codex using its shell inside the
  read-only sandbox; the sandbox is what limits it.
- Forks and resumes drop `-s` and `-C` from the arguments (the filter in `askCodex`). The code
  does not say why; the likely reason is that `exec fork` and `exec resume` do not accept them.

**copilot-cli** (`askCopilot`):

- `--additional-mcp-config @<file>` with `--disable-builtin-mcps`, `--no-custom-instructions` and
  `--no-ask-user`.
- `--allow-all-tools` with `--deny-tool shell` and `--deny-tool write`.
- `-s` and `--output-format json`; each question starts a new session unless it is a follow-up.

All three run through `runCli` in `platform.mjs`, which starts the program with no stdin, collects
stdout and stderr, sends `SIGTERM` on timeout or abort, and never rejects (it returns `code`, `out`
and `err`). `childEnv` removes the session variables (`ASK_KIT_SESSION`, `CLAUDE_CODE_SESSION_ID`,
`CODEX_THREAD_ID` and others) from the CLI's environment so the investigator's REPL cannot write
into the asking agent's own state.

## Where to look when changing it

- Change a suggested model or its note: the `models` list of the preset in `src/providers.mjs`.
  Setup offers the first one. Existing configs keep what they have; edit `config.json`, or run
  `ask-kit setup` again.
- Add an API provider that speaks the OpenAI chat format: add an `API_PRESETS` entry (`label`,
  `baseUrl`, `keyEnv`, `models`, and `reportsCost` or `local` if they apply). Setup and
  `detect.mjs` pick it up from the table. Check how it handles `tool_choice` and
  `parallel_tool_calls`; if it rejects tools, set `nativeTools: false` in a backend entry.
- Add a new kind of backend (another agent CLI, a different protocol): a function in `ask.mjs`
  and an entry in `KINDS` and `AGENT_CLIS`, plus detection and setup choices.
  [Add a backend](../guides/add-a-backend.md) goes through it.
- Change what a CLI may do: `CLAUDE_DENY`, `codexArgs` and the flags in `askCopilot`. Run a real
  ask on that CLI afterwards; the flags change between CLI releases and no test covers them.
- Keys: `resolveKey`, `storeKey` and `readEnvFile`. Keep the rule that config never holds a key
  (`test/bundle.mjs` asserts it).
- Change how the default is chosen: the `DEFAULT` line in `registerAsk`.

Tests: `test/setup.mjs` checks `backendName`, that `plan()` stores key references and sets
`router.backend`, and that a pasted key lands in `keys.env` with mode 0600 and not in the config.
`test/bundle.mjs` repeats the keys check after two applies. `test/repl.mjs` builds a config with an
`ollama` API backend to start the server. Nothing in `test/` calls the provider endpoints or the
CLIs, so a change to `askApi` or a CLI's flags needs a real ask on that backend (and the benchmark
for anything that changes what the model sees). See [Testing](../guides/testing.md).
