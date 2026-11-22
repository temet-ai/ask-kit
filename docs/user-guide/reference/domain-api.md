# Investigator API reference

This page lists what a program the investigator writes can reach in the REPL: the globals of the
`code` and `sessions` domains, the toolkit helpers, the `scripts` library and every ready-made
script. The investigator reads the typed form of this page, the domain's `api.d.ts`, through the
`help` tool.

Sources:
[`domains/code/api.d.ts`](https://github.com/temet-ai/ask-kit/blob/main/domains/code/api.d.ts),
[`domains/code/repo.mjs`](https://github.com/temet-ai/ask-kit/blob/main/domains/code/repo.mjs)
(`makeRepo`),
[`domains/sessions/api.d.ts`](https://github.com/temet-ai/ask-kit/blob/main/domains/sessions/api.d.ts),
[`src/transcripts/index.mjs`](https://github.com/temet-ai/ask-kit/blob/main/src/transcripts/index.mjs)
(`makeHistory`, `cite`),
[`src/core/toolkit.mjs`](https://github.com/temet-ai/ask-kit/blob/main/src/core/toolkit.mjs)
(`toolkit`) and
[`src/server.mjs`](https://github.com/temet-ai/ask-kit/blob/main/src/server.mjs) (`scripts`).

## The REPL tools

The investigator's server offers four tools. The calling agent never sees them.

| Tool | Parameters | What it does |
|---|---|---|
| `repl` | `code` (string); `maxChars` (200 to 100000, default 4000); `timeoutSeconds` (1 to 600, default 120) | Runs JavaScript in a persistent context with top-level `await`. Top-level `const`, `let`, `var`, `function` and `class` become session globals. The last expression's value comes back: a string as it is, anything else as JSON, clipped to `maxChars` with the shape of the whole value. |
| `help` | none | The scripts with their parameters, the typed API of the domain and the session's variables. |
| `reset` | none | Clears the session's variables and snapshot. Drafts and the journal stay. |
| `load` | `sessionId` (string) | Copies the saved variables of an earlier investigation for the same asking session into this one. |

After the value, a cell's output has a line `[<ms> ms, <n> call(s)]`, and console output, load
errors of scripts and repeat-cell warnings in front of it. [The REPL](../internals/repl.md)
describes snapshots, restore and the repeat-cell guard.

## Globals in every domain

| Global | What it is |
|---|---|
| `scripts` | The script library. See [`scripts`](#scripts). |
| `tk` | The toolkit as one object. |
| the toolkit functions | `clip`, `shape`, `pick`, `omit`, `table`, `top`, `groupBy`, `countBy`, `sumBy`, `since`, `minutes`, also as plain globals. |
| `console` | `log`, `info`, `warn` and `error` are captured and shown ahead of the result (at most 4000 characters). |
| the domain's own globals | `repo` for `code`; `history` and `cite` for `sessions`. |

A script gets the domain's globals and `tk`. It does not get `scripts` or the bare toolkit
functions, so it calls `tk.table(...)`.

## Toolkit

All functions are pure. `rows` is an array of objects unless noted.

| Function | Returns |
|---|---|
| `clip(v, max = 400)` | `null` for `null` or `undefined`; a string cut to `max` characters with `… [+N chars]`; any other value as it is. |
| `shape(x, depth = 3)` | The keys, types and array lengths of a value, a few levels deep: `"string(12)"`, `["array(40)", {...first item...}]`. |
| `pick(rows, ...keys)` | The rows (or one object) reduced to those keys. |
| `omit(rows, ...keys)` | The rows (or one object) without those keys. |
| `table(rows, cols, { width = 60 })` | A compact text table. `cols` defaults to the first row's keys. Cells are cut at `width`. `"(no rows)"` for an empty list. |
| `top(rows, key, n = 10)` | The `n` rows with the largest `key` (a field name or a function returning a number). |
| `groupBy(rows, key)` | An object of arrays, grouped by a field or by a function. |
| `countBy(rows, key)` | An object of counts, largest first. |
| `sumBy(rows, key)` | The sum of a field or function over the rows; non-numbers count as 0. |
| `since(hours)` | The ISO time `hours` ago. |
| `minutes(ms)` | Milliseconds as minutes, rounded to one decimal. |

`api.d.ts` of each built-in domain declares only some of these (see the
[notes at the end](#differences-between-the-code-and-the-api-files)); all of them work.

## `scripts`

| Member | What it does |
|---|---|
| `scripts.list()` | `[{ name, purpose, params, returns, draft }]` for the library and this session's drafts. |
| `scripts.show(name)` | The script's source. |
| `scripts.run(name, params = {})` | Runs a script with the domain's globals and `tk`, and returns its value. A script that throws fails the cell, and the failure is journaled with the script's name. |
| `scripts.draft(name, source)` | Saves `source` as a draft script for this investigation, in the state folder. `name` is lowercase letters, digits and dashes. It loads before the next cell, so run it in a new cell. Returns `{ name, file, note }`. |

The library is the `scripts/` folder of the domain, one `.mjs` file per script, and the name is
the file name without `.mjs`. A draft with the same name replaces the library script for that
session. A file that fails to load (no default export function, a syntax error) is listed in the
next cell's output as `[scripts that failed to load: ...]`. The library reloads when a file's
modification time changes. [Add a script to a domain](../guides/add-a-script.md) shows how to
write one.

A script file exports:

| Export | Type | Used for |
|---|---|---|
| `meta` | object | `purpose` (string), `params` (name to description), `returns` (string), `example` (string, optional). `help` prints them. Missing fields print as empty. |
| `default` | `async function (globals, params)` | The script. `globals` holds the domain's globals plus `tk`. `params` is the object given to `scripts.run`. |

## The `code` domain

Global `repo`, a client for one repository: search, read, write, edit, run and git. The repository is the git top level of
`ASK_KIT_CODE_ROOT`, or of the directory the server started in when that variable is not set. If
that is not a git checkout, it is the directory itself. Relative paths resolve against the root,
and paths in results are relative to it (absolute when outside it).

| Member | Signature and behaviour |
|---|---|
| `repo.root` | Absolute path of the repository (symlinks resolved). |
| `repo.rg(pattern, o)` | Runs ripgrep with `--json`, lines cut at 300 columns. `pattern` is a regex. Options: `fixed` (literal), `ignoreCase`, `word`, `context` (lines around each match), `glob` (string or array), `type` (ripgrep type, string or array), `path` (folder inside the repository; one that git ignores, such as `node_modules/some-package`, is searched all the same), `hidden`, `max` (default 200). Returns `[{ file, line, text, context? }]` with `.total` (matches, context lines excluded) and `.complete` (`total <= max`). Context lines have `context: true`. |
| `repo.files(glob, o)` | The files ripgrep would search (`rg --files`), sorted. Options: `path` (a folder git ignores is listed all the same), `hidden`, `max` (default 2000). Returns paths with `.total` and `.complete`. |
| `repo.read(file, { from, to })` | Lines `from` to `to`, 1-based and inclusive, at most 400 lines (`to` defaults to `from + 399`). Returns `{ file, from, to, lines, text }`; `text` has each line as `N<tab>line`, and `lines` is the file's length. |
| `repo.git(sub, ...args)` | Runs `git --no-pager -c core.pager=cat <sub> <args>` in the root and returns stdout; any subcommand with `act`, else only those that read (`READ_GIT` in `repo.mjs`: `log`, `show`, `diff`, `blame`, `status`, `ls-files`, `grep` and a few more, without `--output`). Throws on a non-zero exit. |
| `repo.write(file, text)` | Writes the whole file, creating its folders. Returns `{ file, bytes }`. |
| `repo.edit(file, from, to, { all })` | Replaces `from` with `to`. Without `all`, the text must occur exactly once; it throws when it is missing or occurs more often. Returns `{ file, replaced }`. |
| `repo.run(cmd, ...args)` | Runs any program in the root without a shell (120 second timeout). Returns `{ code, out, err }`; never throws on a non-zero exit. |

`write`, `edit` and `run` work only in an ask whose caller asked for a change (`act`, see
[Asking for a change](ask-tool.md#asking-for-a-change-act)); otherwise they throw
`repo.write is off in this ask: ...`.

ripgrep is the system's `rg` when there is one, else the copy that came with `@vscode/ripgrep`.
Each command runs without a shell, with a 60 second timeout and 32 MB of output.
ripgrep respects `.gitignore`.

Each call is reported to the journal as `{ kind, detail, ms, size }`.

## The `sessions` domain

### `history`

One API over every enabled source. `Window` options, used by `sessions` and `grep`:

| Option | Type | Meaning |
|---|---|---|
| `since` | number or string | A number is hours ago. A string is an ISO date. Keeps sessions updated at or after it. |
| `until` | number or string | Same forms. Keeps sessions started at or before it. |
| `source` | string or string[] | One or more of `claude-code`, `codex`, `copilot-cli`, `gemini-cli`, `opencode`. |
| `project` | string | Substring of the project name or the working directory, any case. |
| `cwd` | string | Prefix of the working directory. |

| Method | Behaviour |
|---|---|
| `history.sources()` | `[{ name, label, where, available }]` for the sources the config enables. |
| `history.sessions({ ...Window, limit })` | Sessions, newest first, default `limit` 50. Returns the sessions with `.total`, the count before the limit. |
| `history.session(ref)` | One session. `ref` is an id, an id prefix, `<source>:<id>` or a session object. An ambiguous prefix throws `matches N sessions; give more of the id`; none throws `no session <ref>`. |
| `history.events(ref, { roles, from, to, maxText })` | The session's events. `roles` is a role or an array; `from` and `to` bound the event number `i`; `maxText` clips each `text` and drops `input`. Returns the events with `.total` (count before filters) and `.session`. |
| `history.usage(ref)` | Tokens by model, as the agent recorded them. See [Usage shapes](#usage-shapes). |
| `history.grep(query, o)` | Search events. `query` is words (all must appear in one event, any case) or a `RegExp`. Options: a `Window`, `session` (search only this one), `roles` (default `user`, `assistant`, `tool_call`, `tool_result`), `max` (hits kept, default 100), `snippet` (characters per snippet, default 300), `budgetMs` (default 40000). A slow search over a time window answers from its newest sessions first: `.searched` names what it covers (the last 24 hours or 7 days), `.older` says the rest is still being read, and the same call again returns the whole window. Returns hits with `.total`, `.complete`, `.scanned` (sessions searched), `.prefilter` (`{needle, listed, kept}`: the word or RegExp literal files were pre-filtered on) and, on a timeout, `.stoppedEarly`. |
| `history.digests(refs)` | A digest per session (`{title, firstPrompt, project, startedAt, updatedAt, prompts, terms}`), built once per file version and kept on disk. `refs` are sessions or `{source, id}`. Returns the digests with `.built` and `.reused`. |
| `cite(x)` | `"<source> <first 8 chars of the session id> #<i>"` from a hit or from `{ source, session or id, i }`. |

The list of all sessions is cached for 30 seconds. ask-kit's own investigator sessions (working
directory in the state folder or ending `/warm/cwd`) are left out.

A **Session**:

| Field | Meaning |
|---|---|
| `source`, `id` | The agent and its own session id. |
| `cwd`, `project` | Where it ran, and the last folder name of that (null where the agent does not record it; Gemini CLI uses `gemini:<hash prefix>` as the project). |
| `title` | The summary or first prompt, clipped to 120 characters. |
| `startedAt`, `updatedAt` | ISO times. `updatedAt` is the file's last write. |
| `kb` | Size of the transcript file in KB (not for opencode). |
| extra | Some sources add one: `originator` (Codex), `model` (Copilot CLI, opencode). |

An **Event**:

| Field | Meaning |
|---|---|
| `i` | Position in the session. It is the citation. |
| `ts` | Time, when the agent records one. |
| `role` | `user` (typed by the person), `assistant`, `tool_call`, `tool_result`, `system` (context the agent injected). |
| `text` | The text. For a `tool_call` it is the arguments as JSON. |
| `tool`, `toolId` | The tool's name; the id pairing a call with its result. |
| `input` | A `tool_call`'s parsed arguments, where the agent stores them parsed. |
| `ok` | A `tool_result`: `false` when the tool reported failure. |
| `model` | The model, on assistant text and tool calls where known. |

A **Hit** has `source`, `session`, `project`, `title`, `i`, `ts`, `role`, `tool` and `snippet`.
The snippet starts 120 characters before the first match.

#### Usage shapes

| Source | Fields per model |
|---|---|
| `claude-code` | `calls`, `input`, `cacheRead`, `cacheWrite`, `output` |
| `codex` | `input`, `cacheRead`, `cacheWrite` (always 0), `output`, `reasoning` |
| `copilot-cli` | `calls`, `input`, `cacheRead`, `cacheWrite`, `output`, `premiumRequests` |
| `gemini-cli` | `calls`, `input`, `cacheRead`, `cacheWrite` (always 0), `output` |
| `opencode` | `input`, `output`, `cacheRead`, `cacheWrite`, `costUsd` |

How each source's files become events is in [Transcripts](../internals/transcripts.md).

## Ready-made scripts

Every script is a file in the domain's `scripts/` folder. Defaults below are the ones in the code.
All results are plain data. A required parameter that is missing throws an error naming the
script.

### `code` scripts

| Script | Parameters | Returns |
|---|---|---|
| [`where`](https://github.com/temet-ai/ask-kit/blob/main/domains/code/scripts/where.mjs) | `name` (required): an identifier or words, searched under every spelling (`fooBar`, `FooBar`, `foo_bar`, `FOO_BAR`, `foo-bar`, `foobar`); `path`: folder; `uses`: usage lines returned, default 25 | `{ spellings, definitions: [{file,line,text}] (at most 40), usesTotal, usesComplete, usesByFile: [{file,count}] (top 20), uses: [{file,line,text}] }` |
| [`knobs`](https://github.com/temet-ai/ask-kit/blob/main/domains/code/scripts/knobs.mjs) | `topic` (required): words, at least one longer than two letters that is not a stop word; `path`; `max`: hits per kind, default 25 | `{ words, envReads, cliFlags, constants, configFiles, settingsFields, scanned, complete, checked }`, each list holding `{file,line,text}` and `checked` naming what was looked at. Words are shortened to stems so `embedding` also finds `EMBED_`. Markdown and test files are left out. |
| [`history`](https://github.com/temet-ai/ask-kit/blob/main/domains/code/scripts/history.mjs) | `term`: text added or removed in a diff (`git log -S`); `path`: file or folder; `limit`: default 15; `regex`: `true` makes `term` a regex (`-G`). One of `term` or `path` is required. | `{ commits: [{sha,date,author,subject}], complete }`, newest first |
| [`outline`](https://github.com/temet-ai/ask-kit/blob/main/domains/code/scripts/outline.mjs) | `path` (required): file or folder; `max`: default 120 | `{ path, files, definitions: [{file,line,text}], complete }`: top-level definitions in Rust, TypeScript, JavaScript, Python, Go and SQL, and markdown headings |
| [`overview`](https://github.com/temet-ai/ask-kit/blob/main/domains/code/scripts/overview.mjs) | `depth`: folder depth counted, default 2 | `{ root, files, dirs: [{dir,files}] (top 40), docs: [{file,headings}] (README, AGENTS.md, CLAUDE.md and `docs/` architecture files, at most 8), manifests (at most 30), recent: [8 commit lines] }` |

The code scripts leave out `node_modules`, `target`, `dist`, `build`, `.git`, `vendor`, lock
files, minified files, source maps, `.sqlx` and snapshot files unless the investigator searches
for them directly. The list is `NOISE` in
[`domains/code/lib.mjs`](https://github.com/temet-ai/ask-kit/blob/main/domains/code/lib.mjs).

### `sessions` scripts

| Script | Parameters | Returns |
|---|---|---|
| [`find-sessions`](https://github.com/temet-ai/ask-kit/blob/main/domains/sessions/scripts/find-sessions.mjs) | `topic` (required): a few distinctive words; `hours`: window, default 720 (30 days); `project`; `source`; `tools`: also search tool calls and results, default `false`; `any`: see the note below | `{ query, total, complete, sessions: [{ source, id, project, title, startedAt, hits, userHits, score, digest: {terms, firstPrompt, startedAt, updatedAt}, first: {i, role, snippet} }] }`, at most 15 sessions, ranked by `score`: `userHits * 3 + hits` (at most 20) plus, for each topic word, 6 when the title or first prompt holds it, 3 when it is one of the session's top terms and 2 when the project name holds it. When no event holds every word it searches the two longest words, then each word alone, and `query` says which. `startedAt` is the time of the session's first hit. |
| [`grep`](https://github.com/temet-ai/ask-kit/blob/main/domains/sessions/scripts/grep.mjs) | `query`: words; `regex`: a regex source, case-insensitive, instead of words (one of the two is required); `hours`: default 720; `session`: one session (then no time window); `project`; `source`; `roles`; `max`: default 40 | `{ window, total, complete, scanned, stoppedEarly?, hits: [{source,session,project,i,ts,role,tool,snippet}] }`. `window` says the period searched (`{ since: "YYYY-MM-DD" }` or `{ session }`), so an answer that counts things names its period. Snippets are cut at 240 characters. |
| [`recent`](https://github.com/temet-ai/ask-kit/blob/main/domains/sessions/scripts/recent.mjs) | `hours`: default 24; `project`; `source`; `limit`: default 30 | `{ total, bySource: {source: n}, sessions: [{source,id,project,title,startedAt,updatedAt}] }` |
| [`session-digest`](https://github.com/temet-ai/ask-kit/blob/main/domains/sessions/scripts/session-digest.mjs) | `session` (required): id or prefix; `from`, `to`: event range; `focus`: keep only replies holding this word (every prompt stays); `reply`: characters kept per reply, default 500 | `{ session: {source,id,project,title,startedAt,updatedAt}, events, prompts: [{i,ts,text}] (text cut at 800), replies: [{i,text}], tools: {name: {calls, failed}} }`. More than 40 replies become the first 10, `{ skipped: n }` and the last 20. |
| [`session-tools`](https://github.com/temet-ai/ask-kit/blob/main/domains/sessions/scripts/session-tools.mjs) | `session` (required); `tool`: only tools whose name holds this text; `failedOnly`: default `false`; `max`: default 60 | `{ session, source, counts: {tool: {calls, failed}}, usage, calls: [{i, tool, input, ok, error?}], more }`. `ok` is `null` when no result was found. `input` is cut at 200 characters. |
| [`session-changes`](https://github.com/temet-ai/ask-kit/blob/main/domains/sessions/scripts/session-changes.mjs) | `session` (required) | `{ session, source, files: [{path, edits, tools, firstI, lastI}], shellWrites: [{i, text}] }`. Files come from edit-style tool calls (names starting `edit`, `write`, `multiedit`, `notebookedit`, `apply_patch`, `create`, `str_replace`, `insert`, `write_file`, `replace`, `patch`) and from `*** Update File:` lines of patches. `shellWrites` (at most 20) are shell commands that look like writes. |

`find-sessions` with `any: true` skips the search for all words in one event. With one word it
therefore returns no sessions; with two words it searches each word alone; with three or more it
searches the two longest words together first.

## Differences between the code and the API files

The API files are what the investigator reads, so a function that is missing from one is a
function the investigator does not know about. Today:

- `domains/code/api.d.ts` does not declare `omit`, `sumBy`, `since` or `minutes`.
- `domains/sessions/api.d.ts` does not declare `omit` or `minutes`.
- `scripts.draft` is declared as returning `{ name, file }`; it also returns `note`.

Related: [Write a domain](../guides/write-a-domain.md), [Domains](../domains.md),
[The `ask` tool](ask-tool.md).
