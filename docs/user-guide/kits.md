# Kits

A kit is what `ask` knows about and what it can do: a folder with an `ask-kit.toml` manifest that
says what the kit answers and points at its sources. ask-kit turns each source into a global in
the investigator's REPL, writes the API the investigator reads and, when the kit has none, its
instructions. The design is in [docs/design/kits.md](../design/kits.md); this page is what works
today.

## Install one

```sh
ask-kit gallery                                   # shared kits: GitHub repositories with the topic ask-kit
ask-kit kit suggest                               # which kits would have answered what your agents dug for by hand
ask-kit kit install temet-ai/ask-kit-github       # a preview: what it reaches, changes, runs and needs, and whether it can run here
ask-kit kit install temet-ai/ask-kit-github --yes # installs and enables it
```

Or paste into your agent: `Read ~/.config/ask-kit/AGENTS.md, then add this kit: github.com/temet-ai/ask-kit-github`.
`ask` offers a kit on its next call: there is no restart. A running `ask` checks the config and
the kit folders on every call, rebuilds when they changed, and tells the agent its tool changed.
A kit runs as you, with no sandbox: the preview names its sources, the calls that change things
(`acts`), the commands it runs at install and the files to read before saying yes.

| Command | Does |
|---|---|
| `kit install <owner/repo>` | A kit at the repository's root, or every kit in `kits/<name>/` (a pack) |
| `kit install <owner/repo/folder>` | The kit or pack in that folder of the repository; a GitHub `tree/<branch>/<folder>` address works too |
| `--only a,b` | Only these kits of a pack |
| `--ref <branch or tag>` | That branch or tag instead of the default branch |
| `--as <name>` | A copy of the kit under another name, with its own settings and state: two APIs, two notes folders |
| `--full` | The preview with every file and the modules' source |
| `kit update [name] [--yes]` | Fetches each installed kit again from where it came from and says what changed: files, and under `consent` what it now reaches, changes, runs or needs that it did not before. `--yes` applies it and keeps its settings. A linked kit is live already. |
| `kit remove <name> [--purge] [--yes]` | Deletes an installed kit, or unlinks a linked one (its folder stays), with its config entry and aliases. `--purge` also deletes its journals, generated files, action log and data. A built-in kit is turned off with `kit disable` instead. |
| `kit set <name> [KEY=value ...] [--unset KEY]` | Shows a kit's settings and where each value comes from (secrets masked), or sets them in the config |
| `kit suggest [--from <pack>] [--since 30d]` | Kits not installed here, ranked by the lookups your agents did by hand that the kit answers for (its `replaces`), from this machine's transcripts. `--from` takes a folder or `owner/repo/folder` of kits; without it, the gallery. |
| `kit commons [name]` | What kits repeat of each other and of the shared library ([Shared code](#shared-code-lib-and-kit-commons)) |
| `kit mesh <name or source>` | How a kit fits with the installed kits: code it repeats, questions it would take or lose, commands and answers it shares, work it redoes that another kit answers for, settings it needs; each with a step for the agent, the person or the kit's author. It changes nothing. |
| `kit log <name>`, `kit config-dir <name>` | A kit's recent asks from its journals; every folder ask-kit keeps for it |

Install refuses a kit whose name a different kit already has (another `id`, or a linked folder):
install it with `--as <other name>`, or remove the other first. A kit whose `min_ask_kit` is newer
than this ask-kit is not installed and not offered, and says how to upgrade. The preview also
names the questions of installed kits that the new kit's patterns or actions would take
(`claims`), and the code it carries that the shared library already has (`repeats`).

| Kit | Answers | Sources |
|---|---|---|
| [github](https://github.com/temet-ai/ask-kit-github) | pull requests, issues, why CI failed, reviews, releases; comments, reruns, merges | `gh` |
| [docker](https://github.com/temet-ai/ask-kit-docker) | containers, why one fails, compose, ports, disk; restarts, prunes | `docker` |
| [postgres](https://github.com/temet-ai/ask-kit-postgres) | tables, columns, rows, slow queries, locks, sizes; runs SQL | `psql` |
| [systemd](https://github.com/temet-ai/ask-kit-systemd) | services, logs, timers, crashes, ports, disk, on this machine and over ssh; restarts | `systemctl`, `journalctl`, `ss` |
| [dotfiles](https://github.com/temet-ai/ask-kit-dotfiles) | which file in `~/.config` sets a keybinding, rule or setting; edits it | a folder, credentials excluded |
| [claude-code-docs](https://github.com/temet-ai/ask-kit-claude-code-docs) | how Claude Code works, from its docs and changelog | a folder, downloaded at install |
| [tests](https://github.com/temet-ai/ask-kit-tests) | do the tests, build, lint and typecheck pass; which tests fail and why; is a failure new | the project's own check commands |
| [web](https://github.com/temet-ai/ask-kit-web) | what a page or documentation site says about something | HTTP, through a proxy when one is set |
| [repos](https://github.com/temet-ai/ask-kit-repos) | every repository and worktree here: unfinished work, branches, activity | `git` |
| [sqlite](https://github.com/temet-ai/ask-kit-sqlite) | a SQLite file's tables, rows, values and health | `node:sqlite` |
| [data](https://github.com/temet-ai/ask-kit-data) | a CSV, TSV or JSON file's columns, rows, groups and differences | the file |
| [deps](https://github.com/temet-ai/ask-kit-deps) | which packages a project has, why, how old and safe, and how to call one | lockfiles, installed packages, the registries |
| [procs](https://github.com/temet-ai/ask-kit-procs) | what holds a port, uses the CPU or memory, or was left running; stops it | `/proc`, `ps`, `lsof` |
| fleet (needs [mike](https://github.com/temet-ai/mike)) | how a fleet of sessions is doing, what needs you, why a task is stuck; answers and mails seats | mike's MCP tools and inspect API |

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
ask-kit kit new notes --from folder:~/notes     # or --from cli:gh, or --from mcp:<command that starts the server>
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
| `id`, `min_ask_kit` | The kit's identity (`<owner>.<name>`), kept by a copy installed with `--as` and used by `kit update` to find a kit renamed upstream; and the oldest ask-kit it works with (x.y.z): on an older one it is not offered or installed |
| `replaces` | The commands the kit answers for, one or two words each (`["lsof", "npm outdated"]`). `ask-kit gaps` puts a lookup chain that ran one down to the kit, and `kit suggest` ranks kits by them. |
| `requires`, `platforms` | Programs that must be on PATH, and the systems it runs on (`linux`, `macos`, `windows`). A kit whose programs, `required` settings or folders are missing is not offered on that machine; `kit list` says why. |
| `acts` | What the kit can change; shown at install, and withheld from an ask that did not ask for a change. Write each as `<source>.<function>` or as the command (`gh pr comment`) so the host can hold it back. See [Who can make a kit change something](#who-can-make-a-kit-change-something). |
| `[[actions]]` `name`, `title`, `script`, `match`, `params`, `expect`, `acts` | A question one of `match`'s regexes matches as a whole is answered by `script` with no model; named captures fill its params, `params` gives defaults, and output that does not match `expect` goes to the model instead. An action whose script is in `acts`, or that sets `acts = true`, is off until you turn it on. See [Actions](#actions). |
| `[[settings]]` `key`, `about`, `default`, `detect`, `secret`, `required` | A value the kit needs, with `about` saying what it is (shown by `kit list` when it is missing, in the install preview and on the kits page): from the environment, then `domains.<kit>.settings` in the config (`kit set`), then `detect` (a command run in the agent's folder when the kit is first used, never when the router starts), then `default`. `${KEY}` uses it in a path or command; `${KIT_DIR}` is the kit's folder, `${CALLER_DIR}` the folder the agent works in, and `${STATE_DIR}` the kit's own data folder. A `secret` one leaves the investigator's environment once the sources hold it. |
| `state_key` | One state folder per value (the github kit keeps one per repository) |
| `[[sources]]` `kind = "folder"` | `path`, `exclude` (globs never searched or read: what the investigator reads goes to a model) |
| `[[sources]]` `kind = "cli"` | `command`, `refuse` (argument strings refused, with why), `env`, `timeout_seconds` |
| `[[sources]]` `kind = "mcp"` | `command` (the MCP server), `env`, `allow` (the tools it may call), `caller_args` (per tool, the argument set to the calling session, so actions are the caller's), `caller_env`, `by_name_above` (default 30). Each tool becomes a function: `mike.get_fleet({ fleet })`. A server with more than `by_name_above` allowed tools is documented by name: the API lists the tool names and `find(word)`, `describe(name)` and `call(name, args)`, and the investigator reads a signature with `describe` when it needs one. A server of 131 tools made a 145 KB API, which cost a model its pass on the bench and 12 times the price. Set `by_name_above` higher to list every signature, or lower to switch earlier. |
| `[[sources]]` `kind = "module"` | `module` (exports `make({ settings, push, config, kitDir, callerDir, stateDir, act, lib })`; `act` is true only when the caller asked for a change, `callerDir` is the agent's folder, `stateDir` the kit's own data folder, `lib` the [shared library](#shared-code-lib-and-kit-commons)), `api` (its `api.d.ts`) |
| `instructions`, `scripts` | Your own instructions file and scripts folder (default `scripts/`) |
| `skills` | A folder of Markdown playbooks (default `skills/`). A file's name is the skill's name and its first line the purpose. See [Skills and roles](#skills-and-roles). |
| `[[roles]]` `name`, `when`, `instructions`, `patterns` | A playbook for one kind of question: `when` in plain words, `instructions` a file in the kit, `patterns` (regexes; checked when the manifest loads, not yet used to pick a role) |
| `uses` | Names of other installed kits whose sources and scripts join this kit's REPL. See [Use another kit's sources](#use-another-kits-sources). |
| `bench` | Real questions with the patterns each answer must hold (default `bench/questions.json`) |
| `[[build]] command` | Run at install, after the preview (the docs kit downloads its copy) |

`ask-kit kit link <dir>` uses a working folder in place: edits load on the next question.
`ask-kit kit list` shows every kit; `kit enable` and `kit disable` switch one; `kit remove` unlinks a linked one.

## Shared code: lib and kit commons

A module's `make()` gets `lib`, the jobs kits kept writing for themselves, written once and tested
in ask-kit (`src/kitlib/`, [docs/design/mesh.md](../design/mesh.md)):

| In `lib` | Does |
|---|---|
| `redact(text, {names})`, `redactDeep(value, {names})`, `isCredName(name)` | Masks keys, tokens, passwords, URL passwords, bearer headers and `--password`-style flags, keeping the flag or name readable; a field whose name is a credential is replaced whole. Counts such as `max_tokens=4000` stay. |
| `isSecretPath(path)` | Whether a file holds credentials (`.env`, keys, `.netrc`, histories, `client_secret.json`), told apart from code and notes about them (`token.js`) |
| `run(bin, args, {timeoutMs, cwd, env, input})` | A program with no shell, a timeout and a cap, journaled; never throws for a failing program; the kit's `acts` phrases are held back without `act` |
| `http.request(url, {method, headers, body, timeoutMs, maxBytes, redirects, stay, publicOnly})` | HTTP through `HTTPS_PROXY`/`HTTP_PROXY` and `NO_PROXY`, with one deadline for the whole exchange; `publicOnly` refuses this machine, private networks and cloud metadata at every redirect |
| `deny(why)`, `notInThisAsk(what)` | A refusal, and the host's sentence for a change the caller did not ask for |
| `pool(items, n, fn)`, `walk(dir, {match, depth, max, ms})`, `size(bytes)`, `age(time)`, `path(p)` | A few at a time in order; folders with a skip list, caps and credential files counted, not listed; "1.4 GB", "3 days ago"; a path from the caller's folder |

A kit that uses `lib` sets `min_ask_kit` to the first ask-kit with what it uses.

`ask-kit kit commons [name]` compares the code of every installed kit (or `--dir <folder of kits>`)
with each other and with `lib`: by job (redaction, credential paths, HTTP through a proxy, running
programs, refusals, the state folder, walking, sizes) and by token similarity with local names
ignored. For each kit it says which of its own copies `lib` already does (`use`: read the kit's copy
for anything `lib`'s lacks before moving onto `lib`), and it lists code two or more kits share that
`lib` has no job for: candidates for `lib`. The install preview shows the first part as `repeats`.

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
