# Transcripts

`src/transcripts/` reads the transcripts that coding agents already write and turns each agent's
format into one shape. The `sessions` domain gets the result as the `history` global. There is no
proxy and no database of ask-kit's own, except a small cache of session metadata.

## Files

| File | What is in it |
|---|---|
| [src/transcripts/index.mjs](https://github.com/temet-ai/ask-kit/blob/main/src/transcripts/index.mjs) | `ADAPTERS` (the five adapters by name), `listSessions(sources)` (every session without ask-kit's own investigators), `makeHistory({sources, push})` (the `history` API: `sources`, `sessions`, `session`, `events`, `usage`, `digests`, `grep`), the parsed-events cache (`parseStats`, `clearParsed`), `cite`. |
| [src/transcripts/digest.mjs](https://github.com/temet-ai/ask-kit/blob/main/src/transcripts/digest.mjs) | `buildDigest`, `topTerms` and the digest store (`index/digests.json`). |
| [src/transcripts/common.mjs](https://github.com/temet-ai/ask-kit/blob/main/src/transcripts/common.mjs) | The event shape (header comment), `indexed` (the cache), `filesMayMatch`/`fileMayMatch` (the search pre-filter), `rarestFirst`, `literalOf`, `head`, `parseLines`, `walk`, `textOf`, `titleOf`, `clip`. |
| [src/transcripts/claude-code.mjs](https://github.com/temet-ai/ask-kit/blob/main/src/transcripts/claude-code.mjs) | `adapter` for Claude Code. |
| [src/transcripts/codex.mjs](https://github.com/temet-ai/ask-kit/blob/main/src/transcripts/codex.mjs) | `adapter` for Codex. |
| [src/transcripts/copilot-cli.mjs](https://github.com/temet-ai/ask-kit/blob/main/src/transcripts/copilot-cli.mjs) | `adapter` for GitHub Copilot CLI. |
| [src/transcripts/gemini-cli.mjs](https://github.com/temet-ai/ask-kit/blob/main/src/transcripts/gemini-cli.mjs) | `adapter` for Gemini CLI. |
| [src/transcripts/opencode.mjs](https://github.com/temet-ai/ask-kit/blob/main/src/transcripts/opencode.mjs) | `adapter` for opencode. |
| [domains/sessions/api.d.ts](https://github.com/temet-ai/ask-kit/blob/main/domains/sessions/api.d.ts) | The types the investigator reads: `Session`, `Event`, `Hit`, `Window`, `history`, `cite`. Keep it in step with the adapters. |
| [test/fixtures.mjs](https://github.com/temet-ai/ask-kit/blob/main/test/fixtures.mjs) | Tests for every adapter and for `makeHistory`. |
| [test/fixtures/](https://github.com/temet-ai/ask-kit/tree/main/test/fixtures) | The made-up stores the test copies into a temporary folder. |
| [test/adapters.mjs](https://github.com/temet-ai/ask-kit/blob/main/test/adapters.mjs) | The same adapters against this machine's real transcripts (`npm run test:machine`). |

## The adapter contract

Each adapter module exports `adapter`, an object with:

| Member | Meaning |
|---|---|
| `name`, `label` | The source id (`claude-code`, `codex`, `copilot-cli`, `gemini-cli`, `opencode`) and a display name. |
| `where()` | The folder or file the adapter reads. Shown in `detect`, `doctor` and `history.sources()`. |
| `available()` | Whether the store exists on this machine. |
| `sessions()` | The sessions, as `{source, file, size, updatedAt, id, cwd, project, startedAt, title, ...}`. File-based adapters build it with `indexed()`. |
| `events(session, {usage})` | The normalised events of one session. With `usage: true` (Claude Code, Codex, Copilot CLI) it also gives a `usage` event per model call, `{req, model, tokens: {input, cacheWrite, cacheRead, output}}`, and a `req` on each tool call naming the model call that made it. `ask-kit gaps` (src/gaps.mjs) uses this; the REPL never asks for it. |
| `usage(session)` | Token counts by model. |
| `noPrefilter` | Optional. `true` when `fileMayMatch` cannot be used on the store (opencode). |

All paths come from `os.homedir()` and environment overrides. No adapter branches on the
operating system, so each store is read from the same place relative to the home folder on
Linux, macOS and Windows (`%USERPROFILE%` on Windows).

## The event shape

`common.mjs` documents it at the top:

```js
// { i, ts, role, text, tool?, toolId?, input?, ok?, model? }
// role: "user" | "assistant" | "tool_call" | "tool_result" | "system"
```

- `i` is the event's position in the session as the adapter emits it, counting from 0. It is the
  citation: `cite()` formats `codex 5ca1ab1e #42`. It is not a line number in the file.
- `user` is what the person typed. `system` is context the agent injected (instruction files,
  reminders, environment blocks). The adapters decide which is which; that is the main
  difference between them.
- `tool_call` and `tool_result` are paired by `toolId`. `ok` on a result is `false` when the
  agent reported a failure.
- `text` is always a string. For a tool call it is the arguments as JSON text; `input` holds the
  parsed arguments where the agent stores them parsed (Claude Code, Copilot, Gemini).

A session record has `source`, `id`, `cwd`, `project` (the base name of `cwd`), `title` (a
summary or the first typed prompt, clipped to 120 characters), `startedAt` and `updatedAt`.
`makeHistory` removes `file` and `size` from what the REPL sees and adds `kb`.

## The session index

Reading the first part of thousands of files on every question would be slow, so
`indexed(source, files, readMeta)` keeps the metadata. The cache is one file per source,
`STATE_ROOT/index/<source>.json`, shaped `{ "<file path>": { mtimeMs, size, meta } }`.

1. It reads the cache.
2. For each file it calls `statSync`. When `mtimeMs` and `size` equal the cached values it reuses
   `meta`. Otherwise it calls `readMeta(file)`, which reads the first 256 KB (`head()`).
3. A file whose `readMeta` throws or returns `null` is cached as `null` and left out of the
   list, until the file changes.
4. `updatedAt` is the file's modification time.
5. If anything changed, or the number of entries differs (a file was deleted), the cache is
   written to a temporary file and renamed. Write errors are ignored.

Deleting `STATE_ROOT/index/` is safe; it is rebuilt. `ask-kit detect`, `questions` and `doctor`
all call `sessions()`, so they write this cache too.

`makeHistory` adds an in-process cache of the whole session list for 30 seconds (`all()`).
`all()` also:

- skips an adapter whose `available()` is `false`;
- turns an adapter error into an `{source, error}` entry and then drops it, so a failing adapter
  looks like a source with no sessions;
- drops ask-kit's own investigator sessions, which `claude -p`, `codex exec` and `copilot -p`
  write like any other. A session is dropped when its `cwd` starts with `STATE_ROOT` or ends with
  `/warm/cwd`;
- sorts newest first by `updatedAt`.

## How `history` works

- `sessions(opts)` filters by `since` and `until` (a number of hours ago, or a date), `source`
  (one or several), `project` (a substring of the project or the `cwd`) and `cwd` (a prefix). The
  result is cut to `limit` (default 50) with `.total` holding the count before the cut. `since`
  compares against `updatedAt`, `until` against `startedAt`.
- `session(ref)` and the `ref` of `events` and `usage` accept an id, an id prefix or
  `source:id`. A prefix matching several sessions throws, unless one of them equals it exactly.
- `events(ref, {roles, from, to, maxText})` filters the parsed events of the session. The adapter
  parses a file once per version: `parsed()` in `index.mjs` keeps the parsed events in the REPL
  process, keyed by source, session id, path, mtime and size, so a later cell, a follow-up or
  `grep` over the same session parses nothing. An entry costs the length of its event texts; the
  least recently used go first above `ASK_KIT_PARSE_CACHE_MB` (default 256; `0` keeps nothing),
  and a session too big for half the cap is not kept. `parseStats` counts `parses` and `hits`.
  The result is a copy, so a caller changing it leaves the cache alone.
- `digests(refs)` returns a digest per session: title or first prompt, project, dates and the
  twelve most used terms of what the person typed (`digest.mjs`). It is built once per file
  version (path, mtime, size) and kept in `STATE_ROOT/index/digests.json`, the way `ask-kit gaps`
  keeps `index/gaps.json`; the result has `.built` and `.reused`. Deleting the file is safe.
  `find-sessions` asks for the digests of the sessions it found, not of every session.
- `grep(query, opts)` takes words (all must appear in one event, any case) or a `RegExp`. For each
  session in the window it first asks `filesMayMatch(files, needles)`, which runs one `rg -l -i -F`
  (bundled ripgrep) for the rarest needle, in its JSON-escaped form, over all candidate files, in
  batches that fit a command line. `rarestFirst` picks it: the longest, with two extra for a
  word holding a digit, dot, dash, slash or underscore; ties keep the caller's order. For words
  the needles are the words; for a `RegExp` the one needle is `literalOf(re)`, the longest plain
  run the pattern requires (outside groups and classes, at least 3 characters, none with a
  top-level `|`). With several needles, ripgrep then narrows the listed files by each further
  needle in turn, and a last ripgrep keeps the files with one raw line holding the three rarest
  needles in any order (one pattern of their six orders); a fourth needle is left to the event
  check. Reading each candidate whole in JavaScript took 20 s over 865 files; this takes about one.
  From 32 candidate sessions on, parsing is shared between search workers (`scan-worker.mjs`, up to
  four threads): a session always goes to the same worker, which keeps
  its own parse cache, and the parts are put back in order. A search over a time window reads the last 24 hours, the
  last 7 days and the rest at the same time: once the newest part is
  done, has hits and 1.5 s have passed while an older part is still running, its hits are
  returned with `.searched` and `.older`; the search carries on, and the same call again returns
  the whole window combined. Without ripgrep, with `ASK_KIT_NO_RG=1`, or when a batch fails, `fileMayMatch` runs
  on every file. A file that fails is skipped. A `RegExp` with no literal, or an adapter with
  `noPrefilter`, skips it. The result's `.prefilter` is `{needle, listed, kept}`. Otherwise the
  adapter parses the file (or the cache answers) and each event of the wanted roles is
  tested. The default roles are `user`, `assistant`, `tool_call` and `tool_result`; `system` is
  searched only when asked for.

  The result array has `total` (all matches), `complete` (`total <= max`, default 100), `scanned`
  (files parsed) and, when the 40-second budget ran out, `stoppedEarly`. The budget is checked
  after each session, newest first, so a long search loses the oldest sessions.

## Claude Code

- **Where:** `~/.claude/projects/<encoded cwd>/<session id>.jsonl`. `CLAUDE_CONFIG_DIR` replaces
  `~/.claude`. `available()` is whether the `projects` folder exists.
- **Format:** JSONL. Each line is one message part. An assistant message is split into one line
  per content block, all with the same `message.id` and the same `usage`.
- **Files read:** the `.jsonl` files directly in each project folder. `files()` does not go into
  `<session>/subagents/`.
- **Metadata** (`meta`): from the first 256 KB, `cwd` and `startedAt` from the first lines that
  have them; `title` is a `custom-title` line if present, else the first `summary` line, else the
  first user prompt that is not injected. A file with no timestamp in that range is skipped.
- **Events:** a user line whose text starts with one of the tags in `INJECTED`
  (`<command-name>`, `<system-reminder>`, `<local-command-stdout>` and others), or with `isMeta`
  set, becomes `system`; other user text becomes `user`; a `tool_result` block becomes
  `tool_result` with `ok: !is_error`. Assistant `text` blocks become `assistant`, `tool_use` blocks
  become `tool_call` with `input`. Thinking blocks and non-message lines are not read.
- **Usage:** `usage` is summed per model, counting each `message.id` once (`calls`, `input`,
  `cacheRead`, `cacheWrite`, `output`).

## Codex

- **Where:** `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-*.jsonl` and
  `$CODEX_HOME/archived_sessions/rollout-*.jsonl`; `CODEX_HOME` defaults to `~/.codex`.
  `available()` checks `sessions/`.
- **Format:** JSONL of `{timestamp, type, payload}`. The types used are `session_meta`,
  `turn_context` (gives the model), `response_item` and `event_msg`.
- **Metadata:** `id`, `cwd` and the start time from `session_meta`; the title is the first user
  message that does not start with a tag in `INJECTED` (`# AGENTS.md instructions`,
  `<environment_context>` and others). `originator` is also kept.
- **Events:** only `response_item` lines. A `message` is `assistant`, `user` (when not injected) or
  `system`. `function_call`, `custom_tool_call`, `local_shell_call` and `web_search_call` become
  `tool_call`; their `text` is the arguments string and `input` is not set. Their outputs
  (`function_call_output`, `custom_tool_call_output`) become `tool_result`. `ok` is the output's
  `success` when present, otherwise a guess: the first 200 characters must not start a line with
  `Exit code: 1-9` or `error`. A `web_search_call` has no `toolId`, so it has no paired result.
- **Usage:** the last `token_count` event holds the running total. `input` is
  `input_tokens - cached_input_tokens`; `reasoning` is added to the usual fields.

## GitHub Copilot CLI

- **Where:** `~/.copilot/session-state/<session id>/events.jsonl`; `COPILOT_HOME` replaces
  `~/.copilot`. `available()` checks `session-state/`.
- **Format:** JSONL of `{type, data, id, timestamp}`: `session.start`, `user.message`,
  `assistant.message`, `tool.execution_start`, `tool.execution_complete`,
  `session.usage_record`.
- **Metadata:** `sessionId`, `context.cwd`, `startTime` and `selectedModel` from `session.start`;
  the title is the first `user.message`. A file with no `session.start` line in its first 256 KB
  is skipped.
- **Events:** `user.message` is `user`, with no `system` filtering (Copilot does not store injected
  context as messages). An `assistant.message` with empty content is skipped. Tool start and
  complete events become `tool_call` (with `input`) and `tool_result` (`ok: success !== false`).
- **Usage:** each `session.usage_record` is one call; `premiumRequests` is the sum of its `cost`.

## Gemini CLI

- **Where:** `~/.gemini/tmp/<project hash>/chats/session-*.json`; `GEMINI_CLI_HOME` replaces
  `~/.gemini`. The adapter searches up to three folder levels under `tmp`, and `available()` is true when
  at least one such file exists.
- **Format:** one JSON document per session: `{sessionId, projectHash, startTime, messages: [...]}`
  with messages of type `user`, `gemini`, `info` or `error`, and `toolCalls` inside `gemini`
  messages.
- **Metadata:** there is no working directory in the file, so `cwd` is `null` and `project` is
  `gemini:` plus the first 8 characters of the hash. The `project` filter of `history` therefore
  matches that string. The investigator-session filter, which looks at `cwd`, never applies.
- **Events:** `user` is `user`; `gemini` gives `assistant` text, then each tool call and its result
  (`ok: status !== "error"`); `info` and `error` are `system`.
- **Usage:** from each message's `tokens` (`input`, `cached`, `output`).
- **Status:** the header comment says it is "not yet checked against a real store", so every
  field is read defensively. It is covered by a made-up fixture only, and the format has not been
  confirmed on a real install.

## opencode

- **Where:** one SQLite file, `~/.local/share/opencode/opencode.db`. `OPENCODE_DB` replaces the
  file, and `XDG_DATA_HOME` replaces `~/.local/share`. The adapter has no Windows-specific path.
- **Format:** read-only through `node:sqlite`.
  `session_v2` holds sessions (`directory`, `title`, times in milliseconds, token totals, `cost`,
  `model` as JSON); sessions with `time_archived` set are left out. `session_message` holds
  messages (`type`, `seq`, `data` as JSON).
- **Events:** a `user` message gives `user` from `data.text` or `data.content`. For an `assistant`
  message each content part is tested in turn: `reasoning` is skipped; a part with `tool`, `callID`
  or type `tool` gives a `tool_call` and, when it has output, a `tool_result`; a part with `text`
  gives `assistant`.
- **Usage:** the totals on the `session_v2` row, as one entry keyed by the model id, with
  `costUsd`.
- **Search:** `noPrefilter: true`. There are no files to scan, so a search reads the messages of
  every session in the window.
- **Status:** the tests build a database with only the columns the adapter reads. A run of
  `npm run test:machine` on 18 November 2026 against a real opencode 2.3.2 database with three
  sessions read them and found user and assistant events, and `usage` returned the model as
  `unknown` on the session it checked. Tool calls and results on a real database have not been
  checked.

## What to look at when changing it

- A transcript is read in two places: `meta` (first 256 KB, cached) and `events` (the whole file,
  not cached). A change to `meta` needs the cache cleared to be seen on files already indexed,
  because the cache key is only the file's `mtimeMs` and `size`. Delete
  `STATE_ROOT/index/<source>.json`.
- Role decisions change answers. Moving text between `user` and `system`, or dropping an event,
  changes what `grep` finds by default and what `session-digest` reports as the person's prompts.
- Keep `domains/sessions/api.d.ts` and `domains/sessions/instructions.md` in step: the
  instructions name each agent's tool names and the cite format.
- `fileMayMatch` assumes one event sits on one line of the file. That holds for JSONL. For a
  document that spans several lines (Gemini, if its files are pretty-printed) a multi-word search
  can skip a file that holds the event. Set `noPrefilter: true` on an adapter that cannot make
  that promise.
- Adapters do not catch errors in `events()`. A JSONL file with a broken line is fine
  (`parseLines` skips it), but a Gemini file that is not valid JSON makes `read()` throw inside
  `grep`, which ends that search.
- Adding an agent touches more than the adapter: `ADAPTERS` in `index.mjs`, the `Source` type in
  `api.d.ts`, `AGENTS` in `src/providers.mjs`, `TARGETS` in `src/setup/bundle.mjs`, `REGISTER` in
  `src/setup/register.mjs`, and a fixture. See [add an agent](../guides/add-an-agent.md).
- Tests: `test/fixtures.mjs` copies `test/fixtures/` into a temporary folder, points
  `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `COPILOT_HOME`, `GEMINI_CLI_HOME`, `OPENCODE_DB` and
  `ASK_KIT_STATE` there, and only then imports the adapters (they read the environment when
  called, but `STATE_ROOT` is read at import). It checks, per agent, the session id, `cwd`,
  `project`, `title`, the exact role sequence, the `ok` of paired results, and `usage`; and
  through `makeHistory` it checks the investigator-session exclusion, filters, word and
  `RegExp` search, role defaults and id-prefix lookup. Test data uses names from the Discworld
  (see `CONTRIBUTING.md`); never put a real transcript in `test/fixtures/`.
- `npm run test:machine` (`test/adapters.mjs`) asserts that every available real store yields
  sessions and a user event. It prints session titles, so do not paste its output into an issue.
