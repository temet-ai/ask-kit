# Search your past Claude Code, Codex, Copilot CLI, Gemini CLI and opencode sessions

Source:
[`src/transcripts/`](https://github.com/temet-ai/ask-kit/blob/main/src/transcripts) (one adapter per agent) and
[`domains/sessions/`](https://github.com/temet-ai/ask-kit/blob/main/domains/sessions) (the sessions domain and its scripts).

## Where each agent keeps its sessions

Every one of the five agents saves its sessions on your machine:

| Agent | Where | Format |
|---|---|---|
| Claude Code | `~/.claude/projects/<encoded cwd>/<session id>.jsonl` (`CLAUDE_CONFIG_DIR` moves `~/.claude`) | JSONL, one file per session |
| Codex | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`, and `~/.codex/archived_sessions/` (`CODEX_HOME` moves `~/.codex`) | JSONL, one file per session |
| GitHub Copilot CLI | `~/.copilot/session-state/<session id>/events.jsonl` (`COPILOT_HOME` moves `~/.copilot`) | JSONL, one file per session |
| Gemini CLI | `~/.gemini/tmp/<project hash>/chats/session-*.json` (`GEMINI_CLI_HOME` moves `~/.gemini`) | one JSON document per session |
| opencode | `~/.local/share/opencode/opencode.db` (`XDG_DATA_HOME` moves `~/.local/share`; `OPENCODE_DB` names another file) | one SQLite database |

The Gemini CLI path follows Gemini's documentation. ask-kit's reader has not been tried on a real
Gemini install yet (see [Status](../../README.md#status)).

You can `grep` the JSONL files for a word. That works for a command or an error message you
remember exactly. It gets unwieldy when the question is about meaning, like what was decided
about pagination and why. The words differ from session to session, and a hit is one line of
JSON without the messages around it. Each agent writes its lines in its own format too. Gemini
CLI keeps JSON documents and opencode keeps a SQLite database, so those two need a JSON or SQL
query.

## Ask for it

`ask-kit` gives your agent one tool, `ask`. Its sessions domain reads all five agents' sessions
and answers a question in plain words with the sessions it came from. Your agent can call it for
you, or you can start your message with "ask":

```
ask what the Codex session on Tuesday found about the flaky retry test
```

An answer cites its sources as agent, session id and event number. This block is the made-up
example from [Use it](asking.md#read-the-answer), to show the format.

```
ask → A Codex session found the retry test's timeout was too tight for CI and widened it in
      test/retry.test.js (codex 5ca1ab1e #12, #19).
```

`codex 5ca1ab1e #12` is the agent, the first 8 characters of the session id and the number of
the event in that session (a message, tool call or tool result). To check a claim, follow up
with `ask to quote event #12 of that session`.

## What it costs

These are from the README's
[table](../../README.md#context-time-and-cost-per-ask), measured on 18 November 2026 on one
machine with about 1,500 sessions on disk:

| Question | Investigator | Time | Cost |
|---|---|---|---|
| What did a Codex session find and change | glm-5.3-flash (OpenRouter) | 16 s | $0.0022 |
| Which sessions worked on X in the last week | glm-5.3-flash, domain picked by the router | 53 s | $0.0083 |
| Follow-up on that (`continue: true`) | glm-5.3-flash | 17 s | $0.0035 |

The investigator writes small programs that read the transcripts in its own REPL. Only what a
program prints reaches the investigator's model, and only the answer reaches your agent. The
README's medians over 105 real asks to mike-ask, the proof of
concept ask-kit grew from, are 125,025 tokens worked through by the investigator and about 445
sent back to the calling agent.
[How it works](how-it-works.md) describes the programs and the ready-made scripts for sessions
(`find-sessions`, `session-digest`, `grep`, `session-tools`, `session-changes`, `recent`).

## Questions that work

[Search code and past work](use-searching.md#search-past-sessions) lists questions by what you
are looking for: a command, an error, a decision, every session on a topic, what one session did.
[Pick up where you left off](use-resuming.md) covers the start of a day, taking over another
agent's work and handovers. Giving a date, a branch, a project or an agent in the question makes
the search faster and cheaper.

## From the shell

Without an agent, ask from a terminal:

```
ask-kit ask --domain sessions "which sessions worked on the payment webhook in the last week?"
```

Add `--continue` to follow up on the last answer.

## Set it up

Paste this into the agent you already use:

```
Read https://github.com/temet-ai/ask-kit/blob/main/AGENTS.md, then set up ask-kit for me.
```

It installs ask-kit and asks which model does the digging. Restart your agents afterwards.
[Set it up](setup.md) has the details.

## Related

- [What it stores and sends](privacy.md)
- [Transcript adapters](internals/transcripts.md): how each agent's sessions are read.
