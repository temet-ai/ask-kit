# Incubator: the next kits

Kits built here before each gets its own repository (`temet-ai/ask-kit-<name>`, topic `ask-kit`).
Every folder is a whole kit: manifest, module, API file, instructions, scripts, a bench with its
fixture, README, RECIPE and licence. Nothing in this folder is part of the npm package.

## Try them

From a checkout of this branch:

```sh
ask-kit kit install ./incubator            # previews every kit here: sources, acts, settings, files
ask-kit kit install ./incubator/notes --yes   # installs one
ask-kit kit link ./incubator/notes            # or use it in place while changing it
```

## How they were chosen

A kit earns its place when all of these hold:

1. Agents answer the question many times a day, by hand, with a run of tool calls.
2. The output of those calls is large and the answer is small: a failing test out of 2,000
   lines of log, one section out of a 90,000-character page, three repositories out of forty.
3. A script can answer the whole everyday question in one call, so most asks need few cells, and
   the commonest ones can become `[[actions]]` that need no model.
4. It works on the machine as it is: no account, no server, no new program where Node can do it.
5. It can be proved offline against a fixture.

This is also what makes a kit replace a subagent or a skill. A subagent is a fresh context with
tools and a prompt; a skill is a playbook. A kit is both, on a cheap model: the scripts are the
playbook as code, the instructions are the prompt, and the journal and bench say whether it works.

## Moved to their own repositories

These kits were built here and now each has its own repository, with its history. Install one
with `ask-kit kit install temet-ai/ask-kit-<name>`.

| Kit | Repository | Replaces | Answers | Changes (only when asked) | Offline bench |
|---|---|---|---|---|---|
| tests | [temet-ai/ask-kit-tests](https://github.com/temet-ai/ask-kit-tests) | a test-runner subagent, a "run the checks" skill | do the tests, build, lint and typecheck pass; which tests fail and why; is a failure new since the last run; is a test flaky; what did the last run say | any other command in the project | 8/8 |
| web | [temet-ai/ask-kit-web](https://github.com/temet-ai/ask-kit-web) | a web-fetch subagent, a docs-lookup skill | what a page says about something; the section of a docs site that answers a question; which page of a site covers a topic | nothing | 7/7 |
| repos | [temet-ai/ask-kit-repos](https://github.com/temet-ai/ask-kit-repos) | loops of `git status` over folders | which repositories and worktrees hold uncommitted, unpushed or stashed work; where a branch or commit lives; what was committed today across projects; which branches can go | fetch, pull, push, switch, stash, prune | 10/10 |
| sqlite | [temet-ai/ask-kit-sqlite](https://github.com/temet-ai/ask-kit-sqlite) | runs of `sqlite3` | a SQLite file's tables, columns, rows, which table holds a value, size, health | SQL that writes | 14/14 |
| data | [temet-ai/ask-kit-data](https://github.com/temet-ai/ask-kit-data) | a data-analyst skill, `head`, `jq` and throwaway scripts | a CSV, TSV, JSON or JSON-lines file's columns and types, matching rows, groups, distinct values, how two files differ | a filtered or converted copy | 19/19 |
| deps | [temet-ai/ask-kit-deps](https://github.com/temet-ai/ask-kit-deps) | a library-docs agent, a dependency-audit skill | which version of a package is installed and why; what is outdated or vulnerable; how to call an installed package, from its own files; for npm, Python, Cargo and Go | | |
| procs | [temet-ai/ask-kit-procs](https://github.com/temet-ai/ask-kit-procs) | runs of `ps`, `lsof` and `top` | what holds a port; what uses the CPU or memory; whether a program is running; what a session left running | stopping a process | |

Each was also run against real things on the build machine; its README says what. No kit has
had a model run: the benches are shots (`do`), because ask-kit's rule is that model questions
come from real sessions, and the build machine had none. That is the first thing each kit still
needs: five to ten questions from sessions that dug by hand, then `ask-kit kit test <name>`.

## In progress

| Kit | Replaces | Answers |
|---|---|---|
| net | runs of `dig`, `curl -v`, `openssl s_client`, `lsof -i` | what a name resolves to; whether a host and port answer; what a URL returns; when a certificate expires; what listens on a port; why a URL cannot be reached |
| files | runs of `find`, `du`, `stat` | where a file is; what uses the space; what changed in a folder; which documents mention something; what a PDF, office file or archive holds |
| logs | `tail`, `grep` and `sort \| uniq -c` over log files | which errors happen most and which are new; when one first appeared; what happened around a time or request id |
| api | an MCP server or SDK per HTTP API | anything one API with an OpenAPI document can tell or do |
| notes | a second-brain skill | what I wrote or decided about something; open tasks; backlinks and tags; a daily note (has a manifest and scripts; still needs a README, RECIPE, API file, instructions and bench) |
| shell | scrolling the terminal | what command I ran for something; where an alias or variable is set; why the wrong program is first on PATH |

## Next

Ranked by how often the question comes up, with what holds each back.

| Kit | Answers | Held back by |
|---|---|---|
| k8s | pods and why one crashes, rollouts, events, logs, what changed; secrets refused as in the docker kit | no cluster on the build machine: needs a fake `kubectl` fixture and a first run on a real cluster |
| launchd | the systemd kit's questions on macOS: is a service loaded and running, its logs, what runs at login | needs a Mac to build and prove |
| toolchain | what is installed, which version, from where (brew, apt, mise, npm -g, cargo, uv), which copy wins | overlaps the shell kit's PATH answer: build after shell settles |
| gitlab | the github kit's questions through `glab` | needs a GitLab project |
| cloud (aws, gcloud) | what runs, what it costs, why a deploy failed | credentials everywhere: needs a careful reading allowlist, and an account to prove it |
| issue trackers and chat (Linear, Jira, Slack, Notion) | tickets and threads | each is a manifest over its MCP server (`kind = "mcp"`), which needs the server and a token to prove; the api kit covers those with an OpenAPI document today |
| mail and calendar | what is on today, what did someone send | accounts, and privacy rules worth a design note first |
| terraform | what a plan changes, what state holds, drift | state holds secrets: needs redaction rules first |

## What each kit needs before its own repository

1. A repository `temet-ai/ask-kit-<name>` with the topic `ask-kit` (the folder as its root).
2. Bench questions from real sessions and one `kit test` run; its README's "How well it works"
   and its RECIPE's "Results" then get real numbers.
3. A line in the table of `docs/user-guide/kits.md`.
4. A run on macOS, and on Windows for the kits that claim it (tests, web, data, sqlite, deps).

## Noticed about the host while building these

- A module's `make()` gets no state folder, so every kit that keeps state (tests' runs, web's
  page cache) works out ask-kit's state path itself. A `stateDir` in `make()`'s argument would
  remove that copy.
- A kit's server does not start in the agent's folder, so every kit about "this project" or
  "this folder" declares the same `WORKDIR` setting with a `detect` that prints the folder. A
  built-in for it (`${CALLER_DIR}`) would save the boilerplate.
- `kit install` takes a repository or a folder, and a folder of kits installs as a pack, but
  not `owner/repo/subdir`. With that, kits could ship from one repository.
- A bench question whose script throws counts as failed, so refusals cannot be benched. An
  `expectError` pattern on a `do` question would let a kit prove its refusals in its own bench.
- Many kits now share words (`tables`, `ports`, `logs`). Routing between neighbours rests on
  each `route_hint`; it has not been measured with all of them installed.
