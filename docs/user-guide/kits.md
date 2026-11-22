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
| [tests](https://github.com/temet-ai/ask-kit-tests) | do the tests, build, lint and typecheck pass; which tests fail and why; type errors; flaky tests; fixes one when asked | the project's own test, lint and build commands |
| [deps](https://github.com/temet-ai/ask-kit-deps) | which version of a package is installed and why; outdated, vulnerable, licences; how to call an installed library; installs and removes | npm, pnpm, yarn, Python, Go |
| [repos](https://github.com/temet-ai/ask-kit-repos) | every git repository and worktree on the machine: uncommitted, unpushed, stashed, ahead or behind; fetches, pulls, prunes | `git` |
| [data](https://github.com/temet-ai/ask-kit-data) | a CSV, TSV, JSON or JSON-lines file: columns, rows, groups, distinct values, how two files differ | Node; `duckdb` if installed |
| [sqlite](https://github.com/temet-ai/ask-kit-sqlite) | a `.db` file's tables, columns, rows, which table holds a value, size, health; runs SQL that writes when asked | Node |
| [web](https://github.com/temet-ai/ask-kit-web) | what a page or a docs site says about something, which page covers a topic, a changelog | Node; `pdftotext` for PDFs |
| [procs](https://github.com/temet-ai/ask-kit-procs) | what holds a port, what uses the CPU or memory, whether a program is running; stops one | `ps`, `ss` or `lsof` |
| [net](https://github.com/temet-ai/ask-kit-net) | what a name resolves to, whether a host and port answer, what a URL returns, when a certificate expires | Node |
| [logs](https://github.com/temet-ai/ask-kit-logs) | log files on disk: which errors are most common or new, when one first appeared, what happened around a time or request id | Node |
| [files](https://github.com/temet-ai/ask-kit-files) | where a file is, what uses the space, what changed in a folder, which documents mention something, what a PDF, office file or archive holds | Node |
| [notes](https://github.com/temet-ai/ask-kit-notes) | a Markdown vault (Obsidian, Logseq): what I wrote or decided, open and overdue tasks, backlinks, the daily note; adds and ticks tasks | a folder |
| [shell](https://github.com/temet-ai/ask-kit-shell) | what command I ran, where an alias or variable is set, which copy of a program wins on PATH | shell history, startup files |
| [api](https://github.com/temet-ai/ask-kit-api) | one HTTP API with an OpenAPI document: its endpoints, what one takes and returns; calls it | Node |
| [git](https://github.com/temet-ai/ask-kit-git) | the current repository: uncommitted work, which commit changed a line, whether a branch is merged or pushed; commits and tidies when asked | `git` |
| [rust](https://github.com/temet-ai/ask-kit-rust) | a cargo workspace: compile errors with the suggested fix, failing tests, clippy, the crate tree, build times; fixes when asked | `cargo`, `git` |
| [checks](https://github.com/temet-ai/ask-kit-checks) | what a repository's checks cost and catch: slow or never-failing CI jobs, overlapping checks, hooks | `git` |
| [release](https://github.com/temet-ai/ask-kit-release) | how close a repository is to a public release; what is unreleased since the last tag; adds missing files when asked | `git`, Node |
| [docs-check](https://github.com/temet-ai/ask-kit-docs-check) | whether the docs still match the code: stale paths, flags and env vars, broken links | `git`, `rg` |
| [gitlab](https://github.com/temet-ai/ask-kit-gitlab) | merge requests, pipelines and why a job failed, issues; comments and reruns | `glab` |
| [skills](https://github.com/temet-ai/ask-kit-skills) | Claude Code skills and agents: which covers a job, overlaps, broken frontmatter, stale references | a folder |
| [rules](https://github.com/temet-ai/ask-kit-rules) | CLAUDE.md, AGENTS.md, rules and lessons: what exists on a subject, duplicates, contradictions, stale rules | `rg` |
| [claude-setup](https://github.com/temet-ai/ask-kit-claude-setup) | how Claude Code is configured: hooks, permissions, MCP servers, settings, and which file sets each | a folder |
| [storybook](https://github.com/temet-ai/ask-kit-storybook) | a project's Storybook: stories, components with no story, stories that fail, the build; writes a story when asked | Node |
| [browser](https://github.com/temet-ai/ask-kit-browser) | what a page does in a headless browser: errors, layout faults, contrast, screenshots, short click sequences | Node |
| [ink](https://github.com/temet-ai/ask-kit-ink) | building Ink 8 terminal apps: playbooks plus checks of the app's own render options, tests and bundle | Node |
| [hyperframes](https://github.com/temet-ai/ask-kit-hyperframes) | HyperFrames videos: which skill or block fits, why a check failed, what a project is missing | a folder |
| [desktop](https://github.com/temet-ai/ask-kit-desktop) | a Hyprland desktop on Omarchy: windows, workspaces, monitors, keybindings, what is on screen; acts on windows | `hyprctl`, `grim`, `tesseract` |
| [crash](https://github.com/temet-ai/ask-kit-crash) | why a program crashed, from systemd-coredump: which crashed, one crash in detail, a backtrace, a report | `coredumpctl`, `journalctl` |
| [phone](https://github.com/temet-ai/ask-kit-phone) | an Android phone over adb: what is on screen, installed apps, recent crashes; taps, types and opens apps | `adb` |
| [taste](https://github.com/temet-ai/ask-kit-taste) | what a person's taste or style file says they accept and reject, and whether a piece of work breaks it | a file you point it at |
| [python](https://github.com/temet-ai/ask-kit-python) | a Python project: which interpreter and virtualenv it uses, whether uv's lock and sync are current, why an import or `uv run` fails, what `pyproject.toml` declares; runs pytest, ruff and mypy | `python3`; `uv` for lock and sync |
| [tmux](https://github.com/temet-ai/ask-kit-tmux) | tmux: sessions, windows and panes, what runs in a pane and what it shows, which pane has an error, the config; sends keys and manages panes when asked | `tmux` |
| [omarchy](https://github.com/temet-ai/ask-kit-omarchy) | Omarchy: its version and updates, which `omarchy` command does a job, themes, which file to edit and what differs from the defaults, whether an app follows its conventions | Omarchy (Linux) |

## Who can make a kit change something

A kit's code runs as you, with no sandbox; you decide that at install from the preview. What the
investigator does with it is a separate question, because a cheap model reads text nobody vouched
for: files in a folder, issue bodies through the github kit, tool output inside transcripts. So
the calls that change things are in its REPL only when the caller's own words asked for a change.
Text the investigator reads during the ask never grants them.

An ask can change things (`act`) when the caller passed `act: true`, when the request opens with
what to do ("fix ...", "restart ...", "send ..."), when it continues an ask that could, or when an
acting [action](#actions-that-change-something) you turned on matched it. Otherwise:

- a `folder` source reads only: `write`, `edit` and `run` throw, and `git` runs only commands that read;
- an `acts` entry written `<source>.<function>` (`dotfiles.edit`, `mike.define_fleet`,
  `inspect.start`) makes that function or MCP tool throw, also through a module's
  `call(name, ...)` (`mcp.call("send_session_message")`);
- an `acts` entry written as a command (`gh pr comment`, `systemctl restart`) refuses a `cli`
  call, or a `module` function call, whose arguments hold it (`gh.run("pr", "comment", ...)`);
- a `module` source's `make()` gets `act`, and holds back what the host cannot recognise in
  `acts` ("any SQL the role may run"): build the acting functions only when `act` is true;
- `ask.kit` asks the other kit with the same `act`, so a read-only ask cannot reach another kit's acting calls.

A withheld call throws `... is off in this ask` or `not in this ask: ...`. The investigator then
says that the change needs `ask` with `act: true`, and the caller can ask again with it. The
[`ask` reference](reference/ask-tool.md#asking-for-a-change-act) has the full rules.

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
| `acts` | What the kit can change; shown at install, and withheld from an ask that did not ask for a change. Write each as `<source>.<function>` or as the command (`gh pr comment`) so the host can hold it back. See [Who can make a kit change something](#who-can-make-a-kit-change-something). |
| `[[actions]]` `name`, `title`, `script`, `match`, `params`, `expect`, `acts` | A question one of `match`'s regexes matches as a whole is answered by `script` with no model; named captures fill its params, `params` gives defaults, and output that does not match `expect` goes to the model instead. An action whose script is in `acts`, or that sets `acts = true`, is off until you turn it on. See [Actions](#actions). |
| `[[settings]]` `key`, `about`, `default`, `detect`, `secret`, `required` | A value the kit needs, with `about` saying what it is (shown by `kit list` when it is missing, in the install preview and on the kits page): from the environment, then `domains.<kit>.settings` in the config, then `detect` (a command run in the agent's folder when the kit is first used, never when the router starts), then `default`. `${KEY}` uses it in a path or command; `${KIT_DIR}` is the kit's folder. A `secret` one leaves the investigator's environment once the sources hold it. |
| `up` | A URL of the service the kit reads (`"${MIKE_INSPECT_URL}/api/stats"`). The router sends it one GET before each ask to the kit, waits 1.5 s at most and keeps the result for 15 s. While it does not answer (no reply, or a status of 500 or more), no investigator is started for the kit: the question goes to the next provider of the same capability and the answer ends with a line saying so, or, with no other provider, the caller is told at once that the service is not answering. |
| `state_key` | One state folder per value (the github kit keeps one per repository) |
| `[[sources]]` `kind = "folder"` | `path`, `exclude` (globs never searched or read: what the investigator reads goes to a model) |
| `[[sources]]` `kind = "cli"` | `command`, `refuse` (argument strings refused, with why), `env`, `timeout_seconds` |
| `[[sources]]` `kind = "mcp"` | `command` (the MCP server), `env`, `allow` (the tools it may call), `caller_args` (per tool, the argument set to the calling session, so actions are the caller's), `caller_env`, `by_name_above` (default 30). Each tool becomes a function: `mike.get_fleet({ fleet })`. A server with more than `by_name_above` allowed tools is documented by name: the API lists the tool names and `find(word)`, `describe(name)` and `call(name, args)`, and the investigator reads a signature with `describe` when it needs one. A server of 131 tools made a 145 KB API, which cost a model its pass on the bench and 12 times the price. Set `by_name_above` higher to list every signature, or lower to switch earlier. |
| `[[sources]]` `kind = "module"` | `module` (exports `make({ settings, push, config, kitDir, cwd, act })`; `act` is true only when the caller asked for a change), `api` (its `api.d.ts`) |
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

## Actions

A shot needs the caller to know the script. An action lets the question itself pick it: the kit
says which questions a script answers, and those questions are answered with no model.

```toml
[[actions]]
name = "duty"
title = "Who is on duty at a post"
script = "duty"
match = ['who is on duty at (?<post>\w+(?: \w+)?)']
expect = 'officers'
```

`ask("Who is on duty at Cable Street?")` then returns the script's output and one line saying
where it came from:

```
{
 "post": "Cable Street",
 "officers": [
  "Angua"
 ]
}

[answered by watch's action duty: script duty {"post":"Cable Street"}, no model; continue: true hands it to the investigator]
```

- `match` is one regex or a list. It must match the whole question; only spaces and a closing
  `?`, `.` or `!` may follow. Matching ignores case. "Who is on duty at Cable Street and why was
  Nobby moved?" does not match, so the investigator answers it.
- Named captures (`(?<post>...)`) become the script's params, on top of the defaults in `params`.
  A capture that is all digits is passed as a number, and `true` or `false` as a boolean.
- When the router chooses, an enabled action's match claims the question before kit patterns and
  before the router model, so the question costs no model call at all. With `about`, or when the
  router picked the kit some other way, the kit's server tries its actions before its investigator.
  A `continue: true` question never runs an action.
- The script runs the way a shot does, so its value stays in the REPL as `shots.<script>` for a
  follow-up.

The question goes to the investigator, as if the kit had no action, when no pattern matches, the
script throws, its output is empty (`null`, `undefined`, `[]`, `{}` or nothing), or the output
does not match `expect`. The caller sees only the investigator's answer.

When a pattern is found inside a longer question without matching all of it ("Who is on duty at
Cable Street, and who else is on duty?"), the investigator still answers, but on an `api` backend
its script runs first: the result goes in the first message, and stays in the REPL as
`shots.<script>`, so the model starts with the data instead of spending a turn fetching it. Only
an action that changes nothing and is not set to `false` in the config opens this way; an empty or
failed result is left out. The ask row records it as `opened`.

### Actions that change something

An action whose `script` is named in the kit's `acts`, or that sets `acts = true`, is off until
you turn it on:

```sh
ask-kit kit actions watch --enable dismiss
```

That writes `domains.watch.actions.dismiss = true` to the config. Setting it to `false` turns any
action off; `--disable <name>` does that. A request an acting action you turned on matches counts
as asking for a change: its script, and the investigator if the action falls through, get the
kit's acting calls.

### How an action is turned off for you

Every run is journaled in `<state>/actions/<kit>.jsonl` with its params, time and, when it fell
through, why. Of an action's last 20 runs, a run counts as bad when it fell through on an error,
empty output or `expect`, or when the caller asked again within 120 seconds. Asking again means
either a new question to the same kit that is not the same action with other params, or a
correction sent to another kit with `about`. A `continue: true` follow-up does not count. When
more than 3 of the 20 are bad, the action is turned off. That is recorded in
`<state>/actions/<kit>.json`, not in your config, and `ask-kit report` shows it under
"turned off" with the reason. `ask-kit kit actions <kit>` lists every action with its status and
its last 20 runs, and `--enable <name>` turns it on again with a fresh window.

### Shadow runs

One answered run in 20 also runs the investigator on the same question, in the background, after
the caller has the action's answer. Both answers go to the action log, and `ask-kit report` shows
them side by side under "Shadow runs". Nothing judges them; reading them is how you see an action
drift. `actions.shadowEvery` in the config sets the 20; `0` turns shadow runs off. A shadow run
costs one ask on the kit's backend. It is lost if the server exits first, as `ask-kit ask` does
when it has printed the answer.

### Finding questions worth an action

`ask-kit report` has a section "Worth an action": real questions (kit tests and benchmarks left
out) grouped by kit, by the question with its numbers, quoted text, ids and paths blanked, and by
the library script their cells ran, ranked by count times cost. Each entry shows the script and
the param values the investigator called it with. That is what you need to write the
`[[actions]]` entry; nothing writes one for you.

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
and a kit cannot ask itself. The other kit is asked with this ask's `act`: from a read-only ask
it reads only, whatever the question says. Each call is journaled as a call of kind `ask.kit` with the target
kit and seconds, and with the cost and backend when the answer carries a footer
(`footer: true`); the other kit's own journal has them either way:

```json
{"kind":"ask.kit","kit":"code","detail":"where is the router defined?","ms":198,"seconds":7,"costUsd":0.0031,"backend":"stub-model"}
```

Use `uses` when the other kit's calls belong in your own cells, and `ask.kit` when a question
belongs to the other kit's investigator.

## Prove it

```sh
ask-kit kit test notes
```

asks every question in the kit's bench on the kit's backend (`--backends a,b` for several) and prints one summary line per backend:
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
