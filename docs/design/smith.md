---
title: smith - the kit that builds kits
status: draft
created: 2026-11-18
updated: 2026-11-18
summary: smith is an ask-kit kit whose sources are the machine, the agents' transcripts, the journals and the kits folder. It finds where agents keep digging with no kit to ask, proposes a kit with the real questions it would have answered, builds it, tests it against those questions, installs it and keeps improving it. ask-kit grows its own kits from what agents actually do.
session_id:
  - 4e289079-da5f-498b-bd4d-facad52bf096
---

# smith: the kit that builds kits

Read [kits.md](kits.md) first. smith is an ordinary kit. What it knows about is kits, and what it
does is make them.

## What it does

| You or an agent ask | smith |
|---|---|
| "make a kit for our Jira" | Finds the source (an MCP server in an agent's config, the `jira` CLI on PATH, or the REST API with a token in the environment). Writes the manifest, mines real Jira questions from past sessions as the bench, tests, and installs once the bench passes. |
| "what should have a kit?" | Ranks the places agents dig with no kit to ask: the source, how many sessions, the tokens spent, and five real questions from the transcripts |
| (on a schedule, without being asked) | The same ranking. It proposes the top gap with its evidence. It never installs a kit that changes things without a yes. |
| "why is the herdr kit slow / wrong?" | Reads that kit's journal and bench, fixes the instructions, a script or an action, and proves the fix on the bench (today's `ask-kit-tuner`, for every kit) |
| "this kit answers two kinds of question" | Splits it in two, each with its own `says` and bench, so the router can tell them apart |

The system grows the way agents became good. They wrote their own tools; here the tools also
write themselves.

## Its sources

```toml
id = "ask-kit.smith"
name = "smith"
says = "kits themselves: make a kit for a tool, service, API or folder; which tools need a kit; why a kit answers badly; improve, split or retire a kit"

[[sources]]
kind = "folder"        # the kits, read and written
name = "kits"
path = "${ASK_KIT_CONFIG}/kits"

[[sources]]
kind = "cli"           # kit new / link / test / install
name = "askkit"
command = ["ask-kit"]

[[sources]]
kind = "transcripts"   # what agents actually did: the questions behind the digging
name = "history"

[[sources]]
kind = "module"        # the machine and the journals
name = "machine"
module = "machine.mjs"

acts = ["askkit.kit.link", "askkit.kit.install", "kits.write"]
```

`machine` reads without printing secrets:
- the CLIs on PATH, with their `--help`;
- the MCP servers configured in each agent (`~/.claude.json`, Codex, Copilot, opencode configs);
- environment variable **names** that look like credentials, never their values;
- `llms.txt` and OpenAPI documents of services the transcripts mention;
- every kit's journal.

## Its scripts

| Script | Does |
|---|---|
| `gaps` | Finds lookup chains in the transcripts: runs of search, read and CLI calls that ended in an answer, grouped by the source they hit (a CLI, an API host, a folder, an MCP server). It keeps the chains no kit was asked about and ranks them by sessions and tokens. mike-ask's `lookup-chains` and `areas` already measure this over mike's capture. |
| `discover <tool>` | What the machine has for a tool: CLI, MCP server, API with docs, credentials present |
| `mine <source>` | Real questions about the source from the transcripts. The answer each chain reached becomes the expected answer, with the transcript it came from. |
| `scaffold` | `ask-kit kit new --from ...`, then `says` and `instructions.md` drafted from the mined questions, not from guesses |
| `prove` | `ask-kit kit test` on the mined bench once, on the default backend, and only when the operator asks for that run; each answer is judged against what the agent found by hand. Failures change the instructions once, as added, changed or removed lines each tied to the question it fixes (a whole-file rewrite each time loses detail), logged in `instructions.changes.md`; nothing is re-run, because the kit's real use is the next measure. Built: `ask-kit smith prove`. |
| `tune <kit>` | Takes the journal's flagged asks (failed, out of steps, re-asked, slow), finds which layer caused each and fixes it there. It doesn't rerun the bench; the kit's real use after the fix is the measure |
| `promote` | Scripts that investigators keep running unchanged become `[[actions]]` (answers with no model call). Drafts that keep being rewritten become scripts. |
| `split` / `retire` | Splits a kit whose routed questions fall into two clusters. Retires a kit nobody has asked in N weeks, after asking. |

## The bench comes from what really happened

A kit's test questions are the questions agents really asked and dug for. Each expected answer is
what the digging found, cited to the session. So a kit is built against real use and judged on it.
After install, the same chains show whether agents now ask the kit instead of digging.

## The measure

One number for the whole system: **coverage**, the share of lookup chains in the transcripts
that went to `ask` rather than being dug by hand, weighted by tokens. `gaps` reports it every run.
smith works on whatever lowers it most.

Per kit: the bench score, time and price on each backend, and the change in that source's
digging after install.

## Safety

- smith builds in a staging folder and links a kit only after `prove` passes.
- A kit that lists `acts` is installed with its actions off until the operator says yes. Read-only
  kits install on a pass.
- smith never prints a credential's value; it only checks that the variable exists.
- It shows every manifest it writes, and the install preview from kits.md applies to it.

## smith on smith

smith has a bench too: "build a kit for X" tasks over sources with known questions (a folder, the
`gh` CLI, an MCP server, an OpenAPI service). It passes when the built kit passes its own mined
bench. `tune smith` improves the builder the same way it improves any kit.

## Order

1. `gaps` and `mine` over the sessions source. They answer "what should have a kit?" with
   evidence. They need only today's ask-kit.
2. `scaffold` and `prove`, once the manifest and `kit new` / `kit test` exist (kits.md steps 1-3).
   First targets, from where the digging is: `herdr` (CLI plus llms.txt), `gh`, and mike's own MCP.
3. `tune` and `promote` replace `ask-kit-tuner` and the `ask-kit-improve` skill.
4. The scheduled run that proposes the top gap.
