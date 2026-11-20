# The investigator's REPL

The REPL is a Node `vm` context that the investigator runs JavaScript cells in. It holds the
domain's globals, the toolkit helpers and the script library, keeps its variables between cells,
and writes every cell to the journal. What a cell prints goes to the investigator's model and
stays in its session. It is the inner face of `src/server.mjs`.

## Files

| File | What is in it |
|---|---|
| [src/server.mjs](https://github.com/temet-ai/ask-kit/blob/main/src/server.mjs) | `runCell`, `newContext`, `safeJson`, `snapshot`, `restoreFrom`, `mayRestore`, `refreshScripts`, the `scripts` object, `helpText`, and the `repl`, `help`, `reset` and `load` tools. |
| [src/core/rewrite.mjs](https://github.com/temet-ai/ask-kit/blob/main/src/core/rewrite.mjs) | `rewriteCell`: turns a cell into an async script whose top-level names become globals. |
| [src/core/toolkit.mjs](https://github.com/temet-ai/ask-kit/blob/main/src/core/toolkit.mjs) | The `toolkit` object: `clip`, `shape`, `pick`, `omit`, `table`, `top`, `groupBy`, `countBy`, `sumBy`, `since`, `minutes`. |
| [src/domains.mjs](https://github.com/temet-ai/ask-kit/blob/main/src/domains.mjs) | `loadDomain`: where `makeGlobals`, `scriptsDir`, `apiDoc` and `beforeCell` come from. |
| [domains/code/repo.mjs](https://github.com/temet-ai/ask-kit/blob/main/domains/code/repo.mjs) | `makeRepo`: the `repo` global (search, read, write, edit, run, git). |
| [src/transcripts/index.mjs](https://github.com/temet-ai/ask-kit/blob/main/src/transcripts/index.mjs) | `makeHistory`: the `history` global of the sessions domain. |
| [test/repl.mjs](https://github.com/temet-ai/ask-kit/blob/main/test/repl.mjs) | The REPL over MCP with no model. |

## How a server becomes a REPL

`src/server.mjs` starts as either face. With `ASK_KIT_INNER=1` it registers four tools through
`replTool`. Without it, `replTool` is a no-op and the server registers only `ask`
(see [Life of one ask](ask-lifecycle.md)).

| Tool | What it does |
|---|---|
| `repl` | Runs a cell. Inputs: `code`, `maxChars` (200 to 100000, default 4000), `timeoutSeconds` (1 to 600, default 120). |
| `help` | Returns the script list with parameters and results, the domain's `api.d.ts` and the current variables. |
| `reset` | Builds a fresh context and deletes the snapshot. Drafts and the journal stay. |
| `load` | Copies the saved variables of another session's REPL into this one, if `mayRestore` allows it. |

At start-up the server calls `loadDomain(ASK_KIT_DOMAIN)`, then `DOMAIN.makeGlobals({ push, config, act })`.
`push` is how a domain global reports each call it makes (a ripgrep run, a transcript read) so it
appears in the cell's journal entry. `act` is true only in an inner server started with
`ASK_KIT_ACT=1`, which `ask` sets when the caller asked for a change; without it `repo` and a
kit's folder sources read only and a kit's `acts` are withheld (see
[Asking for a change](../reference/ask-tool.md#asking-for-a-change-act)). `ask.kit` passes the same
`act` to the kit it asks. `newContext()` then builds the context.

## What a cell can see

`newContext` creates the context with `vm.createContext` from these names and nothing else
added on purpose:

```js
vm.createContext({
  ...GLOBALS,          // the domain's globals: repo for code, history and cite for sessions
  scripts,             // run, list, show, draft
  tk: toolkit,         // the same helpers, namespaced
  ...toolkit,          // and as plain globals
  console: { log, info, warn, error },  // captured, returned with the result
});
```

A fresh `vm` context has the JavaScript built-ins (`JSON`, `Math`, `Map`, `Promise`, `Date`) and
none of Node's: there is no `require`, `process`, `fs`, `fetch` or `import`. The investigator
reaches data and the network only through the domain's globals. `baseline` records the names
present after creation, and `userNames()` is everything added since, which is what gets
snapshotted.

The same helpers and domain globals are passed to scripts, as `({ ...GLOBALS, tk: toolkit }, params)`.

### The toolkit

`src/core/toolkit.mjs` has no state. Each helper returns data the investigator prints or keeps.

| Helper | What it returns |
|---|---|
| `shape(x, depth = 3)` | Keys, types and array lengths of a value. `safeJson` uses it to describe a clipped result. |
| `table(rows, cols, { width = 60 })` | A text table; `cols` defaults to the first row's keys; cells are cut at `width`. |
| `top(rows, key, n = 10)` | The `n` rows with the highest `key` (a field name or a function). |
| `groupBy(rows, key)` | An object of arrays. |
| `countBy(rows, key)` | Counts per key, most frequent first. |
| `sumBy(rows, key)` | A number; non-numbers count as 0. |
| `pick(rows, ...keys)`, `omit(rows, ...keys)` | Rows with only, or without, those keys. Works on one object too. |
| `clip(v, max = 400)` | A string cut with `… [+N chars]`; `null` for null or undefined. |
| `since(hours)` | An ISO time that many hours ago. |
| `minutes(ms)` | Minutes, one decimal. |

The `repl` tool description names the helpers `shape, pick, table, top, groupBy, countBy, sumBy,
since`; `omit`, `clip` and `minutes` also exist but are not in that text. A domain's own helper
(`cite` in the sessions domain) is a domain global, not part of the toolkit.

### The script library

`refreshScripts` runs before every cell and on `help`. It lists the `.mjs` files in the domain's
`scriptsDir` and in the session's drafts folder (`STATE_DIR/drafts/<session>`), builds a signature
from each file's path and mtime, and does nothing if the signature has not changed. Otherwise it
clears the `registry` and re-imports each file with `?v=<mtime>` so Node does not serve a cached
module. A script must export a default function and may export `meta` (`purpose`, `params`,
`returns`, `example`). A file that fails to load is reported in the next result as
`[scripts that failed to load: ...]`.

`scripts.run(name, params)` calls the function with `({ ...GLOBALS, tk: toolkit }, params)` and
records `{ name, draft, ok, ms }` in `cellScripts`. `scripts.draft(name, source)` writes a draft
file (name: lowercase letters, digits and dashes) that loads before the next cell.
[Add a script](../guides/add-a-script.md) covers writing one.

## How a cell runs

`runCell(code, maxChars, timeoutSeconds)` in `src/server.mjs`, in order:

1. **Queue.** The `repl` handler chains each call onto `queue`, so cells in one REPL run one at a
   time.
2. **Refresh.** `refreshScripts()`, reset `cellCalls`, `cellScripts` and `logs`, and call the
   domain's optional `beforeCell(GLOBALS)`.
3. **Rewrite.** `rewriteCell(code)` returns `{ script, declared }`.
4. **Run.** `vm.runInContext(script, context, { filename: "cell.js" })` returns a promise. It is
   raced against a timer that rejects with `cell timed out after Ns`.
5. **On error.** The first 8 lines of the stack are kept. The cell's declared names that now have
   a value are shown with `shape(value, 2)` ("What this cell's values look like"), because a model
   that guessed a result's shape tends to send the same cell again. If the code equals the last
   failed cell, the result says so.
6. **Snapshot.** `snapshot()` saves the variables (see below).
7. **Result text.** Parts joined by blank lines: a start-up note on the first cell after a restore,
   script load errors, captured `console` output (first 4000 characters), the result through
   `safeJson(value, maxChars)`, a repeat warning, a note of variables that could not be saved, and
   a closing `[<ms> ms, <n> calls]`.
8. **Journal.** One line in `STATE_DIR/<session>.jsonl`: `ts`, `session`, `ok`, `ms`, `code`,
   `declared`, `resultChars`, `repeat`, `error`, `scripts`, `calls`, `snapshot`, `restored`.

### Why the cell is rewritten

The investigator writes `const hits = await repo.rg("foo")` in one cell and uses `hits` in the
next. If the cell ran as written, inside the async function that gives it `await`, `hits` would be
local to that function and gone. `rewriteCell` in `src/core/rewrite.mjs` fixes that by parsing the
cell with acorn (`ecmaVersion: "latest"`, `allowAwaitOutsideFunction`,
`allowReturnOutsideFunction`) and editing the top-level statements as text:

| Top-level statement | Becomes |
|---|---|
| `const x = v` / `let` / `var` | `globalThis.x = (v);` |
| `const { a, b } = v` | `globalThis.a = undefined; globalThis.b = undefined; ({ a, b } = (v));` |
| `function f() {}` | `globalThis.f = (function f() {});` |
| `class C {}` | `globalThis.C = (class C {});` |
| a last expression statement | `return (expr);` |

The result is wrapped as `(async () => {\n...\n})()`. `declared` lists every name the cell
defined, which `runCell` uses for the error hints and for spotting repeats. Only top-level
statements are rewritten; a `const` inside a block, a function or a loop stays local. A `const`
becomes an assignment, so a later cell can declare the same name again without an error.

Two consequences to know:

- A cell that ends in a statement other than an expression (a `for` loop, an `if`) returns
  `undefined`. The investigator has to end with the value it wants back.
- A syntax error throws from `acorn.parse`, which `runCell` reports as the cell's error.

### Clipping a result

`safeJson(value, max)` returns strings as they are (cut at `max`), and anything else as JSON with
a replacer that prints `Map` and `Set` contents, bigints, `[Function name]` and `[Circular]`.
When the text is longer than `max`, it is cut and followed by `… [clipped: N of M chars. Shape of
the whole value: ... Keep it in a variable and return only the fields you need.]`. Every character
returned stays in the investigator's context, so `maxChars` is the main lever on cost. The API
loop in `askApi` always passes 4000.

### Repeated cells

`seenCells` keys each cell by its code with the names it declares replaced by `_` and whitespace
collapsed, so the same search under a new variable name is caught. A repeat that returns the
same result gets "Running it again finds nothing new"; a repeat with a different result gets "Use
the earlier variables".

## Timeouts

Three limits apply to a cell:

- The REPL's own `timeoutSeconds` (default 120, maximum 600).
- The API loop's value: `min(CELL_MAX_S = 60, time left - 2s)`, and the MCP call to the REPL gets
  that plus 5 seconds.
- The CLI investigators' tool timeout. Codex's config sets `mcp_servers.repl.tool_timeout_sec=180`
  (in `codexArgs`).

The timer only rejects the promise. It does not stop the code. A cell that is waiting on
something (a slow subprocess) is abandoned and the REPL moves on, but the work behind it keeps
running, and a synchronous loop that never yields blocks the whole server, since `vm.runInContext`
is called with no `timeout` option. Domain globals bound their own work: `exec` in `repo.mjs` has a
60 second timeout and a 32 MB output limit per command.

## Saved state between cells and for follow-ups

After every cell, `snapshot()` writes `STATE_DIR/<session>.snapshot`. For each name in `userNames()`:

- A function is stored as its source text (`v.toString()`) and rebuilt on restore. A function that
  uses a variable from the cell's closure loses it.
- Anything else goes through `v8.serialize`. A value that cannot be serialised (a class instance
  with a native handle, say) is dropped and named in `[not kept across restarts: ...]`.
- The total is capped at 64 MB (`SNAPSHOT_MAX_BYTES`); a variable that would go over is dropped.

The file is written to a temporary name and renamed, so a crash leaves the old snapshot. It
records the `session`, the `caller` (the asking agent's session) and `savedAt`.

On start-up the server calls `restoreFrom(SESSION)`; if that finds nothing and `ASK_KIT_INHERIT` is
set, `restoreFrom(INHERIT, { neutral: true })`. The first cell's result then begins with
`[restored N name(s) ... : a, b]`. This is what makes the three cases work:

| Case | Session id the REPL uses | What it restores |
|---|---|---|
| API follow-up | `ask-<askId>`, reused on `continue` | its own snapshot |
| Fork of a warm CLI session | the CLI's own session id (see below) | nothing of its own, so the warm session's snapshot, via `INHERIT` |
| CLI follow-up | the same CLI session id as the earlier ask | its own snapshot |

`mayRestore` decides who may read a snapshot. A snapshot made for a caller (`record.caller` set)
is restored only by a REPL started for the same caller (`ASK_KIT_CALLER`). A snapshot with no
caller is restored by the session that made it, or by a REPL started with `neutral`, which is how a
fork reads the warm session. Another asking session's REPL is refused with
`that REPL belongs to another session's ask`. Variables from one agent's investigation do not
leak into another's.

`replEnv` in `src/ask.mjs` is where these environment variables are set for the investigator's
server: `ASK_KIT_INNER`, `ASK_KIT_DOMAIN`, the domain's `childEnv()`, the `ASK_KIT_CONFIG` and
`ASK_KIT_STATE` overrides, `ASK_KIT_INHERIT` and `ASK_KIT_CALLER` (the warm session's id and the
asking session) when forking, and `ASK_KIT_SESSION` when the loop picks the id itself.

## What the investigator can do

Everything the investigator can do goes through the domain's globals:

- `code`: `makeRepo` runs `rg`, any git command and any program through `execFile` with no shell,
  in the repository, and reads, writes and edits files. Relative paths resolve against the root.
- `sessions`: `makeHistory` reads transcript files and keeps its own index under the state folder
  (`src/transcripts/common.mjs` writes it); it never writes to the transcripts, which belong to
  the agents that wrote them.
- Scripts and drafts are the exception: `scripts.draft` writes a `.mjs` file to the session's
  drafts folder, and the REPL's own snapshot and journal are written by the server, not the cell.

The `vm` module is not a security boundary. The context has no Node globals, but code that
reaches the host through an object passed in could escape it. The limits are guard rails for a
model that is trying to answer a question; don't run untrusted code in it. The CLI
investigators have a second layer of limits (see [Backends](backends.md#how-the-cli-investigators-are-limited)).

## What to look at when changing it

- A new global for the REPL: a domain's `makeGlobals`, not `server.mjs`. See
  [Domain API](../reference/domain-api.md) and [Write a domain](../guides/write-a-domain.md).
- A new toolkit helper: add it to `src/core/toolkit.mjs` and to the `toolkit` object at the bottom.
  It is also a fingerprint file, so adding one re-warms the CLI investigators. Add it to the domains'
  `api.d.ts` (the "Toolkit" section) or the investigator will not know it exists.
- A problem with a cell that "does nothing": print what `rewriteCell` returns for it. The usual
  causes are a last statement that is not an expression, or a name declared inside a block.
- Result size and clipping: `DEFAULT_MAX_CHARS`, `safeJson`, and the `maxChars` the API loop passes.
- Snapshot behaviour: `snapshot`, `restoreFrom`, `mayRestore`. A change to the record format needs
  old snapshots to still read, or to be refused cleanly.
- The text the investigator sees after each cell is part of its behaviour (the error hints, the
  repeat warnings, the clip note). Change them the way you would change instructions: run the
  benchmark ([Run the benchmark](../guides/run-the-benchmark.md)).

Tests: `test/repl.mjs` starts the inner server with a throwaway config and checks that `help` lists
the sessions scripts, that a script runs, that a variable (`r`) is still there in the next cell, and
that a restarted server restores it (`restored .*r`). It also checks the outer face lists only
`ask`. `test/fixtures.mjs` covers the transcript adapters that the `history` global reads. There is
no unit test for `rewriteCell` or the toolkit on their own; [Testing](../guides/testing.md)
says how to add one.
