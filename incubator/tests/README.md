# ask-kit-tests

An [ask-kit](https://github.com/temet-ai/ask-kit) kit that lets your coding agent's `ask` tool run
your project's tests, build, lint and typecheck. A cheap model runs the project's own check
commands outside your agent's context and answers with what failed: the test name, `file:line`
and the message. The log stays on disk, not in your agent's context.

It does the job people give a test-runner subagent or a "run the checks" skill:

- Do the tests pass? Which fail, and why?
- Is everything green: typecheck, lint, tests and build?
- Did my change break anything that passed in the last run?
- Is the roster test flaky, or does it fail every time?
- What did the last test run say? (answered from the saved run, with no model and no new run)

## Install

You need [ask-kit](https://github.com/temet-ai/ask-kit#set-it-up) 0.3 or later. The kit has no
dependencies of its own; it runs whatever your project's checks use (npm, pytest, cargo, go, make).

Paste this into your agent:

```
Read ~/.config/ask-kit/AGENTS.md, then add this kit: github.com/temet-ai/ask-kit-tests
```

Or run it yourself:

```sh
ask-kit kit install temet-ai/ask-kit-tests        # shows what it reads, changes and runs
ask-kit kit install temet-ai/ask-kit-tests --yes  # installs and enables it
```

Restart your agents so `ask` lists `tests`. The one setting, `WORKDIR`, is the folder whose
project is checked; it defaults to the folder your agent runs in.

## What it finds and reads

| Project | Checks it finds |
|---|---|
| `package.json` | every script, run with npm, pnpm, yarn or bun by the lockfile; `tsc --noEmit` when there is a `tsconfig.json` and no typecheck script |
| `Cargo.toml` | `cargo test`, `check`, `clippy`, `build`, `fmt --check` |
| `go.mod` | `go test ./...`, `go vet ./...`, `go build ./...` |
| `pyproject.toml`, `pytest.ini`, `tests/` | `pytest`, and `ruff`, `mypy` or `pyright` when configured; through `uv run` or `poetry run` by the lockfile |
| `Makefile`, `justfile` | targets named like a test, lint, build or check |
| `deno.json`, `mix.exs`, `Gemfile` with `spec/`, `build.gradle`, `pom.xml` | the usual test command |

It reads failures from node:test (TAP and spec), jest, vitest, pytest, cargo test and rustc, go
test and the go compiler, tsc, eslint, ruff, mypy, and any tool that prints `path:line: error:`.
For anything else it returns the lines that look like errors and the end of the log.

## What it can change

Running a check runs your project's code, as you. Without being asked for a change it runs only
the checks the project defines, and not the scripts that do not end (`dev`, `start`, `watch`) or
that change things (`deploy`, `release`, `publish`, `format`). When the caller asks for a change
(`act: true`), `checks.exec` runs any command line in the project root.

- Every run has a timeout (600 seconds unless told otherwise) and its process group is killed
  when the time is up. `CI=1` is set, so test runners do not start a watch mode. A log that
  passes 20 MB ends the run.
- The whole output goes to a log under ask-kit's state folder (`tests/<project>/`), which keeps
  the last 40 runs. The model sees the failures and the lines it asks for, at most 200 at a time.
- Lines that carry a key, token or password, and URLs with a password in them, are shown with
  the value redacted. Test output is otherwise passed on as the tool printed it.

## How well it works

`bench/questions.json` holds eight checks that run with no model against `bench/fixture/watch`, a
small project whose tests fail on purpose. `ask-kit kit test tests` on 2026-11-20, run from the
kit's folder: 8/8, all answered with no model. The readers were also run against real failing
output of node:test, vitest, jest, pytest, cargo test, go test, tsc, eslint, ruff and mypy.

No model run has been made yet: the bench has no questions from real sessions, so there is no
score for an investigator model. Windows is written for (commands run through `cmd.exe`) and not
tested.

## What is in it

`checks.mjs` finds the project's checks, runs one to the end and records the run; `parse.mjs`
reads the failures out of the output. Its scripts are `run` (one check: verdict, failures, what
changed since the run before), `all` (typecheck, lint, test and build in turn), `commands` (what
checks exist), `last` (the last run of each check, and whether the code changed since),
`failure` (one failure in full from the log) and `flaky` (one check several times: what fails
always and what fails sometimes). [RECIPE.md](RECIPE.md) says what it reads and runs, and how to
rebuild it.

MIT licence.
