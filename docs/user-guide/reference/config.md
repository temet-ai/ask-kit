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
| `router` | object, `false` or `null` | `{ "backend": <the investigator's backend> }` (written by setup) | How the router picks a domain. `false` routes by keyword rules only. See [`router`](#router). |
| `aliases` | object | `{}` | Other words a caller may give as `about`, each naming an enabled domain: `{"docs": "claude-code-docs"}`. The tool lists them in `about` and its description. An alias of a domain that is not enabled, or one that is a domain's own name, is left out. mike-ask uses it to keep the `about` names its callers already pass. |
| `footer` | boolean | `false` | `true` adds a last line to each answer with the domain, backend and seconds (`[code · glm-5.3-flash · 21s]`), and the router's `[routed to <domain> by <how>]` line. Off by default, because agents repeat whatever the reply carries. The journal records time, backend and cost either way. |
| `taskAfterSeconds` | number | `10` | An ask still running after this many seconds is answered with an MCP task, for a client that takes tasks; the answer is delivered when the ask ends. `0` turns it off. See [A slow ask answered as a task](ask-tool.md#a-slow-ask-answered-as-a-task). |
| `journal` | object | `{ "trajectories": false }` | `trajectories: true` also stores each cell's printed result (clipped at 4,000 characters) and, on the ask row, the answer (clipped at 8,000), so a journal can be read back as what the investigator saw. Journals then hold excerpts of whatever it read: transcripts, files, command output. `ask-kit doctor` prints whether it is on. See [Journal reference](journal.md). |
| `actions` | object | `{ "shadowEvery": 20 }` | `shadowEvery`: one answered run of an action in this many also runs the investigator in the background, for `ask-kit report` to show both answers. `0` turns shadow runs off. See [Actions](../kits.md#actions). |
| `escalate` | object | none (off) | `{ "backend": "<name>", "after": <seconds> }`: an `api` ask with no answer at twice the kit's usual time goes to that stronger backend, in the same REPL. See [`escalate` and `hedge`](#escalate-and-hedge). |
| `hedge` | object | none (off) | `{ "backend": "<name>", "after": <seconds> }`: a new ask with no answer at the kit's usual time also starts on that backend, and the first answer wins. See [`escalate` and `hedge`](#escalate-and-hedge). |
| `machines` | array | none | Other machines whose asks and chains count in reviews: ssh host names, or `{ "host": "...", "command": "..." }` when ask-kit runs there as that command. `ask-kit improve` copies their evidence first. See [Other machines](../tuning.md#other-machines). |
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
| `body` | object | none | Extra fields merged into every request the investigator sends to this backend, after ask-kit's own, so a field here wins. For OpenRouter's provider routing: `"body": { "provider": { "order": ["DeepInfra"], "allow_fallbacks": false } }`. Changing it re-warms the backend, like any backend key. |

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
| `escalate` | object or `false` | the top-level `escalate` | This domain's escalation; `false` turns it off for the domain. See [`escalate` and `hedge`](#escalate-and-hedge). |
| `hedge` | object or `false` | the top-level `hedge` | This domain's hedge; `false` turns it off for the domain. |
| `from` | string | none | Written by `ask-kit add`: the repository or folder a domain came from. |
| `commit` | string | none | Written by `ask-kit add`: the commit installed. |
| any other key | any | none | Read by the domain itself. A domain's `makeGlobals({ push, config })` receives the whole config. The [notes domain in the how-to](../guides/write-a-domain.md) reads `domains.notes.dir`. |

`ask-kit ask --domain <name>` and `ask-kit serve --domain <name>` start that domain's server
whether or not the config lists it. The config decides only what the router offers.

## `escalate` and `hedge`

`escalate` hands a slow ask to a stronger backend; `hedge` starts the same question on a second
backend and keeps the first answer. Both are off until set, at the top level for every domain or
under `domains.<name>` for one (a domain's value, or its `false`, wins).

```json
"escalate": { "backend": "deepseek-v4.1" },
"hedge": { "backend": "claude-haiku", "after": 40 }
```

| Key | Type | Default | What it does |
|---|---|---|---|
| `backend` | string | none, required | A name from `backends.list`. A name that is not there, or the backend the ask already runs on, leaves the feature off. |
| `after` | number | from the journal | Seconds into the ask when the second backend comes in. Without it: twice the kit's usual time for `escalate`, the usual time for `hedge`. |

The kit's usual time is the median time of its asks over the last 30 days, the figure
`ask-kit kit profile` shows (kit-test and benchmark sessions left out). Until the kit has five
journaled asks it is 60 seconds. The server reads it at most every ten minutes.

**`escalate`** applies to `api` backends, and the stronger backend must be an `api` backend too.
At the time it is due, the model call in flight is cut off and the stronger backend gets the
question plus a short trace: how long the first one worked, and the last eight cells it ran with
the start of each result. It works in the same REPL (`ask-<askId>`), so every variable the first
backend set is there, and its answer is the ask's. A follow-up with `continue: true` continues the
stronger backend's conversation. Escalation needs 30 seconds left in the ask; with less, the first
backend carries on to the limit. If the stronger backend fails, the first one is asked for what it
found, as at the time limit.

**`hedge`** applies to new asks on any kind of backend (not follow-ups). At the time it is due, the
same question starts on the hedge backend in the background, the way an action's shadow run does.
The first good answer is returned and the other run is stopped. When the hedge wins and both
backends are `api`, a follow-up continues the hedge's conversation. A hedge costs a second run
only for the asks that pass the time; the journal row keeps the winner's time and cost.

## `router`

```json
"router": { "backend": "glm-5.3-flash", "model": "z-ai/glm-5.3-flash" }
```

| Key | Type | Default | What it does |
|---|---|---|---|
| `backend` | string | `backends.default` | Name of a backend: an `api` backend, or a `claude-cli`, `codex-cli` or `copilot-cli` one. The router asks it for one word naming the domain. |
| `model` | string | that backend's `model` | A different (usually cheaper) model for the routing call. Setup never writes it. |
| `timeoutMs` | number | `8000` for an API, `15000` for `claude-cli`, `20000` for `codex-cli` and `copilot-cli` | How long the routing call may take. Past it, session history answers. |
| `body` | object | `{"reasoning": {"enabled": false}}` on the `openrouter` preset, else none | Extra fields for the routing call's request. A reasoning model can spend the call's 200 tokens thinking and reply with nothing, so OpenRouter is told not to reason. |

Setup asks which model routes, suggests the investigator's, and writes the answer: `{ "backend":
"<name>" }`, or `false` for keywords only. With `router` `null` or missing, the default backend
routes, so a machine whose only model is a subscription (Claude through
`claude`, ChatGPT through `codex`, Copilot) still has a router.

An agent CLI is called once per routed question in print mode, from the temp folder, with no
tools, no MCP servers and none of your own settings, hooks, plugins or instructions:
`claude -p --tools "" --strict-mcp-config --setting-sources "" --no-session-persistence`,
`codex exec --ignore-user-config --ignore-rules --ephemeral -s read-only` at low reasoning effort,
or `copilot -p --no-custom-instructions --disable-builtin-mcps --deny-tool shell --deny-tool write`.
It starts before it answers, so routing takes longer than through an API: about 4 seconds for
`claude` on Haiku and 7.6 seconds for `codex`, against about one second for an API. Only a question
that steps 1 to 4 below leave open makes the call.

How the router chooses, in order:

1. The `about` parameter of the call.
2. A follow-up (`continue: true`) goes to the domain that answered last for this caller.
3. A single enabled domain.
4. A kit whose `patterns` match a question with no past-work words in it.
5. One call to `router.backend`: temperature 0, 200 tokens (on an API), `timeoutMs`, the question
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
