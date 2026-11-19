# Add a model or provider

A backend is a model that does the investigating. This guide covers four cases, from the smallest
change to the largest:

1. [Another model on a provider ask-kit already knows](#1-another-model-on-a-known-provider)
2. [A provider ask-kit does not list](#2-a-provider-that-is-not-listed)
3. [A local model](#3-a-local-model)
4. [A new agent CLI](#4-a-new-agent-cli-as-the-investigator)

For choosing between models, see [Choose the model](../models.md). The keys a backend can have are
in the [config reference](../reference/config.md#backends), and the loop that runs an `api` backend
is in [Backends](../internals/backends.md).

## 1. Another model on a known provider

Any model id the provider serves works. Setup lists a few as suggestions, and `model` is a plain
string in the config.

### With setup

Write the answers as JSON, with the model as `<preset>:<model id>`. This adds `qwen/qwen3-coder`
on OpenRouter as an extra backend and keeps the current default:

```json
{
  "sources": ["claude-code", "codex"],
  "clients": ["claude-code", "codex"],
  "investigator": "openrouter:z-ai/glm-5.3-flash",
  "extras": ["openrouter:qwen/qwen3-coder"],
  "domains": ["sessions", "code"],
  "keys": { "openrouter": { "env": "OPENROUTER_API_KEY" } }
}
```

```sh
ask-kit apply answers.json --dry-run
ask-kit apply answers.json
```

`apply` writes the whole config again from the answers, so list every source, client and domain
you want. Run `ask-kit questions` first: its `existing` field shows the current config, and the
`ask-kit-setup` skill walks an agent through the same conversation.

The backend's name is the model id after the last `/`, lowercased: `qwen3-coder`.

### By hand

Add an entry under `backends.list` in `config.json`:

```json
"qwen3-coder": {
  "kind": "api",
  "preset": "openrouter",
  "model": "qwen/qwen3-coder",
  "key": { "env": "OPENROUTER_API_KEY" }
}
```

### Check it

```sh
ask-kit doctor
```

The line for the backend ends in a status:

| Status | Meaning |
|---|---|
| `ok` | The provider answered `GET <baseUrl>/models` and lists the model. |
| `reachable, but <model> is not in its model list` | The provider answered and does not list that id. Check the spelling. |
| `HTTP <code>` | The provider refused. `401` usually means the key. |
| an error message | The provider could not be reached. |

Then ask one question on it, without changing the default:

```sh
ask-kit ask --domain code --backend qwen3-coder "where is the config file read?"
```

A model that fails here usually fails in one of three ways, which the [journal](../reference/journal.md)
and `ask-kit report` show: `missteps` (it wrote tool-call markup instead of calling the tool),
`cut off` (replies hit the length limit), or `out of steps or time`. For missteps, try
`"nativeTools": false` in the entry, which has the model write fenced `js` blocks instead of calling
a tool.

To make it the default for one domain, set `domains.<name>.backend`. To make it the default
everywhere, set `backends.default`.

To compare it with the others on real questions, use the [benchmark](run-the-benchmark.md).

## 2. A provider that is not listed

ask-kit speaks the OpenAI chat-completions protocol to any `api` backend. A provider needs:

- `POST <baseUrl>/chat/completions`, with `messages`, `temperature`, `max_tokens` and, for the
  default mode, `tools`, `tool_choice` and `parallel_tool_calls`.
- A reply with `choices[0].message` holding `content` and, for a tool call, `tool_calls`, and a
  `finish_reason`.
- For cost and cache numbers, a `usage` object with `prompt_tokens`, `completion_tokens` and
  optionally `prompt_tokens_details.cached_tokens`, `prompt_tokens_details.cache_write_tokens` and
  `cost`.
- `GET <baseUrl>/models`, only for `ask-kit doctor`.

### Config only

Use the `custom` preset and give the base URL. The URL and key variable below are placeholders:

```json
"acme-large": {
  "kind": "api",
  "preset": "custom",
  "baseUrl": "https://llm.example.com/v1",
  "model": "acme-large-1",
  "key": { "env": "ACME_API_KEY" }
}
```

For an endpoint that needs no key, add `"noKey": true` instead of `key`. `ask-kit setup` cannot
write this entry, because the `custom` preset takes no base URL there. Add it to `config.json`
by hand.

### A preset

If you want setup to offer the provider, add it to `API_PRESETS` in
[`src/providers.mjs`](https://github.com/temet-ai/ask-kit/blob/main/src/providers.mjs):

```js
acme: {
  label: "Acme API",
  baseUrl: "https://llm.example.com/v1",
  keyEnv: "ACME_API_KEY",
  models: [{ id: "acme-large-1", note: "small and cheap" }],
},
```

| Field | Meaning |
|---|---|
| `label` | Shown in setup and in errors. |
| `baseUrl` | Where requests go. |
| `keyEnv` | The variable `detect` looks for, and the one used when a backend's `key` gives nothing. |
| `keyFiles` | Optional list of `NAME=value` files `detect` also searches for the key. |
| `reportsCost` | `true` when the reply's `usage.cost` is in dollars, so the journal shows a price. Leave it out otherwise: the cost shows as unknown. |
| `models` | Suggestions, cheapest first. The first is setup's default for this provider. Each can carry `providerOrder`. |
| `local` | `true` for a server on this machine that needs no key. `detect` probes `<baseUrl>/models`. |

Then:

1. `ask-kit detect` lists the provider under API keys, found if `ACME_API_KEY` is set.
2. `ask-kit questions` offers `acme:acme-large-1` among the investigator choices.
3. Add the provider to the table in [Choose the model](../models.md) and to the
   [config reference](../reference/config.md#presets).

Provider-specific behaviour (OpenRouter's `usage` and `session_id`, Ollama's own endpoint) is
keyed on the preset name in `endpoint` and `askApi` in
[`src/ask.mjs`](https://github.com/temet-ai/ask-kit/blob/main/src/ask.mjs). A provider that needs
a special request field gets a branch there.

## 3. A local model

Ollama and LM Studio are presets. Start the server, pull a model and run:

```sh
ask-kit detect          # "Local model servers" lists what it found
```

Setup offers the first five models of a running server, leaving out names that look like embedding,
rerank, OCR or speech models. By hand:

```json
"local-qwen": { "kind": "api", "preset": "ollama", "model": "qwen3.5:9b", "contextTokens": 32768 }
```

For Ollama, ask-kit calls Ollama's own `/api/chat`, because the OpenAI-compatible `/v1` endpoint
cannot raise the default context of 4096 tokens, and the investigator's prefix alone is about 7000.
`contextTokens` is the `num_ctx` it asks for; the default is 32768. `ask-kit doctor` compares it with
the model's limit and says `holds only N tokens of context` when the model tops out lower. Pick a
model with a larger context in that case.

Small local models make more mistakes in this loop. Run the [benchmark](run-the-benchmark.md) on
yours before you rely on it.

## 4. A new agent CLI as the investigator

An agent CLI backend runs a coding agent headless with the REPL as its only MCP server. This is
the largest change, and it needs the CLI to support all of the following:

- a non-interactive mode that prints a result,
- an MCP server given on the command line or in a throwaway config,
- a way to turn off its own tools, so the investigator works through the REPL only, where every
  call is journaled,
- ideally a way to fork or resume a session, so the instructions are loaded once.

The three that exist are `askClaude`, `askCodex` and `askCopilot` in
[`src/ask.mjs`](https://github.com/temet-ai/ask-kit/blob/main/src/ask.mjs). Read the one closest to
your CLI first. Then:

1. **Describe it** in `AGENT_CLIS` in `src/providers.mjs`:

   ```js
   "acme-cli": {
     label: "Acme CLI (your Acme plan)",
     bin: "acme",
     forks: false,
     models: [{ id: "", note: "Acme's configured default" }],
   },
   ```

   `bin` is what `detect` looks for. `forks` is `true` when the CLI can copy a warm session, and
   decides what setup says about speed. A model with `id: ""` means the CLI's own default.

2. **Write `askAcme`** in `registerAsk`, with the signature of the others,
   `(b, question, timeoutMs, cont, signal)`. It must:
   - run the CLI with `run(be.bin ?? "acme", args, { cwd: WARM_CWD, env: childEnv(), timeoutMs, signal })`,
     so it starts in the state folder (its own transcripts then land where the sessions domain
     skips them) and without the caller's session variables;
   - give it the REPL server: `process.execPath` with `[SERVER]` and the environment from
     `replEnv(inherit, ownId)`;
   - pass the domain's instructions (`INSTRUCTIONS`, a file) and, for the first question, `D.prime`
     if it can be warmed, or the instructions and question together as `askCopilot` does;
   - append `rulesFor()` to the question;
   - use `readLast(b)` and `writeLast(b, ...)` for `continue: true`, and throw
     `nothing to continue: no earlier <b> question in this session` when there is nothing to
     continue;
   - return `{ answer, ok, model, continued, ms, costUsd, usage: { input, cacheRead, output } }`, and
     `cells` and `turns` where the CLI reports them. `costUsd` is `null` when the CLI does not
     report dollars.

3. **Add it to `KINDS`** at the end of `registerAsk`:

   ```js
   const KINDS = { "claude-cli": askClaude, "codex-cli": askCodex, "copilot-cli": askCopilot, "acme-cli": askAcme, api: askApi };
   ```

4. **Probe its login** in `detect()` in `src/setup/detect.mjs`: add an entry to the `auth` object that
   returns `{ ok, out }` from a cheap status command, so setup can say whether it is signed in.
   Without one, `signedIn` stays unknown and the choice is offered as ready.

5. **Check the names and the order.** `backendFor` in `src/setup/apply.mjs` builds
   `{ kind: "acme-cli", model }` from `AGENT_CLIS` and needs no change. `backendName` has a case
   for each of the three existing CLIs (`claude-haiku`, `codex`, `copilot`); any other kind gets
   its model id as the name, or the kind when the model is empty. Add a case if you want another
   name. `investigatorChoices` in `src/setup/questions.mjs` ranks subscription CLIs with
   `30 + 0` for Claude, `+ 2` for Codex and `+ 4` for anything else, so yours ranks with Copilot.
   Change that expression to rank it elsewhere.

6. **Test it.** `ask.mjs` has no unit test, so use the real thing. Add the backend to a scratch
   config, run a question through `ask-kit ask --domain code --backend acme-cli "<question>"`,
   a follow-up with `--continue`, and a cancel (Ctrl+C) to check the CLI process ends. Read the
   journal row: `kind`, `ok`, `ms`, `usage`. Then run the [benchmark](run-the-benchmark.md) on it.

7. **Update the docs**: [Choose the model](../models.md), the config reference's
   [`backends`](../reference/config.md#backends) section and [Backends](../internals/backends.md).

If you also want the same CLI's transcripts readable, or the `ask` tool registered in it, that is a
separate step: [Support a new coding agent](add-an-agent.md).

## Related

- [Config file reference](../reference/config.md)
- [Run the benchmark](run-the-benchmark.md): compare the new backend on the same questions.
- [Find and fix a bad answer](debug-a-bad-answer.md): `--backend` reruns.
