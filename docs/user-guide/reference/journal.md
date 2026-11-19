# Journal reference

ask-kit records every ask and every REPL cell. The records are plain JSON lines you can read with
`jq`, and `ask-kit report` summarises them.

Sources:
[`src/server.mjs`](https://github.com/temet-ai/ask-kit/blob/main/src/server.mjs) (`journal`,
`runCell`, `keep`),
[`src/ask.mjs`](https://github.com/temet-ai/ask-kit/blob/main/src/ask.mjs) (the result objects of
`askClaude`, `askCodex`, `askCopilot`, `askApi`),
[`src/router.mjs`](https://github.com/temet-ai/ask-kit/blob/main/src/router.mjs) (`journal`) and
[`src/report.mjs`](https://github.com/temet-ai/ask-kit/blob/main/src/report.mjs) (`report`).

## Files

A journal file is `<state>/<session>.jsonl`, with one JSON object per line. `<state>` is the
domain's folder in the state folder; see [Files and environment variables](files-and-env.md#state-folder).
Files are created with mode `0600` and only ever appended to.

| File | Written by | Holds |
|---|---|---|
| `<state>/<caller session>.jsonl` | The server the calling agent talks to | One `ask` record per ask from that session. |
| `<state>/<investigator session>.jsonl` | The investigator's REPL server | One cell record per cell the investigator ran. For `api` and Copilot CLI asks the session is `ask-<uuid>`. |
| `<STATE_ROOT>/router/<caller session>.jsonl` | The router | One routing record per routed ask, and a misroute record for each route that turned out wrong. |
| `<STATE_ROOT>/router/bench.jsonl` | The router | One router-bench row per misroute: `at`, `question`, `routed`, `correct`, `why`. `node bench/router.mjs` routes them again. |

Nothing rotates or deletes a journal. To see which journal a record is in, look at the `journal`
field of `ask-kit report --json`.

A line that is not valid JSON is skipped by the report.

## Ask record

Written once per ask, whether it succeeded or not. `type` is `"ask"`.

| Field | Type | Meaning |
|---|---|---|
| `ts` | string | ISO time the record was written (the end of the ask). |
| `session` | string | The calling session. |
| `type` | `"ask"` | Marks the record. |
| `question` | string | The question, in full. |
| `backend` | string | The backend's name. |
| `kind` | string | `api`, `claude-cli`, `codex-cli` or `copilot-cli`. |
| `ok` | boolean | `false` when the ask failed. |
| `continued` | boolean | A follow-up. |
| `ms` | number | Duration of the ask. For the CLIs that warm a session it leaves out the warm-up. |
| `answerChars` | number | Length of the answer text. The answer itself is not stored. |
| `error` | string | On failure: the message, cut at 300 characters. |
| `cancelled` | boolean | On failure: the calling client cancelled the ask. |

The rest depend on the kind. A field that a kind does not produce is absent.

| Field | Kinds | Meaning |
|---|---|---|
| `model` | all | The model. `codex default` or `copilot default` when none was set. |
| `costUsd` | all | Dollars, or `null` when the provider does not report a cost. Reported for OpenRouter and `claude-cli`. For `claude-cli` it is this ask's share, with the warm-up taken out. |
| `usage` | all | `{ input, cacheRead, output }`, and `cacheWrite` for `api` and `claude-cli`. Tokens. |
| `turns` | `api`, `claude-cli` | Model calls in the ask. |
| `cells` | `api`, `codex-cli`, `copilot-cli` | REPL cells run (tool calls, for Copilot). |
| `warm` | `claude-cli`, `codex-cli` | `{ reused }`, and `warmCostUsd` for `claude-cli`: whether the warm session was reused, and what a fresh warm-up cost. |
| `partial` | `api` | The ask ran out of steps or time, or was cut at the length limit. |
| `cutAtLength` | `api` | A reply hit the length limit. |
| `atLimit` | `api` | The answer came with two or fewer steps left. |
| `providers` | `api` | The providers that served the calls, where the API says (OpenRouter does). |
| `missteps` | `api` | Replies that were empty or held tool-call markup instead of a tool call. |
| `premiumRequests` | `copilot-cli` | Premium requests used. |

## Cell record

Written after every REPL cell. It has `code` and no `type`.

| Field | Type | Meaning |
|---|---|---|
| `ts` | string | ISO time the cell ended. |
| `session` | string | The investigator's session. |
| `ok` | boolean | `false` when the cell threw or timed out. |
| `ms` | number | Duration. |
| `code` | string | The cell's code, as sent. |
| `declared` | string[] | Names the cell declared at its top level. |
| `resultChars` | number | Length of the text returned, after clipping. |
| `repeat` | number | Present when this cell, with its variable names blanked, has run before in this REPL: how many times now. |
| `error` | string or `null` | The error's first lines. |
| `scripts` | object[] | Scripts the cell ran: `{ name, draft, ok, ms }`, plus `error` on failure. A draft saved with `scripts.draft` appears as `{ name, draft: true, saved: true }`. |
| `calls` | object[] | Calls the domain's globals made: `{ kind, detail, ms, size }`. For `repo`: `rg`, `files`, `read`, `git`. For `history`: `sessions`, `events`, `grep`. `size` is the number of results or lines. |
| `snapshot` | object | `{ vars, fns, bytes, dropped }` after the cell, or `{ error }`. `dropped` names variables that could not be saved. |
| `restored` | object or `null` | On the first cell after a start: `{ from, savedAt, names }`, the variables brought back. |

A cell record, trimmed:

```json
{"ts":"2026-11-18T09:29:08.474Z","session":"ask-3f1c…","ok":true,"ms":2,
 "code":"const r = await scripts.run(\"find-notes\", { topic: \"action items\" }); r",
 "declared":["r"],"resultChars":318,"error":null,
 "scripts":[{"name":"find-notes","draft":false,"ok":true,"ms":1}],
 "calls":[{"kind":"list","detail":"{\"max\":10000}","ms":0,"size":2},
          {"kind":"search","detail":"action items","ms":0,"size":2}],
 "snapshot":{"vars":1,"fns":0,"bytes":220,"dropped":[]},"restored":null}
```

## Routing record

Written by the router before it forwards a call.

| Field | Meaning |
|---|---|
| `at` | ISO time. |
| `question` | The question, cut at 500 characters. |
| `domain` | The domain chosen. |
| `how` | `caller`, `follow-up`, `only`, `shot`, `pattern`, `model`, `timeout` or `rules`. See [The `ask` tool](ask-tool.md#how-the-router-chooses-a-domain). |
| `routeMs` | Time the choice took. |
| `routeError` | When the router model failed and the fallback decided: why, cut at 160 characters. |

### Misroute record

A route the router decided itself (`how` is `pattern`, `model`, `timeout` or `rules`) is a
misroute when the same calling session asks again within two minutes with an `about` naming
another domain. The router writes this record to the caller's routing file, and a row to
`router/bench.jsonl`.

| Field | Meaning |
|---|---|
| `at` | ISO time of the correction. |
| `type` | `misroute`. |
| `question` | The question that was misrouted, cut at 500 characters. |
| `routed` | Where the router sent it. |
| `how` | How the router chose it. |
| `correct` | Where it should have gone: the domain the caller named. |
| `why` | `re-asked`. |
| `afterMs` | Time between the two asks. |

The report counts the routes the router decided and lists the misroutes.

## `ask-kit report`

```sh
ask-kit report [--since 7d] [--json]
```

`--since` takes `<n>h`, `<n>d` or a date. The default is `7d`. Any other value stops with
`--since <value>: use 24h, 7d or a date`. The command reads every journal in the state folder
(folders `warm`, `drafts`, `gallery` and `index` are skipped), keeps records whose `ts` is in
range, and builds three things.

### Flagged asks

Each `ask` record gets zero or more signals. An ask with any signal is listed.

| Signal | When |
|---|---|
| `failed: <error>` | `ok` is `false`. |
| `cancelled` | `ok` is `false` and `cancelled` is true. |
| `out of steps or time` | `partial` is true. |
| `cut off` | `partial` is true because of `cutAtLength`. |
| `answered at the step limit` | `atLimit` is true. |
| `slow (<n>s)` | `ms` over 90 000. |
| `costly ($<n>)` | `costUsd` over 0.02. |
| `<n> missteps` | `missteps` over 2. |
| `empty answer` | `ok` is true and `answerChars` is 0. |
| `re-asked` | The same calling session asked again within three minutes, and not as a follow-up. A sign the first answer fell short. |
| `re-asked on another backend` | Same, and the second ask used a different backend. |

### Scripts

For every cell record with a `scripts` list, one count per script, keyed `<domain>/<name>` with
` (draft)` added for drafts: `runs`, and `failed` (runs where `ok` is false and the record is not a
save).

### Routes worth a script

For every cell that ran no script, the report takes the cell's shape: the code with strings
replaced by `"…"`, numbers by `N`, `const x =` removed, whitespace collapsed, cut at 90
characters. The key is `<domain>: <shape>`. A shape written three or more times is listed,
largest first, at most ten. Each is a search the investigator keeps writing by hand and could be a
[script](../guides/add-a-script.md).

### Output

Text:

```
Since 2026-11-11T09:27:08.327Z: 12 asks, 2 flagged, $0.0341, median 18 s
<ts>  <domain> · <backend> · <seconds>s  <signals joined by "; ">
  <question, cut at 140 characters>
  <journal file>
Scripts: code/where 9, sessions/grep 4 (1 failed)
Written by hand 3+ times (worth a script):
  4×  <shape>
Misroutes: 1 of 9 routed by the router (router bench rows: <state>/router/bench.jsonl)
  <at>  <routed> (by <how>) → <correct>, re-asked
    <question, cut at 140 characters>
```

`--json` prints:

| Field | Meaning |
|---|---|
| `since` | ISO time the range starts. |
| `asks` | Asks in range. |
| `flagged` | Asks with a signal. |
| `costUsd` | Sum of `costUsd`. |
| `medianSeconds` | Median duration in seconds, or `null` with no asks. |
| `flaggedAsks` | `[{ ts, domain, backend, session, question, ms, costUsd, cells, signals, journal }]`. `cells` is `cells` or else `turns`. |
| `scripts` | `[{ name, runs, failed }]`, most used first. |
| `worthAScript` | `[{ shape, n }]`. |
| `routed` | Routes the router decided itself (`pattern`, `model`, `timeout`, `rules`) in range. |
| `misroutes` | `[{ at, question, routed, how, correct, why, journal }]`, oldest first. |

The domain in the report is the first path part under the state folder. For the `code` domain it
is `code` for every repository.

To read one flagged ask, open the journal named in `journal`, find the ask by `question`, and read
the cell records of its investigator. [Find and fix a bad answer](../guides/debug-a-bad-answer.md)
walks through it.

Related: [Make it better](../tuning.md), [Files and environment variables](files-and-env.md).
