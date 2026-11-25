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

Both forms need a config file. Without one `ask-kit serve` still lists `ask`, and a call returns
how to set ask-kit up.

## Parameters of the router's `ask`

| Parameter | Type | Required | What it does |
|---|---|---|---|
| `question` | string | yes | The question or request in plain words, with any ids, names or dates you know. |
| `about` | one of the enabled domain names, or an alias | no | Which investigator answers. Left out, the router chooses. |
| `continue` | boolean or string | no, default `false` | `true`: send this as a follow-up to the investigator that answered your last question. A task id such as `"ask-67821061f8d0"`: send it to the investigator of that ask. See [Follow-ups](#follow-ups). |
| `wait` | boolean | no | `false`: hand the ask back as a task at once, with no 10-second wait. Used by a client that takes tasks; any other caller waits for the answer. See [A slow ask answered as a task](#a-slow-ask-answered-as-a-task). |
| `backend` | string | no | A backend name from the config. Left out, the domain's backend is used. |
| `timeoutSeconds` | integer, 30 to 900 | no | How long the investigation may run. The domain's `ask` defaults to 300. |
| `act` | boolean | no | `true`: the request asks for a change, so the investigator gets the calls that change things. Left out, the router sets it to `true` when the request opens with what to do; `false` keeps the ask read-only. See [Asking for a change](#asking-for-a-change-act). |

### What the agent is told about it

Claude Code keeps 4,096 characters of the description of a tool it loads upfront, and of the
server's instructions, and does not cut the input schema. So the words are placed like this:

| Where | What it holds |
|---|---|
| The tool's description | How to call `ask`, and the names of the enabled domains and aliases. It stays under 4,096 characters: an alias list that would pass that moves whole to `about`, and so does the list of names. |
| The `about` parameter's description | The whole `says` text of every enabled domain, one per line, and each capability that more than one of them provides, under the one that wins it. |
| The server's instructions | When to call `ask`. They are the same for every set of kits. |

Each kit's `says` is listed once and never shortened.

The tool's `_meta` tells Claude Code two more things:

| Key | Value | What it does |
|---|---|---|
| `anthropic/alwaysLoad` | `true` | The tool is in context from the start of a session, with no tool search. The Claude Code plugin also sets `alwaysLoad` on its `ask` server, so startup waits for it, at most 5 seconds. |
| `anthropic/maxResultSizeChars` | `500000` | A result of up to 500,000 characters, Claude Code's ceiling, reaches the agent whole. Without it, Claude Code saves a result over 50,000 characters to a file. |

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
| `down` | The kit chosen names its service (`up` in its manifest) and the service was not answering, so the next provider of its capability got the question without the kit being asked. The answer ends with a line saying so. |

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
| `act` | boolean | no | Whether the investigator may change things. Left out: `true` when the request opens with what to do, or when `continue: true` follows an ask that could act; otherwise `false`. |

If several of `question`, `request` and `prompt` are given, the first non-blank one in that order
is used. The tool's description is the domain's `askDescription`, followed by
`For a follow-up, pass continue: true ...` and the list of backend names with the default.

### How long an ask may run

The time limit is the smaller of `timeoutSeconds` and the calling agent's own tool timeout minus
15 seconds, and never under 20 seconds. ask-kit reads that tool timeout, in milliseconds, from
the environment variable `MCP_TOOL_TIMEOUT` when the agent sets it. This keeps the answer from
arriving after the agent has already dropped the call.

An `api` investigation has no step limit; the time limit is its budget. With under 30 seconds left
each cell result tells the model to answer. When the limit arrives, or when the same cell has
returned the same result three times, the model gets one more call to say what it found. For the agent CLIs the limit is the process timeout, with
13 seconds added for the CLI to finish.

### A slow ask answered as a task

When an ask has run for 10 seconds, the router answers the call with an MCP task and the ask
carries on. The caller gets a task id such as `ask-67821061f8d0` and goes on working, and its
client collects the answer when the ask ends. Claude Code then gives the answer to the agent and
starts a turn if the session is idle. An ask that ends inside the 10 seconds is answered in the
call as before.

This needs a client that takes tasks: one that connects on MCP protocol revision 2026-07-28 and
names the Tasks extension (`io.modelcontextprotocol/tasks`) in the request. Claude Code does from
v2.1.304, in the main conversation of a terminal session. Every other caller (a subagent, an
earlier Claude Code, Codex, the shell) waits for the answer in the call.

| What | How |
|---|---|
| The delay | `taskAfterSeconds` in the config, default `10`. `0` turns tasks off. `wait: false` on an ask skips the delay for that ask. |
| Status while it runs | `tasks/get` reports `working`, with the latest cell as `statusMessage` on an API backend. |
| The answer | `tasks/get` reports `completed` with the same result the call would have returned. A failed ask is `completed` with `isError: true`. |
| Stopping it | `tasks/cancel` stops the investigator, and the task stays `cancelled`. |
| How long it is kept | One hour after the ask ends, in the router's memory. The router process ends with the agent session, and its tasks with it. |

The task answer itself carries no words for the agent, so the tool's description and the server's
instructions say what to do with one: do the work that does not depend on the answer (read the files about to
change, send the other asks), don't wait or ask again, start on each answer as it arrives, and end
the turn only when every step left needs an answer that has not come. The rule `ask-kit init` installs says the same.

Several asks can run at once this way. Claude Code sends one `ask` call at a time and holds the
next until the first returns, so two slow questions each wait their 10 seconds before the second
starts. Sent with `wait: false`, each comes back as a task at once and they run side by side.

Each task has its own investigator, and its id is how a follow-up reaches it: see
[Follow-ups](#follow-ups).

### Follow-ups

`continue: true` goes back to the last investigator ask-kit ran for this calling session on the
same backend. The caller's session is the first of these environment variables that is set:
`ASK_KIT_SESSION`, `CLAUDE_CODE_SESSION_ID`, `CODEX_THREAD_ID`, `CODEX_SESSION_ID`,
`COPILOT_SESSION_ID`. If none is set, ask-kit uses `client-<pid of the agent process>`.

A follow-up needs an earlier question on the same backend. Without one it fails with
`nothing to continue: no earlier <backend> question in this session`.

With several asks running or answered, `continue: true` means the domain asked last and, there,
the investigator that finished last. To follow up on a particular ask, pass its task id:

```json
{ "question": "which test covers that function?", "continue": "ask-67821061f8d0" }
```

| What | How |
|---|---|
| Where it goes | To the domain and backend that took that ask, and the conversation that investigator held, whatever was asked in between. `about` is ignored. |
| An ask still running | The follow-up waits for it to end, then goes to the same investigator. |
| A slow follow-up | It becomes a task with an id of its own. That id and the first one both reach the conversation. |
| The bracketed lines | An answer delivered as a task says `continue: "<its id>"` where an answer in the call says `continue: true`. |
| How long an id works | A day. The router keeps the ids in `<STATE_ROOT>/router/threads-<caller>.json`, so one still works after the agent restarts its `ask` server. |
| An id that is not kept | The ask fails with `no ask with the id "<id>" is kept here` and lists the latest ids that are, each with its domain and the start of its question. |

### Asking for a change (`act`)

An investigator reads text nobody vouched for: repository files, issue bodies, tool output inside
transcripts. So its REPL holds the calls that change things only when the caller's own request
asked for a change. Text read during the ask never grants them.

`act` is `true` when one of these holds, in this order:

| Source | When |
|---|---|
| The caller | `act: true` was passed. `act: false` keeps the ask read-only, whatever it says. |
| The request | It opens with a verb that changes something, after any "please", "can you" or "go ahead and": fix, add, write, edit, commit, run, restart, send, record, message, delete and the like (`ACTING` in [`src/actions.mjs`](https://github.com/temet-ai/ask-kit/blob/main/src/actions.mjs)). The router sets `act` from it and journals `actBy: "request"`; a domain's own `ask` does the same when `act` is left out. |
| A follow-up | `continue: true` with `act` left out keeps the `act` of the ask it continues. |
| An action | A kit's acting [[actions]] entry, turned on in the config, matched the whole request. |
| A shot | `do` runs the script the caller named, with no model: it may act unless `act: false`. |

What `act: false` holds back:

| Domain or source | Without `act` |
|---|---|
| `code`, and a kit's `folder` sources | `write`, `edit` and `run` throw. `git` runs only commands that read (`log`, `show`, `diff`, `blame`, `status`, `ls-files`, `grep` and a few more), without options that write a file (`--output`). |
| A kit's `mcp` source | Tools named in the kit's `acts` (`mike.define_fleet`) throw. |
| A kit's `cli` source | A call whose arguments hold an `acts` phrase (`gh pr comment`) is refused. |
| A kit's `module` source | Functions named in `acts` (`inspect.start`) throw, also when a call names one as its first argument (`mcp.call("send_session_message")` for `mcp.send_session_message`), and so does a call whose arguments hold an `acts` phrase. The module's `make()` also gets `act`, for the acts the host cannot recognise. |
| `ask.kit` | The other kit is asked with the same `act`, never inferred from the question. |

A withheld call throws `... is off in this ask` or `not in this ask: ...`, and the investigator is
told to answer what it can and say that the change needs `ask` with `act: true`. Every ask row in
the journal has `act`.

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
| `[stopped at the <N>s time limit; this is what it found]` or `[stopped at a search that kept repeating; this is what it found]` | It ran out of time, or kept getting the same result, and was asked for what it had. |
| `[stopped at ... after <N> cells, with nothing it could report]` | It ran out and the closing call returned nothing. |
| `[the reply hit the length limit and may be cut off]` | The model's reply was cut at `max_tokens`. |
| `[not finished: ask again with continue: true to carry on from here]` | Added to every partial answer. |
| `[answered near the time limit: if something is missing, ask again with continue: true]` | It answered with under 30 seconds left, or within two calls of the repeat stop. |

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

### A backend that refuses the ask

A backend can refuse an ask because of its key or account: the provider returns 401, 402, 403 or
429, or its message says the credit, quota, usage limit or rate limit ran out (OpenRouter past a
key's monthly limit, for example). The router then asks the person which other backend in the
config should answer, in a form the agent shows (MCP elicitation):

- **Answer with** lists the other backends. Those that share the refused backend's key (or, for an
  agent CLI, its account) come last and say they will likely be refused too.
- **Use it instead of `<backend>` from now on** also changes `config.json`: the chosen backend
  replaces the refused one as `backends.default`, `router.backend`, `escalate.backend`,
  `hedge.backend` and on every domain set to it. The domain servers running then are retired, so
  the next ask starts them on the new backend. The router's own model changes when the agent
  restarts.

The chosen backend answers the same question as a new conversation filed under the same id, and
the journal gets a router row with `how: "picked"`, `from` and `backend`. On protocol revision
2026-07-28 the call returns `input_required` with the form, and the client sends the same call
again with the answer. On earlier revisions the server asks while the call waits, for up to ten
minutes.

When the person declines, the refusal comes back with `The user chose no other backend, so don't
ask again.` When the client shows no forms, or the ask has already become a task, the refusal
comes back with the choices instead: `Other backends in ask-kit's config: <name>: <model> ...
Ask the user which one to use, then send the same ask again with backend: "<name>".`

## Progress

A caller that sends a `progressToken` (the MCP client's `onprogress`) gets one
`notifications/progress` per cell while an API backend works: `progress` is the cell's number and
`message` is `cell <n>: <first line>`, the cell's leading comment if it has one, cut at 100
characters. The router passes them on from the domain's server. CLI backends (Claude Code, Codex,
Copilot) send none.

## From the shell

```sh
ask-kit ask "<question>" [--domain <name>] [--backend <name>] [--continue] [--act | --no-act]
```

`--act` and `--no-act` pass `act: true` and `act: false`.

Starts `ask-kit serve` (with `--domain` when given) as a child, calls `ask` with a 900 second
client timeout, prints the text and exits with code 1 on `isError`. It asks for progress: on a
terminal, stderr shows a spinner with the seconds so far and one line per progress note; piped,
the notes are plain lines. On a terminal (and without `NO_COLOR`) the answer's Markdown is
rendered: headings and bold in bold, code in colour, bullets as `•`, the footer dimmed. Piped
output is the answer text unchanged. The shell is its own caller:
its session is `ASK_KIT_SESSION` or `shell-<pid of the shell>`, so `--continue` works between
shell commands in the same shell. With no `--domain` it goes through the router.

Related: [Command line](../command-line.md), [Use it](../asking.md).
