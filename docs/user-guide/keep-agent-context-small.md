# Keep your coding agent's context from filling up with searching

Source:
[`src/server.mjs`](https://github.com/temet-ai/ask-kit/blob/main/src/server.mjs) (the investigator's REPL) and
[`src/ask.mjs`](https://github.com/temet-ai/ask-kit/blob/main/src/ask.mjs) (the backends).

## What fills the context

Before a coding agent changes anything, it finds things out: it searches the repository, opens
files, follows calls and checks what was tried before. Each search result and each file it reads
stays in its context until the agent compacts the conversation or clears old tool results. Claude
Code does both on its own, and until then the work the agent was asked to do
shares the window with everything it looked at on the way.

## The usual remedies

- Subagents: the agent hands a search to a subagent. The subagent reads in its own context
  and returns a summary. See [how this compares to `ask`](code-mode.md#claude-code-subagents).
- Compaction: the agent summarises the conversation so far and carries on from the summary.
  It frees space, and the detail left out of the summary is no longer in the context.
- Clearing old tool results: Claude Code can drop the output of earlier searches and file reads
  from the context while keeping the conversation. Those results are no longer there for later
  turns, so the agent runs the search or opens the file again if it needs it.
- `/clear`: a new context for a new task. What the agent had read is gone, so it reads again
  if the next task needs it.

## Move the finding-out to another model

`ask` is an MCP tool. The agent sends a question in plain words, and a separate investigator
model answers it. The investigator writes small JavaScript programs that read the repository or
your past sessions, and runs them in its own REPL. It sends back an answer with the evidence it
rests on, as `path:line` for code and agent, session id and event number for past work.

This is a follow-up question about ask-kit's own code, from the README's
`ask-from-shell.gif`, trimmed. The ask took 8 seconds and cost $0.0008 on glm-5.3-flash. The last
line is the footer that `"footer": true` in the config adds.

```
$ ask-kit ask --domain code --continue "and where is that adapter registered?"

Answer: In the adapter table in src/transcripts/index.mjs:

- Imported: import { adapter as codex } from "./codex.mjs"; — src/transcripts/index.mjs:4.
- Registered: export const ADAPTERS = Object.fromEntries([claudeCode, codex, copilotCli,
  geminiCli, opencode].map((a) => [a.name, a])); — src/transcripts/index.mjs:11, keyed by the
  adapter's name (i.e. "codex").

Not found: no dynamic/plugin registration — the five adapters are a hard-coded list at
src/transcripts/index.mjs:11.

[code · glm-5.3-flash · 8s]
```

The files the programs read and the values they compute stay in the investigator's REPL. Only
what a program prints reaches the investigator's model, and only the answer reaches your agent.

## Context, time and cost per ask

The README's
[context, time and cost per ask](../../README.md#context-time-and-cost-per-ask) gives medians
over 105 real asks to mike-ask: the investigator worked through 125,025 tokens, about 445 went
back to the calling agent, and an ask took 36 seconds and cost $0.011. mike-ask is the proof of
concept ask-kit grew from, so these figures are not from ask-kit itself.

ask-kit's own timings, from 18 November 2026 on one machine, are in the same README section.
Asking how routing works in the code domain took 110 s and $0.0033 on deepseek-v4.1-flash.

## What it leaves with the agent

The agent still reads the files it is about to edit, and it writes the change. `ask` is for the
finding-out before that. [Write code with it](use-coding.md) lists the questions to ask before a
change, while fixing a bug and while reviewing a change. A follow-up with `continue: true` goes
to the same investigator, and its programs start from the values the last answer computed
([Saved state for follow-ups](how-it-works.md#saved-state-for-follow-ups)).

## Set it up

Paste this into the agent you already use:

```
Read https://github.com/temet-ai/ask-kit/blob/main/AGENTS.md, then set up ask-kit for me.
```

It installs ask-kit and asks which model does the digging. Restart your agents afterwards, and
the agent calls `ask` when it needs to find something out.

## Related

- [Write code with it](use-coding.md)
- [How it works](how-it-works.md)
- [Code mode, recursive language models and subagents](code-mode.md)
- [Search your past sessions](search-past-sessions.md)
