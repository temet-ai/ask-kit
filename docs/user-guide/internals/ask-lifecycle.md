# Life of one ask

An ask starts as one MCP tool call from your agent and ends as one text answer. Between the two,
a router picks a domain, a per-domain server starts an investigator on the configured backend,
the investigator runs cells in a REPL, and the server writes a journal entry. The cells, their
results and the files they read stay in the investigator's session; the answer is the only part
that enters your agent's context. This page follows that path through the code.

## Files

| File | What is in it |
|---|---|
| [bin/ask-kit.mjs](https://github.com/temet-ai/ask-kit/blob/main/bin/ask-kit.mjs) | The `serve` command: with `--domain` it imports `src/server.mjs`, without it it calls `serveRouter()`. |
| [src/router.mjs](https://github.com/temet-ai/ask-kit/blob/main/src/router.mjs) | `serveRouter` (the `ask` tool your agent sees), `makeRouter` (`byModel`, `byRules`), the `RULES` keyword table. |
| [src/server.mjs](https://github.com/temet-ai/ask-kit/blob/main/src/server.mjs) | One domain's MCP server. The outer face registers `ask` through `registerAsk`; the inner face (`ASK_KIT_INNER=1`) registers `repl`, `help`, `reset` and `load`. Also the `journal` function and `keep`. |
| [src/ask.mjs](https://github.com/temet-ai/ask-kit/blob/main/src/ask.mjs) | `registerAsk`: the domain's `ask` tool, the four backend functions `askClaude`, `askCodex`, `askCopilot`, `askApi`, the `KINDS` table, `RESERVE_MS`, `MAX_STEPS`, `CELL_MAX_S`. |
| [src/platform.mjs](https://github.com/temet-ai/ask-kit/blob/main/src/platform.mjs) | `runCli`: starts a CLI investigator, kills it on timeout or abort. |
| [src/config.mjs](https://github.com/temet-ai/ask-kit/blob/main/src/config.mjs) | `callerSession` (which session is asking), `STATE_ROOT`, `slug`. |

## The two servers

`ask-kit serve` runs `serveRouter()` in `src/router.mjs`. That process is the MCP server your
agent talks to, and it exposes one tool, `ask`, whose description lists every enabled domain with
its `says` line. It does no investigating itself.

For each domain it picks, the router starts a second process, `src/server.mjs` with
`ASK_KIT_DOMAIN=<name>`, and keeps it for the life of the router. It talks to it as an MCP client
(the `child` function). `ask-kit serve --domain code` skips the router and starts that second
process directly; the tool is then called `ask` as well, but it has no `about` and no routing.

Both of those are the outer face of a domain server. The same file has a second face for the
investigator, described in [The REPL](repl.md). `registerAsk` is only called when `INNER` is
false:

```js
if (!INNER) {
  const { registerAsk } = await import("./ask.mjs");
  registerAsk(server, { z, config: CONFIG, domainName: DOMAIN_NAME, domain: DOMAIN, STATE_DIR, SESSION, helpText, fingerprintFiles, keep });
}
```

## 1. The router picks a domain

The tool in `serveRouter` takes `question`, `about`, `continue`, `backend` and `timeoutSeconds`.
It chooses the domain in this order and records how in `how`:

| Order | Condition | `how` |
|---|---|---|
| 1 | The caller passed `about` | `caller` |
| 2 | `continue: true` and the router has a last domain for this caller | `follow-up` |
| 3 | Only one domain is enabled | `only` |
| 4 | `byModel(question)` returns a domain name | `model` |
| 5 | Otherwise `byRules(question)` | `rules` |

`byModel` needs `config.router.backend` to name a backend of kind `api`. It posts one chat
completion to that endpoint, with an 8 second timeout, `temperature: 0` and `max_tokens: 200`.
The system prompt lists the enabled domains with their `says` text and asks for one word. The
question is cut to its first 2000 characters. If the reply is not an enabled domain name, or the
call fails for any reason, `serveRouter` catches the error, uses `byRules`, and stores the error
text (160 characters) as `routeError` in the router journal.

`byRules` runs the `RULES` regular expressions in order (`sessions` first, then `code`) and
returns the first domain whose words match and which is enabled. With no match it returns the
first enabled domain. The rules are a fallback; setup writes `router.backend` whenever an API
backend is configured, so keyword routing is what you get with a CLI-only setup.

The last domain is stored per calling session in `STATE_ROOT/router/last-<session>.json`, so a
follow-up from a new process still reaches the same investigator. `continue` is forwarded to the
domain server only when the chosen domain is the remembered one (`cont && name === last`). An
`about` that names a different domain therefore turns the follow-up into a fresh question.

The router appends `[routed to <domain> by <how>]` to the answer unless `how` is `caller` or
`only`. It writes one line per ask to `STATE_ROOT/router/<session>.jsonl` with the question
(500 characters), the domain, `how` and `routeMs`.

The router waits for the domain server with a timeout of `(timeoutSeconds ?? 300) * 1000 + 30000`
ms and passes the client's cancellation signal on.

## 2. The domain server's `ask` tool

`registerAsk` in `src/ask.mjs` registers `ask` on the domain server. Its inputs are `question`
(also accepted as `request` or `prompt`), `backend`, `continue` and `timeoutSeconds` (30 to 900,
default 300). `backend` is an enum of the names in `config.backends.list`.

**Choosing the backend.** `DEFAULT` is the first of these that exists in the list:
`config.domains[domain].backend`, the domain's `defaultBackend`, `config.backends.default`, the
first backend name. A `backend` argument overrides it. [Backends](backends.md) covers the config.

**Timeout.** The handler works out `timeoutMs`:

```js
const clientMs = Number(process.env.MCP_TOOL_TIMEOUT) || 0;
const timeoutMs = Math.max(20_000, Math.min(timeoutSeconds * 1000, clientMs ? clientMs - RESERVE_MS : Infinity));
```

`MCP_TOOL_TIMEOUT` is read from the environment if the agent sets it; ask-kit sets it nowhere.
`RESERVE_MS` is 15 seconds, held back from the client's limit so the closing call (below) has time
to run. The `api` backend gets `timeoutMs`. The CLI backends get `timeoutMs + RESERVE_MS - 2000`.

**Cancellation.** `extra.signal` is the MCP request's abort signal. It reaches `runCli` (which
sends `SIGTERM` to the CLI), the `fetch` calls (through `AbortSignal.any`) and the REPL tool
calls. The API loop checks it before each model call and after each reply, and throws
`the calling client cancelled the ask`.

**Errors.** Any exception is caught in the handler. It writes a journal entry with `ok: false`,
`cancelled`, `error` (300 characters) and `ms`, and returns `ask failed (<backend>): <message>`
with `isError: true`.

## 3. The backend runs the investigation

`KINDS` maps `be.kind` to a function. All four take `(backend, question, timeoutMs, cont, signal)`
and return an object with `answer`, `ok`, `model`, `continued`, `ms`, `costUsd` and `usage`.

| Kind | How the question is run |
|---|---|
| `claude-cli` | `askClaude`: `claude -p`, warmed once, then `--resume <warm> --fork-session` per question. |
| `codex-cli` | `askCodex`: `codex exec`, warmed once, then `codex exec fork <warm>` per question. |
| `copilot-cli` | `askCopilot`: `copilot -p` every time, with the instructions in the prompt. No warm session. |
| `api` | `askApi`: ask-kit runs the loop itself against an OpenAI-compatible endpoint. |

### Warm sessions and forks (CLI backends)

A CLI investigator with the instructions, scripts and typed API loaded is expensive to start, so
`askClaude` and `askCodex` start one once and copy it for each question.

1. `fingerprint(b)` hashes the instructions file, every file in `ctx.fingerprintFiles()`
   (`server.mjs`, `core/toolkit.mjs`, the domain's `api.d.ts`, `instructions.md`, its
   `fingerprintFiles()`, and every `.mjs` in the scripts folder) and the JSON of the backend's
   config entry. It is the first 16 hex characters of a SHA-256.
2. `readWarm` reads `STATE_DIR/warm/<backend>.json`. It is reused when the stored `fingerprint`
   matches and has a `sessionId`. Anything else starts a new warm session. That is why editing
   an instruction or a script takes effect on the next ask with nothing to restart.
3. Warming runs the CLI once with `D.prime` as the prompt (a short "call `help`, run one cell,
   reply ready" text from the domain) and a 300 second timeout. The session id is saved with
   `saveWarm`. `askClaude` also saves `warmCostUsd`, because a fork's `total_cost_usd` includes the
   warm session's and is subtracted later.
4. Each question forks the warm session: `--resume <warm.sessionId> --fork-session` for Claude,
   `exec fork <warm.sessionId>` for Codex. The question text is `question + D.answerRules`.

Copilot cannot fork, so `askCopilot` puts the instructions file and the question in one prompt,
and uses `--resume <innerSession>` only for follow-ups.

The warm sessions live in `STATE_DIR/warm/cwd`, a folder the investigator uses as its working
directory. The sessions domain excludes that path from its own transcript search so an
investigator's sessions do not show up as past work.

### Follow-ups (`continue`)

After each ask, `writeLast(b, ...)` saves what is needed to continue into
`STATE_DIR/warm/last-<session>.json`, keyed by backend. The file name uses the calling session, so
two agents do not continue each other's investigations.

| Kind | What is saved | What `continue: true` does |
|---|---|---|
| `claude-cli` | `innerSession`, `reportedTotalUsd` | `--resume <innerSession>` (no new fork) |
| `codex-cli` | `innerSession` (the thread id) | `codex exec resume <innerSession>` |
| `copilot-cli` | `askId`, `innerSession` | `--resume <innerSession>` |
| `api` | `askId` and the whole `messages` array | appends the question to the saved messages |

With nothing saved for that backend and session, a continue throws
`nothing to continue: no earlier <backend> question in this session`. The REPL variables come back
through the snapshot; see [The REPL](repl.md#saved-state-between-cells-and-for-follow-ups).

### The API loop

`askApi` is the only backend where ask-kit itself drives the steps.

1. **Endpoint.** `endpoint(be)` resolves the preset's base URL, the key and any extra body
   fields. OpenRouter requests add `usage: { include: true }` so the reply carries a cost.
2. **Messages.** A new ask builds a system message from the instructions file, a paragraph on how
   to use the REPL (native tool or code blocks), `D.openWith` and the `help` library text (script
   list and `api.d.ts`). The user message is `question + D.answerRules`. With
   `be.explicitCache` the system message is sent as a block with
   `cache_control: { type: "ephemeral" }`. The system text and the first user message are
   identical for every ask on this domain and backend, which is what lets the provider's prompt
   cache serve the prefix. For OpenRouter the body also carries
   `session_id: ask-kit-<domain>-<backend>-<fingerprint>`, and `providerOrder` pins providers, so
   every ask lands on the same provider and its cache.
3. **Inner REPL.** `openInnerRepl` starts `src/server.mjs` as a child with `ASK_KIT_INNER=1` and
   `ASK_KIT_SESSION=ask-<askId>`, and connects as an MCP client. It is closed in a `finally`.
4. **The loop.** Up to `MAX_STEPS` (20) times: check cancellation, stop if under 3 seconds are
   left, post the chat request (`temperature: 0`, `max_tokens: 4000`), then handle the reply.
5. **Native tools** (default; `be.nativeTools !== false`). The request offers one tool, `repl`
   (`REPL_TOOL`), with `parallel_tool_calls: false`. Calls with the name `repl`, or any call whose
   arguments contain a `"code"` key, count as REPL calls, because small models misname the tool.
   A reply with no tool call and no text, or with tool-call markup in the text, is a misstep: the
   loop adds "Call the `repl` tool to run code, or reply with the final answer as plain text." and
   goes round again, still using a step. A reply with plain text is the answer.
6. **Code-block mode** (`nativeTools: false`). The model writes one fenced `js` block per turn.
   Only the first block runs, and the stored assistant message is cut at its end, so a result the
   model wrote itself never enters the history. The result comes back as a user message. A reply
   with no block is the answer.
7. **Running a cell.** `runCode` calls the inner `repl` tool with `maxChars: 4000` and a
   `timeoutSeconds` of the smaller of `CELL_MAX_S` (60) and the time left minus 2 seconds (at
   least 1). A cell that does not finish returns text telling the model to narrow it, and the loop
   continues.

#### Call budget and the "calls left" text

After each cell the result gets a suffix: `N calls left.` and, at 2 or fewer, `N call(s) left.
Answer now with what you have, saying what you could not confirm.` `left` is
`MAX_STEPS - step - 1`. If the answer arrives while `left <= 2`, `atLimit` is set and the answer
gets `[answered at the step limit: if something is missing, ask again with continue: true]`.

#### Running out of steps or time

If the loop ends with no answer (out of steps, or under 3 seconds left, or a request timed out),
`askApi` makes one more call with no tools: "You are out of time/steps. Reply now in plain text ...".
That call's timeout is `max(1000, leftMs() + RESERVE_MS - 2000)`, which is where the reserve is
spent. Its text becomes the answer, prefixed `[stopped at the 300s time limit; this is what it
found]` (or the step limit). With no text, the answer says it stopped after N cells with nothing to
report. A partial answer ends with
`[not finished: ask again with continue: true to carry on from here]`. If a reply had
`finish_reason: "length"`, `cutAtLength` adds a note that the reply may be cut off.

### What the CLI backends limit

The CLI backends have no step counter in ask-kit. They stop at their own end of turn, or when
`runCli` kills them at the timeout. Codex reports the number of REPL calls in `cells`, Copilot
counts `tool.execution_start` events, Claude reports `num_turns` as `turns`.
[Backends](backends.md#how-the-cli-investigators-are-limited) lists the flags that stop a CLI
investigator from using anything but the REPL.

## 4. What the caller gets back

The handler returns the answer text plus a footer, and `isError: !r.ok`:

```js
const footer = `\n\n[${domainName} · ${backend} · ${Math.round(r.ms / 1000)}s${r.costUsd ? ` · $${r.costUsd.toFixed(4)}` : ""}]`;
```

The footer shows the domain, the backend name from config (not the model id), the time in whole
seconds and, when the backend reports one, the cost in dollars. `costUsd` is `null` for Codex and
Copilot and for API presets that do not report cost (only OpenRouter does), so no cost appears for
those. If the router chose the domain, it adds its own `[routed to ...]` line after this.

## 5. The journal entry

`ctx.keep` is `server.mjs`'s `journal` call with `type: "ask"`:

```js
keep: (entry) => journal({ ts: new Date().toISOString(), session: SESSION, type: "ask", ...entry, answer: undefined, answerChars: entry.answer?.length })
```

It appends one JSON line to `STATE_DIR/<session>.jsonl`, where `STATE_DIR` is
`STATE_ROOT/<domain>` (for `code`, one more folder per repository). The line holds the full
`question`, `backend`, `kind`, everything the backend function returned (`ok`, `model`, `ms`,
`costUsd`, `usage`, `cells` or `turns`, `partial`, `atLimit`, `cutAtLength`, `missteps`,
`providers`, `warm`, `continued`) and `answerChars`; the answer text itself is dropped. A failed
ask has `ok: false`, `error` and `cancelled` instead.

The investigator's own cells are journaled by the inner server into a different file in the same
folder, named after its session (`ask-<askId>.jsonl` for the API loop). `ask-kit report` reads
both. [Journal](../reference/journal.md) lists every field.

```
your agent      ── ask(question, about?, continue?) ──────────────▶ router (serveRouter)
router          picks the domain: about, follow-up, only one, model, rules
router          ── ask(question, backend?, continue?) ────────────▶ domain server (registerAsk)
domain server   ── askClaude / askCodex / askCopilot / askApi ────▶ investigator
investigator    ── repl(code) ───▶ inner REPL (server.mjs, ASK_KIT_INNER=1)
                ◀── result text ─┘   repeated, one cell per step (up to MAX_STEPS for an API)
investigator    ── answer ────────────────────────────────────────▶ domain server
domain server   writes the journal entry (type: ask)
domain server   ── answer + footer ───────────────────────────────▶ router
router          ── answer (+ [routed to ...]) ────────────────────▶ your agent
```

## What to look at when changing it

- Adding a routing rule or changing how the router asks: `RULES`, `byRules` and `byModel` in
  `src/router.mjs`. The `says` line of each domain is what the router model reads, so a better
  `says` often fixes a mis-route with no code change.
- Changing a limit: `MAX_STEPS`, `CELL_MAX_S`, `RESERVE_MS` at the top of `src/ask.mjs`. The text
  of the "calls left" nudge is in `askApi` (`nudge`). Check the effect on the benchmark first; see
  [Run the benchmark](../guides/run-the-benchmark.md).
- Changing what the investigator is told: the domain's `instructions.md`, `prime`, `answerRules`
  and `openWith`. `answerRules` is appended to every question, so a change there applies to every
  backend. See [Domains](domains.md).
- Adding a backend kind: add a function to `KINDS`, return the same fields, and call `readLast`
  and `writeLast` the way the others do. See [Add a backend](../guides/add-a-backend.md).
- A follow-up that restores the wrong state or none: check `readLast`/`writeLast`, the
  `replEnv(inherit, ownId)` values that decide which session id the inner server uses, and the
  snapshot rules in `src/server.mjs`.
- Debugging one bad answer: [Debug a bad answer](../guides/debug-a-bad-answer.md).

Tests: no test calls `registerAsk` or the router, because both need a model. `test/repl.mjs`
starts `src/server.mjs` in both faces (inner lists `help`, `load`, `repl`, `reset`; outer lists
only `ask`) and `test/setup.mjs` checks the config that routing reads (`router.backend` is set
to the first API backend). `npm test` runs `fixtures.mjs`, `setup.mjs`, `repl.mjs` and
`bundle.mjs`. See [Testing](../guides/testing.md).
