# The `ask` tool reference

`ask` is the one tool ask-kit gives an agent. This page lists its parameters, the text it returns
and when it reports an error. For how it works inside, see
[The life of an ask](../internals/ask-lifecycle.md).

Source: [`src/router.mjs`](https://github.com/temet-ai/ask-kit/blob/main/src/router.mjs)
(`serveRouter`), [`src/ask.mjs`](https://github.com/temet-ai/ask-kit/blob/main/src/ask.mjs)
(`registerAsk`) and [`src/server.mjs`](https://github.com/temet-ai/ask-kit/blob/main/src/server.mjs).

## The router and the domain servers

`ask-kit serve` starts the MCP server an agent registers. It has two forms:

| Command | Server name | What the agent sees |
|---|---|---|
| `ask-kit serve` | `ask` | The router's `ask`. It picks a domain, starts that domain's server on first use and forwards the call. This is what setup registers. |
| `ask-kit serve --domain <name>` | `ask-<name>` | That domain's own `ask`, with no routing. `ask-kit ask --domain` and the benchmark use this form. |

An agent gets one tool in either case. The investigator's own server, which has the REPL tools,
is started with `ASK_KIT_INNER=1` and never shows `ask`. See
[The REPL](../internals/repl.md).

Both forms need a config file. Without one the server exits at start with
`ask-kit is not set up yet`, and the agent lists no `ask` tool.

## Parameters of the router's `ask`

| Parameter | Type | Required | What it does |
|---|---|---|---|
| `question` | string | yes | The question or request in plain words, with any ids, names or dates you know. |
| `about` | one of the enabled domain names | no | Which investigator answers. Left out, the router chooses. |
| `continue` | boolean | no, default `false` | Send this as a follow-up to the investigator that answered your last question. |
| `backend` | string | no | A backend name from the config. Left out, the domain's backend is used. |
| `timeoutSeconds` | integer, 30 to 900 | no | How long the investigation may run. The domain's `ask` defaults to 300. |

The tool's description lists the enabled domains with their one-line descriptions (the `says`
field of each domain), and each capability that more than one of them provides, once, under the
one that wins it. The server's instructions do not repeat the list, so each kit costs the calling
agent's context once.

### How the router chooses a domain

In this order, first match wins:

| `how` | When |
|---|---|
| `shot` | `do` was given: the kit named, or the one kit with that script. |
| `caller` | `about` was given. |
| `follow-up` | `continue` is `true` and an earlier ask from this caller exists. It goes to the domain that answered last. |
| `only` | One domain is enabled. |
| `pattern` | A kit's `patterns` match the question and it has no past-work words ("session", "yesterday", "did we", "decided"). With past-work words the match is a hint in the router model's prompt instead. |
| `model` | `router.backend` is set and its one-word answer names an enabled domain. |
| `timeout` | The router model did not answer within `router.timeoutMs`: session history (`sessions`) answers. |
| `rules` | The model call failed or said something else, or no router model is set. Keyword rules: past-work words first, then kit `keywords`, then code words, else the first enabled domain. |
| `fallback` | The domain chosen answered with no data, and the next provider of its capability answered instead. |

Then capabilities: when the domain chosen by `caller`, `pattern`, `model`, `timeout` or `rules`
provides a capability (`[[provides]]`), the question goes to the best provider of it for the
agent the question names ("a codex session" goes to a provider whose `covers` include `codex`),
or to the highest priority when it names none. The routing record keeps the first choice in
`resolvedFrom`. An `about` that corrects the router within two minutes is used as given. When the
provider's answer ends with the line `[no data]`, the router asks the next provider once
(`fallback`) and returns that answer.

A kit's `route_hint` that names a domain not enabled here (`ops`, `mike`) is rewritten before the
router model reads it: `mike` and `sessions` become the past-work domain, other names are dropped.

When the same caller asks again within two minutes with an `about` naming another domain than
the router chose, the router records a misroute: see
[Misroute record](journal.md#misroute-record).

The router remembers the last domain per calling session on disk, so a follow-up from a new
process (the shell, a restarted agent) still reaches the same investigator.

The router passes `continue: true` on to the domain only when the chosen domain is the one that
answered last. If you give `about: "code"` with `continue: true` after a `sessions` answer, the
call runs as a new question on `code`.

### Router limits

- The router waits `timeoutSeconds` (300 when left out) plus 30 seconds for the domain's reply.
- `backend` is checked by the domain's server, not the router. An unknown name comes back as an
  error from the domain (see below).

## Parameters of a domain's `ask`

| Parameter | Type | Required | What it does |
|---|---|---|---|
| `question` | string | one of the three | The question or request. |
| `request` | string | one of the three | Same as `question`. |
| `prompt` | string | one of the three | Same as `question`. |
| `backend` | one of the backend names in the config | no | The model that investigates. Default: see [`backends`](config.md#backends). |
| `continue` | boolean | no, default `false` | Ask the same investigator as your last question on this backend, so it keeps what it found. |
| `timeoutSeconds` | integer, 30 to 900 | no, default 300 | Time limit for the ask. |

If several of `question`, `request` and `prompt` are given, the first non-blank one in that order
is used. The tool's description is the domain's `askDescription`, followed by
`For a follow-up, pass continue: true ...` and the list of backend names with the default.

### How long an ask may run

The time limit is the smaller of `timeoutSeconds` and the calling agent's own tool timeout minus
15 seconds, and never under 20 seconds. ask-kit reads that tool timeout, in milliseconds, from
the environment variable `MCP_TOOL_TIMEOUT` when the agent sets it. This keeps the answer from
arriving after the agent has already dropped the call.

For an `api` backend the investigation stops at the limit, or after 20 steps, and the model gets
one more call to say what it found. For the agent CLIs the limit is the process timeout, with
13 seconds added for the CLI to finish.

### Follow-ups

`continue: true` goes back to the last investigator ask-kit ran for this calling session on the
same backend. The caller's session is the first of these environment variables that is set:
`ASK_KIT_SESSION`, `CLAUDE_CODE_SESSION_ID`, `CODEX_THREAD_ID`, `CODEX_SESSION_ID`,
`COPILOT_SESSION_ID`. If none is set, ask-kit uses `client-<pid of the agent process>`.

A follow-up needs an earlier question on the same backend. Without one it fails with
`nothing to continue: no earlier <backend> question in this session`.

## What comes back

A successful ask returns one text block holding the answer and nothing else:

```
Exporters implement Exporter in src/export/base.ts:12 ...
```

(An illustration of the shape; the text is the investigator's own.)

The time, backend and cost of each ask go to the journal (`ask-kit report` shows them), not to
the reply: agents repeat whatever the reply carries. A bracketed line is added only when the
caller has something to do, such as `[not finished: ask again with continue: true]`.

For `code` and `sessions`, the host also resolves the answer's citations with no model (`path:line`
and `path:line-line` against the repository; `<source> <session> #<event>` against the
transcripts, with `#<event>` chained after a comma or "and" taken as the same session). When some
do not resolve, a line says which, and the caller should not rely on those:

```
[2 of 7 citations did not resolve: src/x.mjs:900, codex 5ca1ab1e #41]
```

At most 20 citations are checked, within 3 seconds. The counts go to the journal
(`citations`), and `ask-kit report` shows the failed rate by domain.

With `"footer": true` in the config, each answer also ends with a footer, and the router adds a
line when it chose the domain itself:

```
[code · glm-5.3-flash · 21s]
[routed to code by model]
```

| Part | Meaning |
|---|---|
| `code` | The domain that answered. |
| `glm-5.3-flash` | The backend's name from the config. |
| `21s` | Time of this ask, rounded. For `claude-cli` and `codex-cli` it leaves out the warm-up. |
| `by model` | How the router chose: `model`, `rules` or `follow-up`. No routing line when you gave `about` or when one domain is enabled. |

### Notes the answer can carry

When an `api` investigation did not finish, the answer says so in its text. These notes are part
of the answer, and `isError` stays `false`.

| Text | Meaning |
|---|---|
| `[stopped at the 20-step limit; this is what it found]` or `[stopped at the <N>s time limit; ...]` | It ran out of steps or time and was asked for what it had. |
| `[stopped at ... after <N> cells, with nothing it could report]` | It ran out and the closing call returned nothing. |
| `[the reply hit the length limit and may be cut off]` | The model's reply was cut at `max_tokens`. |
| `[not finished: ask again with continue: true to carry on from here]` | Added to every partial answer. |
| `[answered at the step limit: if something is missing, ask again with continue: true]` | It answered with two or fewer steps left. |

## Errors

An error has `isError: true` and text starting `ask failed (<backend>): <message>`. Through the
router the text is `ask failed (<domain>): <message>`.

| Message | Cause |
|---|---|
| ``ask needs `question`: the question or request, in plain words.`` | None of `question`, `request`, `prompt` held text. No `ask failed` prefix. |
| `nothing to continue: no earlier <backend> question in this session` | `continue: true` with no earlier ask on that backend. |
| `no API key for <provider>: {...} is empty` | An `api` backend found no key. See [Key references](config.md#key-references). |
| `backend has no baseUrl (preset <name>)` | An `api` backend with no base URL. |
| `<preset> <status>: <body>` | The provider returned an HTTP error or an error body. |
| `warming failed: ...` | The agent CLI could not start its warm session. |
| `claude exited <code>: ...`, `codex exited ...`, `copilot exited ...` | The CLI exited without a result. Often it is not signed in. |
| `the calling client cancelled the ask` | The agent cancelled the call. Also journaled as `cancelled`. |
| `backend <name> has unknown kind "<kind>"` | A `kind` that is not one of the four. |

Two more cases return text with `isError: true` and no `ask failed` prefix: a `claude-cli` result
the CLI marked as an error returns that text, and a `codex-cli` run that produced no message
returns `codex failed: ...` or an empty answer.

A `backend` name that is not in the config is rejected before the ask runs, by the MCP schema of
the domain's server, and the agent gets the client library's validation message.

Every ask, failed or not, is written to the [journal](journal.md).

## Progress

A caller that sends a `progressToken` (the MCP client's `onprogress`) gets one
`notifications/progress` per cell while an API backend works: `progress` is the cell's number and
`message` is `cell <n>: <first line>`, the cell's leading comment if it has one, cut at 100
characters. The router passes them on from the domain's server. CLI backends (Claude Code, Codex,
Copilot) send none.

## From the shell

```sh
ask-kit ask "<question>" [--domain <name>] [--backend <name>] [--continue]
```

Starts `ask-kit serve` (with `--domain` when given) as a child, calls `ask` with a 900 second
client timeout, prints the text and exits with code 1 on `isError`. It asks for progress: on a
terminal, stderr shows a spinner with the seconds so far and one line per progress note; piped,
the notes are plain lines. On a terminal (and without `NO_COLOR`) the answer's Markdown is
rendered: headings and bold in bold, code in colour, bullets as `•`, the footer dimmed. Piped
output is the answer text unchanged. The shell is its own caller:
its session is `ASK_KIT_SESSION` or `shell-<pid of the shell>`, so `--continue` works between
shell commands in the same shell. With no `--domain` it goes through the router.

Related: [Command line](../command-line.md), [Use it](../asking.md).
