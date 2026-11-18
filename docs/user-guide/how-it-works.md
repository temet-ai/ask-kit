# How it works

The calling agent pays for one tool call and the answer. Everything below happens behind the
tool, in a context the calling agent never sees.

## An investigator with a REPL

The investigator does not get a pile of tools. It gets one: a JavaScript REPL running in a Node
`vm`, which holds the domain's API (`history` over transcripts, `repo` over code), a small
toolkit and ready-made scripts. It writes cells. One cell can search, filter and join what would
otherwise be a dozen tool round-trips, and only what the cell prints comes back to the model.

The API is described to the model in a typed file, `api.d.ts`, which it reads like any
programmer would.

## Scripts for the common questions

Most questions are variations on a few. Each domain ships scripts for those:

- sessions: `find-sessions`, `session-digest`, `grep`, `session-tools`, `session-changes`,
  `recent`
- code: `where`, `knobs`, `history`, `outline`, `overview`

The investigator runs a script instead of writing the same search again. When it builds
something useful by hand, it can save it as a draft script, which you can promote later (see
[Tune it from the journal](tuning.md)).

## Warm once, fork per question

The instructions, the API and the scripts are the same for every question, so they are built
into a fixed prefix once:

- with Claude Code or Codex as the investigator, a warm session is made once and each question
  forks it;
- with an API, the provider's prompt cache serves the same prefix.

The prefix is fingerprinted. Edit the instructions, a script or the API and the next question
warms a new one. Tuning is a file edit; nothing needs restarting.

## Follow-ups keep their state

REPL variables are saved after every cell. A follow-up (`continue: true`) goes back to the same
investigator and restores them, so it can carry on from what it found instead of searching
again. Each asking session has its own saved state; one session's follow-up never sees another's
variables.

## Reading every agent's transcripts

Each agent writes its sessions to disk in its own format. ask-kit has a reader for each (Claude
Code, Codex, Copilot CLI, Gemini CLI, opencode) and builds one index over them, so `history`
answers across all of them at once and every answer names the agent with the session id.

## The journal

Every ask and every cell is logged under `~/.local/state/ask-kit/` with its time, cost, steps and
the scripts it used. `ask-kit report` reads it. That is what you tune from.
