# Kits

A kit is what `ask` knows about and what it can do: a folder with an `ask-kit.toml` manifest that
says what the kit answers and points at its sources. ask-kit turns each source into a global in
the investigator's REPL, writes the API the investigator reads and, when the kit has none, its
instructions. The design is in [docs/design/kits.md](../design/kits.md); this page is what works
today.

## Install one

```sh
ask-kit gallery                          # shared kits: GitHub repositories with the topic ask-kit
ask-kit kit install temet-ai/ask-kit-github        # shows what it reaches, changes and runs
ask-kit kit install temet-ai/ask-kit-github --yes  # installs and enables it
```

Or paste into your agent: `Read ~/.config/ask-kit/AGENTS.md, then add this kit: github.com/temet-ai/ask-kit-github`.
Restart your agents so `ask` lists the kit. A kit runs as you, with no sandbox: the preview names
its sources, the calls that change things (`acts`) and the commands it runs at install.

| Kit | Answers | Sources |
|---|---|---|
| [github](https://github.com/temet-ai/ask-kit-github) | pull requests, issues, why CI failed, reviews, releases; comments, reruns, merges | `gh` |
| [docker](https://github.com/temet-ai/ask-kit-docker) | containers, why one fails, compose, ports, disk; restarts, prunes | `docker` |
| [postgres](https://github.com/temet-ai/ask-kit-postgres) | tables, columns, rows, slow queries, locks, sizes; runs SQL | `psql` |
| [systemd](https://github.com/temet-ai/ask-kit-systemd) | services, logs, timers, crashes, ports, disk, on this machine and over ssh; restarts | `systemctl`, `journalctl`, `ss` |
| [dotfiles](https://github.com/temet-ai/ask-kit-dotfiles) | which file in `~/.config` sets a keybinding, rule or setting; edits it | a folder, credentials excluded |
| [claude-code-docs](https://github.com/temet-ai/ask-kit-claude-code-docs) | how Claude Code works, from its docs and changelog | a folder, downloaded at install |
| fleet (needs [mike](https://github.com/temet-ai/mike)) | how a fleet of sessions is doing, what needs you, why a task is stuck; answers and mails seats | mike's MCP tools and inspect API |

## Make one

```sh
ask-kit kit new notes --from folder:~/notes     # or --from cli:gh
```

writes `~/.config/ask-kit/kits/notes/ask-kit.toml`:

```toml
name = "notes"
version = "0.1.0"
says = "my markdown notes: what I wrote about a topic, a project or a decision, and when"

[[sources]]
kind = "folder"
name = "notes"
path = "~/notes"
```

That is a whole kit. A folder source gets ripgrep, ast-grep, reads, edits, writes, git and
programs in the folder, and the host's `find`, `outline` and `tree` scripts. Then ask it:
`ask-kit ask --domain notes "what did I decide about billing?"`.

| Manifest field | Does |
|---|---|
| `says` | What the kit answers, in the words people use. The router and the calling agent read it. |
| `keywords`, `route_hint`, `patterns` | Routing: fallback words, a line for the router model, and regexes that claim a question outright with no model call (a question with past-work words, such as "session" or "yesterday", is only hinted) |
| `[[provides]]` `capability`, `covers`, `reach`, `priority` | What the kit answers that another kit or domain may answer too. `capability` names it (`session-history`), `covers` lists what of it the kit holds (agents: `claude-code`, `codex`, `copilot-cli`, `opencode`, `gemini-cli`; left out, all of it), `reach` says where from (`this-machine`, `all-machines`), and the highest `priority` wins. A question that names an agent goes to the best provider whose `covers` include it. A provider whose answer ends with the line `[no data]` hands the question to the next one, once. A kit that wins nothing is not offered. Two providers with overlapping `covers` at the same priority are an error in `doctor` and `kit install`; `domains.<kit>.priority` in the config settles it. The built-in `sessions` domain provides `session-history` for all five agents, `this-machine`, priority 10. |
| `cite` | How answers cite evidence |
| `requires`, `platforms` | Programs that must be on PATH, and the systems it runs on (`linux`, `macos`, `windows`). A kit whose programs, `required` settings or folders are missing is not offered on that machine; `kit list` says why. |
| `acts` | What the kit can change; shown at install |
| `[[settings]]` `key`, `about`, `default`, `detect`, `secret`, `required` | A value the kit needs, with `about` saying what it is (shown by `kit list` when it is missing, in the install preview and on the kits page): from the environment, then `domains.<kit>.settings` in the config, then `detect` (a command run in the agent's folder when the kit is first used, never when the router starts), then `default`. `${KEY}` uses it in a path or command; `${KIT_DIR}` is the kit's folder. A `secret` one leaves the investigator's environment once the sources hold it. |
| `state_key` | One state folder per value (the github kit keeps one per repository) |
| `[[sources]]` `kind = "folder"` | `path`, `exclude` (globs never searched or read: what the investigator reads goes to a model) |
| `[[sources]]` `kind = "cli"` | `command`, `refuse` (argument strings refused, with why), `env`, `timeout_seconds` |
| `[[sources]]` `kind = "mcp"` | `command` (the MCP server), `env`, `allow` (the tools it may call), `caller_args` (per tool, the argument set to the calling session, so actions are the caller's), `caller_env`. Each tool becomes a function: `mike.get_fleet({ fleet })`. |
| `[[sources]]` `kind = "module"` | `module` (exports `make({ settings, push, config, kitDir, cwd })`), `api` (its `api.d.ts`) |
| `instructions`, `scripts` | Your own instructions file and scripts folder (default `scripts/`) |
| `skills` | A folder of Markdown playbooks (default `skills/`). A file's name is the skill's name and its first line the purpose. See [Skills and roles](#skills-and-roles). |
| `[[roles]]` `name`, `when`, `instructions`, `patterns` | A playbook for one kind of question: `when` in plain words, `instructions` a file in the kit, `patterns` (regexes; checked when the manifest loads, not yet used to pick a role) |
| `uses` | Names of other installed kits whose sources and scripts join this kit's REPL. See [Use another kit's sources](#use-another-kits-sources). |
| `bench` | Real questions with the patterns each answer must hold (default `bench/questions.json`) |
| `[[build]] command` | Run at install, after the preview (the docs kit downloads its copy) |

`ask-kit kit link <dir>` uses a working folder in place: edits load on the next question.
`ask-kit kit list` shows every kit; `kit enable` and `kit disable` switch one.

## Run a script with no model

Any script the kit's REPL can run can run as a shot: the kit's own `scripts` folder, the host's
`find`, `outline` and `tree` for a folder kit, and the scripts of kits it uses. A shot calls no
investigator and no backend and returns the script's result. The calling agent passes `do` and
`params` to `ask`:

```
ask(do: "watch.duty", params: { post: "Pseudopolis Yard" })
```

```
{
 "post": "Pseudopolis Yard",
 "officers": [
  "Sam Vimes",
  "Carrot Ironfoundersson"
 ]
}

[watch · shot duty · 0s]
```

`do` is `<kit>.<script>`; a bare `<script>` works when `about` names the kit or only one kit has
that script. An unknown script is refused with the kit's list of scripts. From a shell the same
shot is `ask-kit run <kit> <script> [key=value ...]`, which prints the same text; a value that
parses as JSON (`n=3`, `all=true`) is passed as JSON.

```sh
ask-kit run watch duty post="Pseudopolis Yard"
```

The script runs as a cell of the kit's REPL, `shots.duty = await scripts.run("duty", params)`, so
the value stays there. With an `api` or `copilot-cli` backend, a later `continue: true` question
goes to the same REPL, and its prompt has one line saying `shots.duty` is there. With another
backend the line names the REPL that holds the shot, and the investigator brings it in with the
`load` tool. The journal row for a shot has `shot: true` and the script's name, and no backend,
model or cost.

## Get an early answer

When an investigator already holds the main fact and wants to check the rest, it can send the
fact at once. The ask returns it ending with `[partial: more is coming: ask again with continue:
true]` while the investigation carries on in the kit's server:

```
Angua is on duty at Cable Street (scripts.run duty).

[partial: more is coming: ask again with continue: true]

[watch · fake · early · 0s]
```

`ask` with `continue: true` then returns the rest of that run, waiting for it if it has not
finished, with the line `[the rest of your earlier question; ...]`. A run sends at most one early
answer. It works with `api` backends only. `ask-kit ask` from a shell passes `early: false`,
because the process ends with its reply; any caller can pass `early: false` for a single
complete answer. The first journal row has `early: true` and `partial: true`; the finished run's
row has `earlyMs`.

## Skills and roles

A kit can keep playbooks for particular jobs. Each loads only when the investigator asks for it.

```toml
[[roles]]
name = "triage"
when = "a question about something failing or broken"
patterns = ["\\b(fail|broken|crash)\\w*"]
instructions = "roles/triage.md"
```

With a `skills/` folder holding `owner.md` and `changelog.md` (each starting with a line saying
what the playbook is for), the instructions ask-kit writes for the kit end with:

```
Skills (playbooks; `skills.read(name)` loads one before you start the job it names):
- `changelog`: Summarise a changelog in three lines
- `owner`: Find the owner of a file

Roles (when a question fits one, `skills.read("role:<name>")` and follow it):
- `role:triage`: a question about something failing or broken
```

In the REPL, `skills.list()` returns each entry's `name`, `kind` and `purpose`, and
`skills.read(name)` returns the file; a role is read as `role:<name>` (or the bare name). Each
read is journaled. When the kit has its own `instructions` file, the same lines are added after
it. A role needs `name`, `when` and an existing `instructions` file; `kit list` shows a manifest
that lacks one with the reason.

## Use another kit's sources

```toml
name = "top"
says = "a kit that uses base"
uses = ["base"]
```

`uses` puts the other kit's globals, its `api.d.ts` section, its scripts and its skills and
roles (a name this kit already has keeps this kit's own) into this kit's REPL, and the
instructions gain a line naming each kit used. The used kit must be installed and able
to run on the machine; if it is not, this kit is unavailable and `kit list` says why. A kit that
uses itself, or a chain that comes back round (`a` uses `b` uses `a`), is refused. A used kit's
own `folder` is not merged.

## Ask another kit from a REPL cell

Inside any kit's REPL, `ask.kit(name, question, { continue })` asks another enabled kit's
investigator and returns its answer text:

```js
const a = await ask.kit("code", "where is the router defined?");
```

The call starts the other kit's server as the router does and passes the calling session
through, so `{ continue: true }` follows up on that kit's last answer. Only one level is
allowed: a kit started by `ask.kit` that calls `ask.kit` gets an error naming the limit. An
unknown kit, or one that is disabled or cannot run, is refused with the list of kits that can,
and a kit cannot ask itself. Each call is journaled as a call of kind `ask.kit` with the target
kit and seconds, and with the cost and backend when the answer carries a footer
(`footer: true`); the other kit's own journal has them either way:

```json
{"kind":"ask.kit","kit":"code","detail":"where is the router defined?","ms":198,"seconds":7,"costUsd":0.0031,"backend":"stub-model"}
```

Use `uses` when the other kit's calls belong in your own cells, and `ask.kit` when a question
belongs to the other kit's investigator.

## Prove it

```sh
ask-kit kit test notes --backends deepseek-v4.1-flash-1017,glm-5.3-flash
```

asks every question in the kit's bench on each backend and prints one summary line per backend:
questions passed, median seconds, cost, the cells the investigator ran (the total, and the
median per question) and how many questions were answered with no model:

```
github · deepseek-v4.1-flash-1017: 5/5, median 55s, $0.0093, 66 cells (median 11), 0/5 answered with no model
```

Each question's own line (on stderr) gives its seconds, cost and cells. The cells come from the
ask's journal row; `--out <file>` saves every result with its `cells` and `noModel`. A bench is real questions, the ones agents asked or dug for by hand (ask the `sessions`
kit to find them), never invented ones; each expectation is checked against the source when it
is written.

```json
{ "questions": [
  { "id": "ci-why", "q": "why did CI fail on main yesterday?", "expect": ["run \\d+", "test"], "any": ["timeout", "assert"] }
] }
```

A question can have `"do": "<script>"` and `"params": { ... }` in place of `q`. It then runs as
`ask-kit run <kit> <script>` (a [shot](#run-a-script-with-no-model)), calls no model, and counts
in the summary's "answered with no model". The `expect` and `any` patterns are checked against
the script's output.

`ask-kit report` prints the same measures for real use: its first line gives the asks, the
flagged ones, the shots with their share of all asks ("with no model"), cost and median seconds,
and `ask-kit report --json` has them as `shots` and `noModelShare`.

`ask-kit kit profile [--since 30d] [--json]` shows what each kit costs and does in real use, kit
tests and benchmarks left out: how often the router chose it, its asks' median seconds, cost and
cells, its misroutes, the fallbacks away from it and its no-data answers, the tokens it adds to
the router prompt of every routed ask, and the milliseconds it adds to starting the router.

## Share it

A public GitHub repository named `ask-kit-<name>` holding the kit folder, a README and a
`RECIPE.md` (what it answers, what it needs, what it reads and runs, and a brief to rebuild it
from an empty folder), with the topic `ask-kit`. It then shows in `ask-kit gallery`.

Domains (`domain.mjs` folders, [Domains](domains.md)) still load; a kit of the same name wins.
