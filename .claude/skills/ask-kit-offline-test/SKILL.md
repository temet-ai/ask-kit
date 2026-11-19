---
name: ask-kit-offline-test
description: Write and prove a test for ask-kit's host code (src/, bin/ask-kit.mjs) that needs no model, no network and no real kit - a throwaway config and state, a fixture kit, a scripted OpenAI-compatible backend on 127.0.0.1, the `ask` tool driven over MCP - then check it with offline-check.sh. Use whenever you add or change a file under ask-kit's test/, need a fake backend or fixture kit, or must show an ask, a shot, a follow-up or a kit-to-kit call working without calling a model.
---

# A test for ask-kit's host with no model and no network

ask-kit's tests are plain Node scripts (`node:assert/strict`, no framework) that print `ok` and
exit 0. The whole `npm test` runs in about two seconds. A test never calls a model, the network or
a real kit; synthetic data lives only in test fixtures, with Discworld names (`Sam Vimes`,
`ankh-morpork/watch`) and hosts `example.com` or `.invalid` (CONTRIBUTING.md).

## 1. Isolate config and state before importing src/

`src/config.mjs` computes `CONFIG_DIR` and `STATE_ROOT` when it is first imported, from
`ASK_KIT_CONFIG` and `ASK_KIT_STATE`. Set both to a `fs.mkdtempSync` folder first, then load host
modules with `await import("../src/...")` (see test/kits.mjs). A static `import` of src/ at the
top runs before your assignments and reads the real `~/.config/ask-kit` with its real kits.
Pass both variables in the `env` of every server you start (test/repl.mjs).

## 2. A fixture kit

Write it into `<tmp>/config/kits/<name>/` (the host looks in `CONFIG_DIR/kits`) and name it in
`config.json`'s `domains`, as test/kits.mjs does; or keep a folder under `test/fixtures/<name>/`
your task owns and copy it there. Never point a test at `/mnt/data/projects/temet/kit/` or
`~/.config/ask-kit/kits`. A script is `scripts/<name>.mjs` with `meta` (purpose, params,
returns, example) and a default export `(globals, params)`.

## 3. A scripted backend, when the test needs an ask to run

The api backend posts OpenAI-style chat to `<baseUrl>/chat/completions` and reads
`choices[0].message` (`tool_calls` naming `repl` with `{"code": ...}`, or plain `content` as the
answer) and `usage`. `assets/fake-backend.mjs` is a 40-line server that replays steps
(`{code}`, `{answer}`, `{delayMs}`, or a function of the request body) and records every request
in `requests`; its `backend` goes straight into `config.backends.list`. A backend entry with
`preset: "ollama", model: "none"` is enough when nothing is asked (test/kits.mjs).

`assets/example-ask.test.mjs` drives the real path: the fixture kit, the fake backend, and
`src/server.mjs` started with `ASK_KIT_DOMAIN=<kit>` (no `ASK_KIT_INNER`) so it offers `ask`.
It asserts the answer, the footer `[<kit> · fake · Ns]` and that the cell ran the kit's script.
Copy what you need into your own test file and paste `fakeBackend` in, or put it in a
`test/fixtures/` helper your task owns; tests never import from `.claude/`.

To read what was journaled, the files are under `<ASK_KIT_STATE>/<domain>/`: `<ASK_KIT_SESSION>.jsonl` holds
the ask row (`"type":"ask"`) and `ask-<id>.jsonl` the investigator's cells (field list:
docs/user-guide/reference/journal.md).

## 4. End cleanly and register it

Close every MCP client and fake server you opened, then `console.log("ok"); process.exit(0);`.
An open stdio child keeps Node alive and `npm test` hangs. Add `&& node test/<name>.mjs` to the
`test` script in package.json.

## 5. Prove it

From the repository root:

```sh
bash .claude/skills/ask-kit-offline-test/scripts/offline-check.sh test/<name>.mjs
```

It fails a file that is not in `npm test`, names a real machine path or an outside host, fails
or hangs with the network cut (`unshare -rn`, loopback up), an empty `HOME` and no API keys, or
writes to the home's ask-kit config or state. Then run `npm test`. Put the check's output in
your report.
