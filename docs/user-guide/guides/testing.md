# Run and write tests

ask-kit's tests are plain Node scripts that exit non-zero when an assertion fails. They use
`node:assert/strict` and no test framework, they need no model and no network, and they run in
about two seconds.

Source: [`package.json`](https://github.com/temet-ai/ask-kit/blob/main/package.json) (`scripts`),
[`test/`](https://github.com/temet-ai/ask-kit/tree/main/test) and
[`.github/workflows/ci.yml`](https://github.com/temet-ai/ask-kit/blob/main/.github/workflows/ci.yml).

## Run them

You need Node 26. From the repository root:

```sh
npm ci
npm test                  # the four checks CI runs
npm run test:machine      # this machine's real transcripts; not run in CI
```

Each check prints `ok` when it passes. `npm test` runs these in order and stops at the first
failure:

```sh
node test/fixtures.mjs && node test/setup.mjs && node test/repl.mjs && node test/bundle.mjs
```

To run one check, run its file: `node test/setup.mjs`.

## What each file covers

| File | Covers |
|---|---|
| [`test/fixtures.mjs`](https://github.com/temet-ai/ask-kit/blob/main/test/fixtures.mjs) | The transcript adapters, against made-up stores. For each of Claude Code, Codex, Copilot CLI, Gemini CLI and opencode: the session is found, and its `cwd`, `project` and `title` are read (and `model`, for opencode); events come out in the right roles and order, with `i` equal to position; every tool call has exactly one result with the same `toolId`, after it, with `ok` set correctly; `usage` matches the file's totals (Claude Code counts a message split over two lines once; Codex takes the last running total). Then `makeHistory` over all five: the investigator's own session (working directory ending `/warm/cwd`) is left out, even by id; filters by `source` and `project`; `grep` needs all words in one event, takes a `RegExp`, respects `roles`, searches every source including the ones with no file pre-filter; id prefixes resolve, and an ambiguous or unknown one throws. |
| [`test/setup.mjs`](https://github.com/temet-ai/ask-kit/blob/main/test/setup.mjs) | Setup without touching the machine. With a made-up detection result (Codex and Copilot present, no API key, Ollama running) it checks the question ids and suggested answers, that embedding models are not offered as investigators, `backendName`, that an API choice with no key throws, and `plan()`. It then runs `apply()` twice into throwaway folders: the config is written without the pasted key, `keys.env` has the key and (not on Windows) mode `0600`, there is exactly one `[mcp_servers.ask]` block in Codex's `config.toml` with `tool_timeout_sec = 600`, the user's other servers are kept, and Copilot's `mcp-config.json` has the `ask` server. |
| [`test/repl.mjs`](https://github.com/temet-ai/ask-kit/blob/main/test/repl.mjs) | The server over MCP with no model. The investigator face offers exactly `help`, `load`, `repl` and `reset`; `help` lists the sessions scripts; a cell runs a script and a variable survives into the next cell; a restarted server restores it from the snapshot (`restored ... r`); the calling face offers only `ask`. |
| [`test/bundle.mjs`](https://github.com/temet-ai/ask-kit/blob/main/test/bundle.mjs) | The bundle installer against throwaway agent homes. Every agent present gets its skills, tuner agent and rule in its own format (Copilot drops the `model` line; opencode gets `mode: subagent`; Copilot's rule has its front matter); an absent agent (Gemini here) gets nothing; a reinstall changes nothing and rule blocks are replaced in place, not added twice; a file you edited, or one that was never ask-kit's, is kept; `uninstall` removes only what ask-kit wrote and leaves your own text in `AGENTS.md`; the guide is written with this machine's paths. |
| [`test/code-map.mjs`](https://github.com/temet-ai/ask-kit/blob/main/test/code-map.mjs) | The code map on a made-up repository in six languages (`test/fixtures/code-map/`, plus a generated file over 1 MB): what the lexer blanks and what each language's definitions, spans and relations are; that every line ripgrep finds for a name is a definition, a use or a row from the files the map does not cover, including a call after a regular expression with a quote in it; callers through two levels, implementations (a Rust impl, a Go method set, TypeScript `implements`, Python and JavaScript bases), writers (an assignment, a struct literal, SQL in a Rust string); a second session and a second worktree reuse the stored map; an edit is read again alone and a commit rereads only what it changed; `STALE` and `PARTIAL`; lookup with the map and without it. |
| [`test/warm.mjs`](https://github.com/temet-ai/ask-kit/blob/main/test/warm.mjs) | Warm-ups: a kit's `[warm]` is checked and its `prime` used; `warmups` lists the code domain's and each enabled kit's; `ask-kit warm` runs them and builds the code map; the plugin's async SessionStart hook prints one line of hook JSON with the notices, and nothing outside git or before setup. |
| [`test/adapters.mjs`](https://github.com/temet-ai/ask-kit/blob/main/test/adapters.mjs) | The adapters against this machine's real transcripts (`test:machine`). For every store that exists: it lists sessions, reads the newest sessions' events and usage, and runs one search. It fails when a store exists but yields no sessions, or none of the five newest has a user event. It prints `skip` and exits 0 when the machine has no store. |

What the tests do not cover: `src/ask.mjs` (the four backends and the loop), `src/router.mjs`,
`src/report.mjs`, `src/gallery.mjs`, `bin/ask-kit.mjs` and the domains' scripts and `repo.mjs`.
Check those by running the real thing: `ask-kit ask`, the [benchmark](run-the-benchmark.md), and
`ask-kit report`.

## How the tests stay off your machine

Every test builds a temporary folder with `fs.mkdtempSync(path.join(os.tmpdir(), ...))`, sets the
environment variables that move ask-kit's and each agent's folders into it, and only then imports
the code, which reads those variables when it loads.

| Variable set by the tests | Moves |
|---|---|
| `ASK_KIT_CONFIG`, `ASK_KIT_STATE` | ask-kit's config and state folders |
| `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `COPILOT_HOME`, `GEMINI_CLI_HOME`, `XDG_CONFIG_HOME` | each agent's folders (`bundle.mjs`, `setup.mjs`, `fixtures.mjs`) |
| `OPENCODE_DB` | opencode's database (`fixtures.mjs`) |

Keep this order in a new test: set the variables, then `await import(...)`. A static `import` at
the top would read the real folders. [Files and environment variables](../reference/files-and-env.md)
lists every variable.

`test/repl.mjs` starts real child servers, with `ASK_KIT_CONFIG` and `ASK_KIT_STATE` in their
environment and a config whose only backend is an Ollama entry that is never called.

## Fixtures

The fixtures are made-up transcripts in
[`test/fixtures/`](https://github.com/temet-ai/ask-kit/tree/main/test/fixtures), one folder per
agent, in the agent's own layout:

| Path | Format |
|---|---|
| `claude-code/projects/-work-shop-api/cc-0001.jsonl`, `cc-warm.jsonl` | Claude Code JSONL. `cc-warm` is an investigator session, which the sessions domain must leave out. |
| `codex/sessions/2026/11/17/rollout-...-cx-0001.jsonl` | Codex rollout. |
| `copilot-cli/session-state/cp-0001/events.jsonl` | Copilot CLI events. |
| `gemini-cli/tmp/<hash>/chats/session-...-gm0001.json` | Gemini CLI, one JSON document. |

There is no opencode file: its SQLite database is built in `test/fixtures.mjs` with `node:sqlite`,
with the columns the adapter reads, one archived session that must be skipped and one that must be
listed.

The fixtures hold two placeholders. `__CWD__` becomes a real path on the system running the test
(`<tmp>/work/shop-api`), JSON-escaped, so a Windows path works. `__WARM__` becomes a working
directory ending `/warm/cwd`, which is how the sessions domain recognises its own investigators.
The adapters read the working directory as it is written, so the test copies the fixtures to the
temporary folder with the replacement applied.

Rules for fixtures
([CONTRIBUTING](https://github.com/temet-ai/ask-kit/blob/main/CONTRIBUTING.md)):

- Names are made up. New ones come from Terry Pratchett's Discworld (`Sam Vimes`,
  `ankh-morpork/watch`, `WATCH-12`); the existing ones use `shop-api`. Hosts are `example.com` or
  `.invalid`.
- A real transcript never enters the repository. Write a synthetic file with the same structure.

## Write a test

1. Put the data under `test/fixtures/` if it is a file, or build it in the test, as opencode's
   database is.
2. Follow the pattern of the nearest test: temporary folder, environment variables, then dynamic
   imports.
3. Assert the specific values the code must produce, as `test/fixtures.mjs` does with roles,
   citations and usage totals. A test that only checks "no error" would pass on an empty result.
4. If it needs a new file, add it to `package.json`'s `test` script and to `ci.yml`. They list the
   four checks separately.
5. Run it on its own, then `npm test`.

A change to what a new agent's adapter reads comes with a fixture and a block in `test/fixtures.mjs`
([Support a new coding agent](add-an-agent.md)). A change to a registration comes with an
assertion in `test/setup.mjs`. A change to `bundle/` comes with one in `test/bundle.mjs`.

## CI

[`.github/workflows/ci.yml`](https://github.com/temet-ai/ask-kit/blob/main/.github/workflows/ci.yml)
runs on every push and pull request:

| Setting | Value |
|---|---|
| Systems | `ubuntu-latest`, `macos-latest` |
| Node | 26.x |
| Matrix | two jobs; `fail-fast: false`, so one failing job does not stop the others |
| Steps | `actions/checkout@v7`, `actions/setup-node@v7` with the npm cache, `npm ci`, then `npm test` |

CI does not run `test:machine`, because
it needs real transcripts, and does not lint or type-check.

Failures that appear on one system only are usually paths (backslashes in JSON, a temporary folder
behind a symlink: the tests call `fs.realpathSync` on it), file modes or shims (`claude`, `codex` and `copilot` as `.cmd` files, handled in
`src/platform.mjs`). CI does not run on Windows; the Windows paths in the code are kept but untested.

After you change a dependency, regenerate the notices:
`node scripts/notices.mjs > THIRD-PARTY-NOTICES.md`.

## Related

- [Contributing](https://github.com/temet-ai/ask-kit/blob/main/CONTRIBUTING.md)
- [Support a new coding agent](add-an-agent.md)
- [Run the benchmark](run-the-benchmark.md)
