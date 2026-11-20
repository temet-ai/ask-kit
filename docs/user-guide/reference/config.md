# Config file reference

`config.json` holds what setup decided: which transcripts to read, which agents got the `ask` tool,
which models can investigate, which domains are on, and how the router picks a domain. Setup
writes it with `ask-kit setup` or `ask-kit apply`. You can edit it by hand. Every server reads it
when it starts, so restart your agents after a change; the investigator itself needs no restart.

Where the file lives, per system, is in [Files and environment variables](files-and-env.md).
Config never holds an API key. It holds a reference to where a key is.

Source: [`src/config.mjs`](https://github.com/temet-ai/ask-kit/blob/main/src/config.mjs)
(`loadConfig`, `saveConfig`, `resolveKey`),
[`src/setup/apply.mjs`](https://github.com/temet-ai/ask-kit/blob/main/src/setup/apply.mjs)
(`plan`, `backendFor`),
[`src/providers.mjs`](https://github.com/temet-ai/ask-kit/blob/main/src/providers.mjs)
(`API_PRESETS`, `AGENT_CLIS`),
[`src/ask.mjs`](https://github.com/temet-ai/ask-kit/blob/main/src/ask.mjs) (`registerAsk`,
`endpoint`, `askApi`) and
[`src/router.mjs`](https://github.com/temet-ai/ask-kit/blob/main/src/router.mjs) (`makeRouter`).

## Top-level keys

| Key | Type | Default | What it does |
|---|---|---|---|
| `version` | number | `1` (written by setup) | Written by `plan()`. Nothing reads it. |
| `sources` | string[] | `[]` (written by setup) | Transcript sources the sessions domain reads. Values: `claude-code`, `codex`, `copilot-cli`, `gemini-cli`, `opencode`. An empty list means no source: `history` sees no sessions. If the key is missing, every source is read. |
| `clients` | string[] | `[]` (written by setup) | Agents that got the `ask` tool. `ask-kit uninstall` walks this list to remove the registrations, and the guide (`AGENTS.md`) prints it. |
| `backends` | object | none, required | The models. See [`backends`](#backends). |
| `domains` | object | none, required | Which domains are on. See [`domains`](#domains). |
| `router` | object or `null` | `null` when no backend is an API | How the router picks a domain. See [`router`](#router). |
| `aliases` | object | `{}` | Other words a caller may give as `about`, each naming an enabled domain: `{"docs": "claude-code-docs"}`. The tool lists them in `about` and its description. An alias of a domain that is not enabled, or one that is a domain's own name, is left out. mike-ask uses it to keep the `about` names its callers already pass. |
| `footer` | boolean | `false` | `true` adds a last line to each answer with the domain, backend and seconds (`[code · glm-5.3-flash · 21s]`), and the router's `[routed to <domain> by <how>]` line. Off by default, because agents repeat whatever the reply carries. The journal records time, backend and cost either way. |
| `journal` | object | `{ "trajectories": false }` | `trajectories: true` also stores each cell's printed result (clipped at 4,000 characters) and, on the ask row, the answer (clipped at 8,000), so a journal can be read back as what the investigator saw. Journals then hold excerpts of whatever it read: transcripts, files, command output. `ask-kit doctor` prints whether it is on. See [Journal reference](journal.md). |
| `actions` | object | `{ "shadowEvery": 20 }` | `shadowEvery`: one answered run of an action in this many also runs the investigator in the background, for `ask-kit report` to show both answers. `0` turns shadow runs off. See [Actions](../kits.md#actions). |
| `setupAt` | string (ISO time) | time of setup | Written by `plan()`. Nothing reads it. |

`loadConfig` throws `ask-kit is not set up yet` when the file is missing, and the server then
does not start. A file that is not valid JSON throws with the file name and the parse error.

## `backends`

```json
"backends": { "default": "glm-5.3-flash", "list": { "glm-5.3-flash": { ... }, "codex": { ... } } }
```

| Key | Type | What it does |
|---|---|---|
| `default` | string | Name of the backend an ask uses when nothing says otherwise. |
| `list` | object | One entry per backend. The key is the backend's name: it is what `--backend` and the tool's `backend` parameter take. |

The server refuses to start with an empty `list` (`no backends in config`).

Which backend answers an ask: the first of these that exists in `list`:

1. `domains.<name>.backend`
2. the domain's own `defaultBackend` (a field a domain module may export; the built-in domains
   set none)
3. `backends.default`
4. the first entry in `list`

A backend entry always has a `kind`. The other keys depend on the kind.

### Keys on every backend

| Key | Type | Default | What it does |
|---|---|---|---|
| `kind` | `"api"`, `"claude-cli"`, `"codex-cli"` or `"copilot-cli"` | none, required | How the investigator runs. An unknown kind fails the ask with `backend <name> has unknown kind`. |
| `model` | string | none | The model id. For an agent CLI it is passed with `--model` (`-m` for Codex) and left out when empty or missing, so the CLI uses its own default. For `api` it is the `model` field of the request. |

### Keys for `kind: "api"`

| Key | Type | Default | What it does |
|---|---|---|---|
| `preset` | string | none | Key of a preset in `API_PRESETS`: `openrouter`, `openai`, `anthropic`, `gemini`, `deepseek`, `ollama`, `lmstudio`, `custom`. Gives the default `baseUrl`, key variable and whether the provider reports cost. A name that is not a preset works when `baseUrl` is set. |
| `baseUrl` | string | the preset's | Base of an OpenAI-compatible API. Requests go to `<baseUrl>/chat/completions`. Required for the `custom` preset, which has none. Without a base the ask fails with `backend has no baseUrl`. |
| `key` | key reference | none | Where the API key is. See [Key references](#key-references). When it gives nothing, the preset's variable (for example `OPENROUTER_API_KEY`) is tried. |
| `noKey` | boolean | `false` | Send no key and do not fail when none is found. For an endpoint that needs none. The local presets (`ollama`, `lmstudio`) never need one. |
| `providerOrder` | string[] | none | Sent as `provider: { order: [...], allow_fallbacks: true }`. OpenRouter reads it to prefer those providers. Setup writes `["DeepInfra"]` for `z-ai/glm-5.3-flash`. ask-kit sends the field to whatever endpoint the backend points at, so use it only with OpenRouter. |
| `nativeTools` | boolean | `true` | `true`: the model is offered one tool, `repl`, and calls it. `false`: the model writes one fenced `js` block per turn and ask-kit runs the first block. Use `false` for a model that handles tool calls badly. |
| `explicitCache` | boolean | `false` | Marks the system message with `cache_control: { type: "ephemeral" }`, for providers that need an explicit cache marker. |
| `contextTokens` | number | `32768` | Ollama only (`preset: "ollama"`). The `num_ctx` ask-kit asks for through Ollama's own `/api/chat`. `ask-kit doctor` compares it with the model's limit. |

OpenRouter backends also get `usage: { include: true }` in the request, and a `session_id`
(`ask-kit-<domain>-<backend>-<fingerprint>`) that keeps a question on one provider so the prompt
cache hits. Only OpenRouter reports a cost, so only an OpenRouter backend has a price in the
journal.

### Keys for agent CLIs

| Key | Kinds | Type | Default | What it does |
|---|---|---|---|---|
| `bin` | `claude-cli`, `codex-cli`, `copilot-cli` | string | `claude`, `codex`, `copilot` | The program to run. A path or a name on `PATH`. |
| `isolate` | `codex-cli` | boolean | `true` | `false` stops ask-kit passing `--ignore-user-config --ignore-rules`, so the investigator also loads your Codex `config.toml` and rules. |

`claude-cli` and `codex-cli` are warmed once and forked per question. `copilot-cli` starts fresh
each question. See [Backends](../internals/backends.md).

### Key references

A key reference says where a key is. It has one of these forms:

| Form | Meaning |
|---|---|
| `{ "env": "NAME" }` | The environment variable `NAME`. |
| `{ "file": "~/path/keys.env", "var": "NAME" }` | The line `NAME=value` in that file. `var` defaults to `env` when both are given. A leading `~` is expanded. |
| `{ "env": "NAME", "file": "...", "var": "NAME" }` | Both. The variable wins when it is set. |

A file holds `NAME=value` lines. A leading `export ` and quotes around the value are removed.
`ask-kit setup` writes a pasted key to `keys.env` in the config folder (mode `0600`) and stores
`{ "file": "<path>/keys.env", "var": "<PRESET KEY VARIABLE>" }`.

### Presets

| Preset | Base URL | Key variable | Reports cost | Local |
|---|---|---|---|---|
| `openrouter` | `https://openrouter.ai/api/v1` | `OPENROUTER_API_KEY` (also looked for in `~/.config/openrouter/active.env`) | yes | no |
| `openai` | `https://api.openai.com/v1` | `OPENAI_API_KEY` | no | no |
| `anthropic` | `https://api.anthropic.com/v1` | `ANTHROPIC_API_KEY` | no | no |
| `gemini` | `https://generativelanguage.googleapis.com/v1beta/openai` | `GEMINI_API_KEY` | no | no |
| `deepseek` | `https://api.deepseek.com/v1` | `DEEPSEEK_API_KEY` | no | no |
| `ollama` | `http://localhost:11434/v1` | none | no | yes |
| `lmstudio` | `http://localhost:1234/v1` | none | no | yes |
| `custom` | none: set `baseUrl` | none: set `key` | no | no |

The models each preset suggests are in [Choose the model](../models.md). They are suggestions:
`model` can be any id the provider serves.

## `domains`

```json
"domains": { "sessions": { "enabled": true }, "code": { "enabled": true, "backend": "deepseek-v4.1-flash-1017" } }
```

The key is a domain name (lowercase letters, digits and dashes, starting with a letter). The
router serves every entry whose `enabled` is not `false`, so an empty object `{}` counts as on.
A name with no folder fails the router when it starts (`no domain "<name>"`).

| Key | Type | Default | What it does |
|---|---|---|---|
| `enabled` | boolean | on | `false` takes the domain out of the router and out of the tool's `about` list. |
| `backend` | string | none | A backend name from `backends.list` that answers this domain's asks. Beats `backends.default`. A name that is not in `list` is ignored. |
| `priority` | number | the manifest's | Pins the priority of every capability the domain provides (`[[provides]]` in a kit, `provides` in a domain.mjs). The highest wins. Settles a tie that `ask-kit doctor` reports. |
| `actions` | object | none | Per action of the kit's `[[actions]]`: `true` turns on one that changes something, `false` turns any off. Read on every ask, so no restart is needed. `ask-kit kit actions <kit> --enable` and `--disable` write it. |
| `from` | string | none | Written by `ask-kit add`: the repository or folder a domain came from. |
| `commit` | string | none | Written by `ask-kit add`: the commit installed. |
| any other key | any | none | Read by the domain itself. A domain's `makeGlobals({ push, config })` receives the whole config. The [notes domain in the how-to](../guides/write-a-domain.md) reads `domains.notes.dir`. |

`ask-kit ask --domain <name>` and `ask-kit serve --domain <name>` start that domain's server
whether or not the config lists it. The config decides only what the router offers.

## `router`

```json
"router": { "backend": "glm-5.3-flash", "model": "z-ai/glm-5.3-flash" }
```

| Key | Type | Default | What it does |
|---|---|---|---|
| `backend` | string | none | Name of an `api` backend. The router asks it for one word naming the domain. |
| `model` | string | that backend's `model` | A different (usually cheaper) model for the routing call. Setup never writes it. |
| `timeoutMs` | number | `8000` | How long the routing call may take. Past it, session history answers. |
| `body` | object | `{"reasoning": {"enabled": false}}` on the `openrouter` preset, else none | Extra fields for the routing call's request. A reasoning model can spend the call's 200 tokens thinking and reply with nothing, so OpenRouter is told not to reason. |

`router` is `null` or missing when no backend is an API. Setup sets `router.backend` to the first
`api` backend in the list: the investigator you chose, else the first extra.

How the router chooses, in order:

1. The `about` parameter of the call.
2. A follow-up (`continue: true`) goes to the domain that answered last for this caller.
3. A single enabled domain.
4. A kit whose `patterns` match a question with no past-work words in it.
5. One call to `router.backend`: temperature 0, 200 tokens, `timeoutMs` (8 seconds), the question
   cut at 2000 characters, reply must be one enabled domain name. When it times out, `sessions`
   answers. With more than 15 domains, the call offers only the kits whose `keywords` or
   `patterns` the question matches, with the built-in domains (all of them when none match).
6. Keyword rules, when the call fails or says something else. These test past-work words
   (`sessions`) first, then kit `keywords`, then `code`, and fall back to the first enabled domain.

The router call sends the working directory, the enabled domains' descriptions and the question to the model. See
[What it stores and sends](../privacy.md).

## Limits that are not config

These are constants in the code. Change them by editing the source.

| Value | Where | Meaning |
|---|---|---|
| 30 s | `WRAP_MS` | With less time left than this, each cell result tells the investigator to answer. |
| 60 s | `CELL_MAX_S` | The longest one REPL cell may run for an `api` investigator. |
| 15 s | `RESERVE_MS` | Time kept back for the closing "what I found" call, and subtracted from `MCP_TOOL_TIMEOUT`. |
| 300 s | `askClaude`, `askCodex` | Time allowed to warm an agent CLI session. |
| 4000 characters | `askApi` | Result size a cell returns to an `api` investigator. |
| 4000 tokens, temperature 0 | `askApi` | `max_tokens` and `temperature` of each `api` request. |
| 64 MB | `SNAPSHOT_MAX_BYTES` in `src/server.mjs` | Size of the saved REPL variables. |

## Example

A setup with an API model as the default, a subscription model as an extra, one domain on a
different model, and a router:

```json
{
  "version": 1,
  "sources": ["claude-code", "codex"],
  "clients": ["claude-code", "codex"],
  "backends": {
    "default": "glm-5.3-flash",
    "list": {
      "glm-5.3-flash": {
        "kind": "api",
        "preset": "openrouter",
        "model": "z-ai/glm-5.3-flash",
        "providerOrder": ["DeepInfra"],
        "key": { "file": "~/.config/ask-kit/keys.env", "var": "OPENROUTER_API_KEY" }
      },
      "claude-haiku": { "kind": "claude-cli", "model": "haiku" },
      "local-qwen": { "kind": "api", "preset": "ollama", "model": "qwen3.5:9b", "contextTokens": 32768 }
    }
  },
  "domains": {
    "sessions": { "enabled": true },
    "code": { "enabled": true, "backend": "claude-haiku" }
  },
  "router": { "backend": "glm-5.3-flash" },
  "setupAt": "2026-11-18T09:00:00.000Z"
}
```

Check a hand edit with `ask-kit doctor`. It lists each source with its session count, each API
backend with whether its model id exists at the provider, and the domains and router.

Related: [The `ask` tool](ask-tool.md), [Add a model or provider](../guides/add-a-backend.md),
[Files and environment variables](files-and-env.md).
