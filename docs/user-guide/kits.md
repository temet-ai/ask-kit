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
| `keywords`, `route_hint`, `patterns` | Routing: fallback words, a line for the router model, and regexes that claim a question outright with no model call |
| `cite` | How answers cite evidence |
| `acts` | What the kit can change; shown at install |
| `[[settings]]` `key`, `default`, `detect`, `secret` | A value the kit needs: from the environment, then `domains.<kit>.settings` in the config, then `detect` (a command run in the agent's folder), then `default`. `${KEY}` uses it in a path or command; `${KIT_DIR}` is the kit's folder. A `secret` one leaves the investigator's environment once the sources hold it. |
| `state_key` | One state folder per value (the github kit keeps one per repository) |
| `[[sources]]` `kind = "folder"` | `path`, `exclude` (globs never searched or read: what the investigator reads goes to a model) |
| `[[sources]]` `kind = "cli"` | `command`, `refuse` (argument strings refused, with why), `env`, `timeout_seconds` |
| `[[sources]]` `kind = "mcp"` | `command` (the MCP server), `env`, `allow` (the tools it may call), `caller_args` (per tool, the argument set to the calling session, so actions are the caller's), `caller_env`. Each tool becomes a function: `mike.get_fleet({ fleet })`. |
| `[[sources]]` `kind = "module"` | `module` (exports `make({ settings, push, config, kitDir, cwd })`), `api` (its `api.d.ts`) |
| `instructions`, `scripts` | Your own instructions file and scripts folder (default `scripts/`) |
| `bench` | Real questions with the patterns each answer must hold (default `bench/questions.json`) |
| `[[build]] command` | Run at install, after the preview (the docs kit downloads its copy) |

`ask-kit kit link <dir>` uses a working folder in place: edits load on the next question.
`ask-kit kit list` shows every kit; `kit enable` and `kit disable` switch one.

## Prove it

```sh
ask-kit kit test notes --backends deepseek-v4.1-flash-1017,glm-5.3-flash
```

asks every question in the kit's bench on each backend and reports passed, median seconds and
cost. A bench is real questions, the ones agents asked or dug for by hand (ask the `sessions`
kit to find them), never invented ones; each expectation is checked against the source when it
is written.

```json
{ "questions": [
  { "id": "ci-why", "q": "why did CI fail on main yesterday?", "expect": ["run \\d+", "test"], "any": ["timeout", "assert"] }
] }
```

## Share it

A public GitHub repository named `ask-kit-<name>` holding the kit folder, a README and a
`RECIPE.md` (what it answers, what it needs, what it reads and runs, and a brief to rebuild it
from an empty folder), with the topic `ask-kit`. It then shows in `ask-kit gallery`.

Domains (`domain.mjs` folders, [Domains](domains.md)) still load; a kit of the same name wins.
