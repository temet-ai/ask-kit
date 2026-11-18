# ask-kit

ask-kit gives your coding agent one tool, `ask`. The agent asks a question in plain words, a
cheap model does the digging outside the agent's context, and a short answer comes back with the
session, turn or `path:line` it rests on.

It answers about two things:

- **sessions**: your past work, read from the transcripts your agents already write. Claude
  Code, Codex, GitHub Copilot CLI, Gemini CLI and opencode are read; nothing records anything
  new, and there is no server or database.
- **code**: the repository the agent is working in.

An answer looks like this (an illustration of its shape):

```
you:  why did the retry test stop flaking last week?

ask → A Codex session ran the suite, found the retry test's timeout was too tight for CI and
      widened it in test/retry.test.js (codex 5ca1ab1e #12, #19). A Claude Code session the next
      day confirmed the suite passed ten runs in a row (claude-code d15c0de1 #7).
      [sessions · glm-5.3-flash · 16s · $0.0022]
```

The last line says which investigator answered, which model, how long it took and what it cost.
The ids in brackets are there so you, or the agent, can check a claim rather than trust it.

## Why one tool

When an agent looks into old work by itself, every search result and every file it reads lands
in its own context, and stays there for the rest of the session. ask-kit moves that work behind
one tool call: the agent pays for the question and the answer, and the investigator throws away
everything it read on the way.

## Where to start

- [Set it up](setup.md): one line pasted into the agent you already use.
- [Ask a question](asking.md): what to ask, follow-ups, and choosing the investigator.
- [Choose the model that digs](models.md): an API key, a subscription you already pay for, or a
  local model.
- [How it works](how-it-works.md): the REPL, the scripts, warm sessions and the journal.

## Status

Early, and built on one machine. Tested on Linux against real transcripts; fixtures for all five
transcript formats run in CI on Linux, macOS and Windows. The Gemini CLI reader follows Gemini's
documented session format but has not read a real store yet, and the opencode and Gemini install
formats have not been checked on a real install. There are no releases yet: install from `main`.

ask-kit grew out of mike-ask, which does the same over the traffic recorded by
[mike](https://github.com/temet-ai/mike). ask-kit needs neither.
