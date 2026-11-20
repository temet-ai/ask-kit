# Recipe: the tests kit

## What it answers

Whether a project's tests, build, lint and typecheck pass, which tests fail and why (name, file,
line, message), whether a failure is new since the last run, whether a test is flaky, and what
the last run said. With `act`, it runs any other command in the project.

## What it needs

- ask-kit 0.3 or later (`min_ask_kit = "0.3.0"`).
- The programs the project's own checks use. The kit has none of its own.
- One setting, `WORKDIR`, detected as the folder the agent runs in.

## What it reads and runs

It reads `package.json`, `Cargo.toml`, `go.mod`, `pyproject.toml`, `Makefile`, `justfile` and a
few lockfile names, in the nearest folder at or above `WORKDIR` that has one, to find the checks.
It runs the check asked for (no shell, each argument separate; through `cmd.exe` on Windows),
with `CI=1`, `NO_COLOR=1` and a timeout, in its own process group, with stdout and stderr in a
log file under `<ask-kit state>/tests/<project>/`. It runs `git rev-parse --short HEAD` and
`git status --porcelain` to record the state a run saw. `runs.jsonl` there holds the last 40
runs with their failures.

Not run as a check: scripts that do not end (`dev`, `start`, `serve`, `watch`, `preview`) or that
change things (`deploy`, `release`, `publish`, `migrate`, `clean`, `install`, `format`, names
ending in `:fix` or `:write`). `checks.exec`, which runs any command line, exists only with `act`.

Returned lines have keys, tokens, passwords and URL passwords redacted.

## Brief to rebuild it from an empty folder

Make a folder with `ask-kit.toml` (id `temet.tests`, name `tests`, `says`, `keywords`,
`route_hint`, `cite`, `state_key = "${WORKDIR}"`, `acts = ["checks.exec"]`, a `WORKDIR` setting
whose `detect` prints the current folder, one `[[sources]]` of kind `module`, name `checks`,
module `checks.mjs`, api `api.d.ts`, and two `[[actions]]`: `commands` for "how do I run the
tests" and `last` for "what did the last test run say") and `instructions = "instructions.md"`.

`parse.mjs` exports `parse(text)` returning `{failures:[{name, file, line, message}], counts,
errorLines}`. It strips ANSI codes and runs one reader per format over the lines: TAP (`not ok`
with its YAML block; the line comes from the first stack frame in the project's own code, else
from `location`; a wrapper with `failureType: subtestsFailed` is skipped), the node:test spec
reporter's "failing tests:" section, jest (`● suite › test` blocks), vitest (`FAIL file > suite >
test` blocks), pytest (the `FAILED path::test - message` summary, with lines from the test's
section), cargo test (`---- name stdout ----` with `panicked at`, cut at the backtrace) and
rustc (`error[E...]` with its `-->` line), go test (`--- FAIL:` with its indented lines; a parent
of failing subtests is skipped) and the go compiler, and diagnostics in the forms tsc, mypy, ruff,
eslint and gcc print. Counts come from each tool's summary line. The same failure from two
readers is kept once. `keyOf(failure)` is its identity across runs: file and name.

`checks.mjs` exports `make({settings, push, act})` returning the `checks` global bound to the
project at or above `WORKDIR`: `project()`, `at(dir)` (the same API for another folder),
`commands()` (the detection above; `runnable: false` with `why` for scripts that do not end or
that change things), `run(name, {args, timeoutS, max})` (spawn, log to a file, kill the process
group on timeout or a 20 MB log, parse, record, compare with the last unfiltered run of the same
check: `newFailures`, `fixed`, `stillFailing`; `fixed` is left out when the run failed before any
test passed), `runs()`, `last(nameOrId)`, `log(id, {grep, around, start, lines})` and `exec(cmd)`
(built only with `act`). Every run carries a one-line `verdict`.

Scripts in `scripts/` (each `export const meta = {purpose, params, returns, example}` and
`export default async function ({checks}, params)`; each takes `dir` for another folder): `run`,
`all` (one command of each kind in the order typecheck, lint, test, build), `commands`, `last`
(adds each run's age and whether HEAD moved since), `failure` (the newest of the last runs whose
log holds the text, with the lines around it), `flaky` (a check 2 to 10 times: failures in every
run and failures in some).

`instructions.md` has the docker kit's structure: how to work (scripts first; a question about
passing is answered by running now; filters; the verdict comes from the exit code; never fix the
code; never run a slow check twice for the same result) and the answer format (result first,
then failures as test name, `path:line` and message).

`bench/fixture/watch` is a small npm project with node:test tests, two of which fail on purpose,
a test that fails every second run, a stand-in linter that prints two errors, and `dev` and
`deploy` scripts that must not run. `bench/questions.json` holds `do` questions against it.

## Bench

Run it from the kit's folder, because the fixture path is relative: `ask-kit kit test tests`.
All eight questions are shots (`do`), so the bench calls no model and costs nothing. Questions
for a model (`q`) are still to be added from real sessions: the times an agent ran a project's
tests by hand and read the output. `ask` with the sessions kit can list them.

## Results

ask-kit `kit test` on 2026-11-20: 8/8, all answered with no model. No model run yet.
