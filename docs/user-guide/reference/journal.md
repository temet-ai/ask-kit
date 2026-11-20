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
| `noData` | boolean | The domain provides a capability and its answer ended with the line `[no data]`: it held nothing for the question. The line is cut from the answer, and the router asks the next provider. |
| `action` | string | The kit's action that answered with no model. The row has `do` (the script), `params`, `ms` and `cells: 1`, and no backend, model or cost. See [Actions](../kits.md#actions). |
| `actionFellThrough` | object | On a model ask: `{ action, why }` for the action that matched first and fell through (`why` is `error`, `empty` or `expect`), with `turnedOff` when that run turned the action off. |
| `askId` | string | `api` asks: the investigator's REPL session is `ask-<askId>`, so `report` finds the ask's cells. |

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
| `opened` | `api` | A kit action's pattern was found inside the question, and its script ran before the first model call: `{ action, script, params, ms }`. Counted in `cells`. |
| `escalated` | `api` | The ask went to the `escalate` backend: `{ to, atMs, cells, model }`, where `atMs` is when it was handed over, `cells` how many the first backend had run and `model` the stronger backend's model. `turns`, `cells`, `usage` and `costUsd` are both backends' together; `model` stays the first backend's. When the hand-over failed: `{ to, atMs, error }`. |
| `hedge` | all | A `hedge` backend was started: `{ backend, atMs, winner }`, where `atMs` is when it started and `winner` the backend whose answer was returned. The other fields are the winner's. |
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
| `scripts` | object[] | Scripts the cell ran: `{ name, draft, ok, ms }`, plus `params` when the run had any (as a string cut at 300 characters when longer) and `error` on failure. A draft saved with `scripts.draft` appears as `{ name, draft: true, saved: true }`. |
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
| `how` | `caller`, `follow-up`, `only`, `shot`, `pattern`, `model`, `timeout`, `rules` or `fallback`. See [The `ask` tool](ask-tool.md#how-the-router-chooses-a-domain). |
| `resolvedFrom` | When capabilities sent the question to a better provider: the domain chosen first. |
| `from` | On a `fallback` record: the provider that had no data. |
| `routeMs` | Time the choice took. |
| `routeError` | When the router model failed and the fallback decided: why, cut at 160 characters. |

### Misroute record

A route the router decided itself (`how` is `pattern`, `model`, `timeout` or `rules`) is a
misroute when the same calling session asks again within two minutes with an `about` naming
another domain. A route to a capability provider that answered with no data is one too, and the
provider asked next is where it should have gone. The router writes this record to the caller's
routing file, and a row to `router/bench.jsonl`.

| Field | Meaning |
|---|---|
| `at` | ISO time of the correction. |
| `type` | `misroute`. |
| `question` | The question that was misrouted, cut at 500 characters. |
| `routed` | Where the router sent it. |
| `how` | How the router chose it. |
| `correct` | Where it should have gone: the domain the caller named, or the next provider. |
| `why` | `re-asked` or `no data`. |
| `afterMs` | For `re-asked`: time between the two asks. |

The report counts the routes the router decided and lists the misroutes.

## `ask-kit report`

```sh
ask-kit report [--since 7d] [--json]
```

`--since` takes `<n>h`, `<n>d` or a date. The default is `7d`. Any other value stops with
`--since <value>: use 24h, 7d or a date`. The command reads every journal in the state folder
(folders `warm`, `drafts`, `gallery`, `index` and `actions` are skipped), keeps records whose `ts` is in
range, and builds the sections below. The action sections read `<state>/actions/` separately.

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
| `action <name> fell through (<why>)` | The ask has `actionFellThrough`. |

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

### Action runs

From `<state>/actions/<kit>.jsonl` and `<kit>.json`: per action with runs in range, its runs,
answers, fall-throughs by why, re-asks, its last 20 runs, and `off` with the reason when it was
turned off. Shadow runs are listed with both answers.

### Worth an action

Real asks only: sessions whose id starts with `kittest-` or `bench` are left out, and so are
shots, action answers, follow-ups and failed asks. Each ask's question becomes a template:
lowercased, quoted text as `<text>`, paths as `<path>`, ids (uuids, hex of 7 or more with a
letter, words with a digit) as `<id>`, numbers as `N`, closing punctuation removed. Its cells are
those of `ask-<askId>` that ended during the ask (for older records with no `askId`, every
`ask-*` cell that ended during it). The asks are grouped by kit, template and each library script
those cells ran. A group with 2 or more asks is listed, at most ten, by summed `costUsd`, then
count times median seconds. Each shows the script and up to six param values it ran with, from
the cell record's `params` or, for older records, from the `scripts.run` call in the code.

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
| `routed` | Routes the router decided itself (`action`, `pattern`, `model`, `timeout`, `rules`) in range. |
| `misroutes` | `[{ at, question, routed, how, correct, why, journal }]`, oldest first. |
| `actionAnswers` | Asks an action answered. `noModelShare` counts them with shots; `realNoModelShare` is the same share with kit-test and benchmark sessions left out. |
| `actions` | `[{ kit, action, runs, answered, fellThrough, reasked, window, off, offAt }]`. |
| `turnedOff` | `[{ kit, action, why, at }]`. |
| `shadows` | `[{ kit, at, action, run, question, actionAnswer, modelAnswer, backend, ms, costUsd, cells }]`, oldest first. |
| `worthAnAction` | `[{ kit, template, script, n, sessions, costUsd, medianSeconds, questions, params }]`. |

The domain in the report is the first path part under the state folder. For the `code` domain it
is `code` for every repository.

To read one flagged ask, open the journal named in `journal`, find the ask by `question`, and read
the cell records of its investigator. [Find and fix a bad answer](../guides/debug-a-bad-answer.md)
walks through it.

Related: [Make it better](../tuning.md), [Files and environment variables](files-and-env.md).
