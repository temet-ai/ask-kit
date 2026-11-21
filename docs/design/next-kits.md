# Choosing the next kits

The kits in the table in [kits.md](../user-guide/kits.md) from tests to api were built together on
a branch in November 2026, then each moved to its own repository. These are the notes kept from
that work: how a kit was chosen, what comes next, and what the host could do better.

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

## Next

Ranked by how often the question comes up, with what holds each back.

| Kit | Answers | Held back by |
|---|---|---|
| k8s | pods and why one crashes, rollouts, events, logs, what changed; secrets refused as in the docker kit | no cluster on the build machine: needs a fake `kubectl` fixture and a first run on a real cluster |
| launchd | the systemd kit's questions on macOS: is a service loaded and running, its logs, what runs at login | needs a Mac to build and prove |
| toolchain | what is installed, which version, from where (brew, apt, mise, npm -g, cargo, uv), which copy wins | overlaps the shell kit's PATH answer: build after shell settles |
| cloud (aws, gcloud) | what runs, what it costs, why a deploy failed | credentials everywhere: needs a careful reading allowlist, and an account to prove it |
| issue trackers and chat (Linear, Jira, Slack, Notion) | tickets and threads | each is a manifest over its MCP server (`kind = "mcp"`), which needs the server and a token to prove; the api kit covers those with an OpenAPI document today |
| mail and calendar | what is on today, what did someone send | accounts, and privacy rules worth a design note first |
| terraform | what a plan changes, what state holds, drift | state holds secrets: needs redaction rules first |

## What each kit still needs

1. Bench questions from real sessions and one `kit test` run; its README's "How well it works"
   and its RECIPE's "Results" then get real numbers.
2. A run on macOS.

## Noticed about the host while building these

- A module's `make()` gets no state folder, so every kit that keeps state (tests' runs, web's
  page cache) works out ask-kit's state path itself. A `stateDir` in `make()`'s argument would
  remove that copy.
- A kit's server does not start in the agent's folder, so every kit about "this project" or
  "this folder" declares the same `WORKDIR` setting with a `detect` that prints the folder. A
  built-in for it (`${CALLER_DIR}`) would save the boilerplate.
- A bench question whose script throws counts as failed, so refusals cannot be benched. An
  `expectError` pattern on a `do` question would let a kit prove its refusals in its own bench.
- Many kits share words (`tables`, `ports`, `logs`). On 2026-11-21, with 36 kits installed, keyword
  routing offered the router model the intended kit for 94 of 94 boundary questions, and sent 80
  of them to it outright. The npm kit was folded into tests and deps to remove the largest overlap.
