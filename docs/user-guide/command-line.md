# Command line

```
ask-kit init [--force]           skills, agent and rule into every agent found; write the guide
ask-kit setup                    set up in the terminal
ask-kit questions                setup questions and suggestions as JSON (what the skill reads)
ask-kit apply <answers.json> [--dry-run]
ask-kit detect [--json]          what this machine has (agents, transcripts, logins, keys, local models, tools)
ask-kit doctor                   check sources, backends and tools
ask-kit ask "<question>" [--domain sessions|code] [--backend name] [--continue]
ask-kit run <kit> <script> [key=value ...]   run a kit script with no model (a shot)
ask-kit report [--since 7d] [--json]   flagged asks, scripts used, routes worth a script, misroutes,
                                 actions (runs, fall-throughs, turned off: why), shadow runs, worth an action
ask-kit kit actions <kit> [--enable|--disable <action>] [--json]   a kit's [[actions]]: status and last 20 runs
ask-kit gaps [--since 30d] [--json]   lookups agents did by hand instead of asking, by kit
ask-kit mine <kit> [--since 30d] [--n 20] [--json]   those lookups' questions as draft bench rows
ask-kit smith scaffold|prove|install|promote ...   a kit built from those lookups, proven, kept improving
ask-kit gallery                  shared domains
ask-kit add <repo> [--yes]       show a shared domain's files; --yes installs and enables it
ask-kit lines                    the one-line prompts for any agent
ask-kit uninstall [--dry-run]    remove what ask-kit installed (not your edits)
ask-kit serve [--domain d]       the MCP server your agents start
```

## ask-kit kit actions

```sh
ask-kit kit actions watch
```

```
● duty                 Who is on duty at a post  (script duty)
    on
    last 2 runs: 2 answered, 0 fell through on an error or the shape, 0 asked again
    match: who is on duty at (?<post>\w+(?: \w+)?)
○ roster               A post's full roster  (script broken)
    turned off: 4 of its last 4 runs went wrong (4 fell through on an error or the output's shape, 0 asked again within 120 s)
    last 4 runs: 0 answered, 4 fell through on an error or the shape, 0 asked again
    match: roster of (?<post>\w+(?: \w+)?)
```

`●` is on, `○` off with the reason: turned off in the config, an action that changes something
and has not been turned on, or turned off after its runs went wrong. `--enable <action>` turns it
on: it clears a turn-off (the window of 20 runs starts again) and, for an action that changes
something, writes `domains.<kit>.actions.<action> = true` to the config. `--disable <action>`
writes `false`. The rules for matching, falling through and turning off are in
[Actions](kits.md#actions).

## ask-kit gaps

`ask-kit gaps` reads this machine's Claude Code, Codex, Copilot CLI, Gemini CLI and opencode
transcripts from the last 30 days (`--since 7d`, `12h`, `2w` or a date). In them it looks for
lookup chains: three or more lookups in a row inside one prompt's turn (reading files, `git`,
`gh`, MCP reads, web pages, logs, service state), with nothing edited after them in that turn.
A chain like that is an agent answering a question by hand. Each chain is put down to a kit by
what it touched: a program (`gh` is github, `docker` is docker, `psql` is postgres, `systemctl`
and `journalctl` are systemd, and any program a kit lists in `requires`), a kit's folder, the
session's repository (code), or an MCP server.

It prints three sections:

| Section | What it lists |
|---|---|
| Coverage | How many asks there were against chains answered by hand, as a share of the count and of the tokens. |
| Installed but skipped | For each kit you have, the chains that went to its sources by hand: how many, in how many sessions, their tokens, the areas they read and three prompts that started them. |
| No kit | Sources no installed kit covers, ranked by sessions times tokens, with the prompts; the terminal shows the first 12. |

Cost is the tokens of the model calls that made a chain's lookups, from the transcript's usage
records. Where ask-kit doesn't read per-call usage (Gemini CLI, opencode), it is the characters
of the tool results divided by four, and the Cost line says so. Dollars are list prices for
Claude models only.

Prompts that are mail between sessions, a fleet seat's brief, an interrupt, a resumed-session
notice or under 25 characters are not someone's question. They are counted, but no example comes
from them and the "No kit" list leaves them out. The report gives two counts: those from mail or
a fleet brief, and the rest.

ask-kit's own investigator sessions are left out. A resumed or forked Claude Code session copies
its parent's history; a chain is counted once, in the session that made it. Subagent transcripts
are not read.

The first run over 30 days of a busy machine takes about half a minute. Results per session are
kept in `<state>/index/gaps.json`, so a second run takes under a second. `--json` prints the
whole report as JSON.

## ask-kit mine

`ask-kit mine <kit>` turns the questions behind a kit's hand lookups into draft bench rows, so a
kit is tested on what agents actually needed from it. The name is any kit or source `ask-kit gaps`
lists, including one with no kit yet (`mike`, `web`). It takes the same chains as gaps: to-answer,
from a typed question, since `--since` (30 days by default). A question asked more than once
becomes one row. The rows are ordered by the tokens the digging cost, and `--n` (20) caps them.
Questions already in the kit's bench are left out.

Each row is in `kit test`'s format (`id`, `q`, `expect`), with `expect` empty and these fields
to help fill it:

| Field | What it holds |
|---|---|
| `found` | What the agent answered after the lookups, clipped |
| `suggest` | Identifiers and paths the answer named, as regexes for `expect` |
| `touched` | What the lookups read |
| `source` | The agent, session and time, to read the whole turn |

The drafts are written to `<state>/drafts/bench/<kit>.json`. `found` is what was true when the
question was asked. Code and services move on, so read each answer in the source as it is now
before you write `expect`. Then copy the row into the kit's `bench/questions.json` without the
helper fields.

## ask-kit smith

`smith` builds a kit from what `gaps` found and keeps it improving. Its four steps:

| Command | What it does |
|---|---|
| `smith scaffold <source> [--name n]` | Drafts a kit for a source `gaps` lists under No kit (`"mcp: flux"`, `gitlab`, `files: ~/notes`) |
| `smith prove <name> [--rounds 3]` | Tests the draft on the questions it was mined from, fixing its instructions between rounds |
| `smith install <name>` | Moves a proven draft into the kits folder and enables it |
| `smith promote <kit>` | Turns questions that keep running one script into `[[actions]]` entries |

**scaffold** finds the source on this machine:

- An MCP server is found in a `.mcp.json` above the folders the digging happened in, or in each
  agent's own config. Its tools are listed by starting it.
- A program is found on `PATH`, and its `--help` is read.
- A folder is used as it is.

It mines up to 12 questions with `mine`, leaving out ones that ask for a change. The default
backend then writes the kit's `says`, `keywords`, `route_hint` and instructions from the tools
and the questions. The draft goes to `<state>/drafts/kits/<name>`, and nothing routes to it there.

A drafted kit only reads. An MCP tool whose name says it changes something (`add`, `create`,
`transition`, `switch` and the like) is left out of `allow` and named in a comment, so you can
add it yourself. No value from the agent's config is copied into the kit. An environment
reference such as `${GITLAB_TOKEN}` stays a reference. Any other value becomes a `[[settings]]`
entry whose `detect` reads it from that config file each time. A server that finds its project
from the folder it starts in gets that folder as `cwd`.

**prove** runs `kit test` on the draft. Each mined question carries a `reference`: what the agent
found by hand at the time. A judge model grades each answer against its reference:

- `correct`: the answer passes.
- `partial` or `wrong`: the question failed. Failures go to a model that rewrites
  `instructions.md`, and the failed questions are asked again, for at most `--rounds` rounds.
- `changed`: the answer cites evidence that the source has moved on since the reference was
  written. prove reports these for you to fix by hand, and doesn't count them as failures.

Each round is recorded in the draft's `smith.json`. Any bench row with a `reference` and no
`expect` is graded this way, so you can write rows like that by hand too.

**promote** reads `ask-kit report`'s "Worth an action" list for the kit. For each cluster it
writes an `[[actions]]` entry:

- The match pattern is built from a real question.
- Each value that differed between the questions becomes a named capture.
- Each value they all shared becomes a default in `params`.

An entry is kept only when every example question matches it. smith prints the entries and
never edits a kit's manifest. Add them yourself, then check them with `ask-kit kit actions <kit>`.

## What init puts in each agent

The source for all of these is in the repository's `bundle/` folder: `bundle/skills/`,
`bundle/agents/ask-kit-tuner.md` and `bundle/rules/ask.md`.

| Agent | `ask` tool | Skills | Tuner agent | When-to-ask rule |
|---|---|---|---|---|
| Claude Code | `claude mcp add -s user` | `~/.claude/skills/` | `~/.claude/agents/` | `~/.claude/rules/ask-kit.md` |
| Codex | `config.toml` block, 600 s tool timeout | `~/.codex/skills/` | (as a skill) | block in `~/.codex/AGENTS.md` |
| Copilot CLI | `~/.copilot/mcp-config.json` | `~/.copilot/skills/` | `~/.copilot/agents/` | `~/.copilot/instructions/ask-kit.instructions.md` |
| opencode | `opencode.json` `mcp` | `~/.config/opencode/skill/` | `~/.config/opencode/agent/` | block in its `AGENTS.md` |
| Gemini CLI | `settings.json` | `~/.gemini/skills/` | (as a skill) | block in `~/.gemini/GEMINI.md` |

Each file is recorded with its hash in `installed.json`. A file you edit is never overwritten,
and `ask-kit uninstall` removes only what ask-kit wrote.

## Files

| What | Linux and macOS | Windows |
|---|---|---|
| Config, written by setup | `~/.config/ask-kit/config.json` | `%APPDATA%\ask-kit\config.json` |
| Keys you pasted (mode 0600) | `~/.config/ask-kit/keys.env` | `%APPDATA%\ask-kit\keys.env` |
| The guide for agents | `~/.config/ask-kit/AGENTS.md` | `%APPDATA%\ask-kit\AGENTS.md` |
| Your own domains | `~/.config/ask-kit/domains/` | `%APPDATA%\ask-kit\domains\` |
| Journals, REPL snapshots, warm sessions, transcript index | `~/.local/state/ask-kit/` | `%LOCALAPPDATA%\ask-kit\state\` |

`XDG_CONFIG_HOME` and `XDG_STATE_HOME` are honoured. `ASK_KIT_CONFIG` and `ASK_KIT_STATE` move
the two folders anywhere.

Every file, folder and environment variable is listed in
[Files and environment variables](reference/files-and-env.md), and every config key in
[Config file](reference/config.md). [Setup](internals/setup.md) explains what each command does
inside.
