# This project: how it is built and checked

- Node.js ESM, no build step. Dependencies are in package.json; `npm ci` installs them.
- The fleet's check is `for f in src/*.mjs bin/*.mjs; do node --check "$f" || exit 1; done` (syntax of every module).
- After an edit: `node --check <file>`; one test file: `node test/<name>.mjs` (prints `ok`).
- The quick gate is `npm test` (fixtures, setup, repl, kits, bundle; about a minute, no network, no model calls); the full gate is the same.
- Formatting: no formatter is configured; keep the file's existing style (two-space indent, double quotes, long lines allowed).
- Tests never call a model or the network: a fixture kit (test/fixtures/) and the REPL server run locally. Synthetic data is for fixtures only; benchmarks use the real kits' bench/questions.json.
- Real kits live outside this repo in /mnt/data/projects/temet/kit/ask-kit-<name> (linked into ~/.config/ask-kit/kits). Read them, run `ask-kit kit test <name>` against them, but never commit to them from this fleet.
- `ask-kit` on PATH is the global install, not this checkout: run this checkout as `node bin/ask-kit.mjs`.
- Never print API keys or database URLs; never write to mike's capture database.
- Commits use the noreply email 129885267+dawiddutoit@users.noreply.github.com and no Claude attribution lines.
