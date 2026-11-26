---
name: ask-kit-domain
description: Add something new for ask-kit's `ask` to answer about - install a kit someone shared (a GitHub repo with the topic ask-kit or ask-kit-domain), make a new kit (a folder, a CLI such as gh, docker or psql, a service, a database, docs, logs), prove it on real questions, or share one with a RECIPE.md. Use when the user pastes "add this kit" or "add this domain", asks for ask to answer about a new thing, or wants to publish a kit.
---

# Kits: add, make, prove, share

The command is `node "${CLAUDE_PLUGIN_ROOT}/bin/ask-kit.mjs"` (below: `ask-kit`). ask-kit's guide, with every path on this machine,
is ~/.config/ask-kit/AGENTS.md (Windows: %APPDATA%\ask-kit\AGENTS.md; `ask-kit doctor` prints where): read it first.

A kit is a folder with an `ask-kit.toml` manifest. It says what the kit answers and points at its
sources; ask-kit turns each source into a global in the investigator's REPL and writes the API
and default instructions from them. Kits go in the `kits/` folder next to the config.

```toml
name = "notes"                 # the value of `about`; the folder name
version = "0.1.0"
says = "my markdown notes: what I wrote about a topic, a project or a decision, and when"
keywords = ["notes?"]          # fallback routing when no router model answers
route_hint = "what I wrote down is notes; what a session did is sessions"   # read by the router model
cite = "`path:line`"           # how answers cite evidence
acts = ["notes.edit"]          # what it can change: shown at install, withheld unless the caller asks for a change (act)
requires = ["rg"]              # programs on PATH; without them (or a `required` setting, or the folder) the kit is not offered

[[settings]]                   # values it needs: env, then config domains.<kit>.settings, then detect, then default
key = "NOTES_DIR"
default = "~/notes"

[[sources]]
kind = "folder"                # folder | cli | module
name = "notes"                 # the global the investigator calls
path = "${NOTES_DIR}"
exclude = ["*.env", "private/**"]   # never searched or read: what it reads goes to a model
```

- `folder`: ripgrep, ast-grep, reads, edits, writes, git and programs in the folder, plus the
  host's `find`, `outline` and `tree` scripts. One manifest is a whole kit.
- `cli`: `gh("pr", "list")` → `{code, out, err}`, `.json(...)`, `.text(...)`, `.help(sub)`;
  `refuse = [{ args = "auth token", why = "prints the token" }]` for output that would leak a secret.
- `module`: `module = "x.mjs"` exporting `make({ settings, push, config, kitDir, cwd, act })`; `api =
  "api.d.ts"` describes what it returns. Use it when the client needs logic (parsing, checks).
- Optional: `instructions = "instructions.md"`, `scripts/` (each with `meta` and a default
  function taking the globals), `bench/questions.json`, `[[build]] command = [...]` run at install,
  `state_key = "${SETTING}"` for one state folder per repository or database, `[warm] script =
  "..."` for work the first question should not wait on (run with no model when a session starts).

## Add one someone shared

`ask-kit kit install <owner/repo>` fetches it and shows its sources, `acts`, settings, build
commands and module code without installing. A kit runs with the user's rights and no sandbox:
tell the user plainly what it reaches, what it can change and what it runs at install. Only on
their yes: `ask-kit kit install <owner/repo> --yes`. `ask-kit gallery` lists shared kits.
(`ask-kit add` does the same and also takes the older domain repositories.)

## Make one

1. Find the real questions first: ask `ask` (sessions) what agents dug for by hand about the
   source, with the questions in their words. Those are the bench; never invent questions.
2. `ask-kit kit new <name> --from folder:<path>` or `--from cli:<command>` writes the manifest.
   Write `says` in the words people use. Add a module when the CLI needs checks or parsing.
3. Give the kit the actions its source needs (restart, comment, edit): investigators act in their
   domain. Name each in `acts` as `<source>.<function>` or as the command (`gh pr comment`): the
   host withholds them unless the caller asked for a change (`act`), and a module's `make()` gets
   `act` for the ones it cannot name that way. Refuse only output that prints secrets and commands
   that never end.
4. Two to five scripts for the questions in the bench, each with `meta` (purpose, params, returns,
   example). The host lists their examples to the investigator.
5. `bench/questions.json`: `{"questions": [{"id", "q", "expect": [regex], "any"?: [regex]}]}`, each
   expectation checked against the live source now.
6. `ask-kit kit link <dir>`, then `ask-kit kit test <name>` once, on the backend the kit will
   use. Read each failing answer and fix the layer that caused it (a `says` word, an instruction
   line, a script). Don't rerun the bench after each fix: real use in `ask-kit report` shows
   whether the fixes held.

## Share one

Write a README (what it answers, what it can change, the install line, what it needs) and a
RECIPE.md: what it answers, what it needs (programs, keys, access), what it reads and runs, and a
brief another agent could rebuild it from with an empty folder. Push the kit folder as a public
GitHub repository named `ask-kit-<name>` with the topic `ask-kit`. Others add it with one line:
`Read <their ask-kit guide>, then add this kit: github.com/<you>/<repo>`.

## The older form: domains

A domain is a folder with `domain.mjs` (its globals and words), `api.d.ts`, `instructions.md` and
`scripts/`, in the `domains/` folder next to the config. They still load; a kit of the same name
wins. Write a kit for anything new.
