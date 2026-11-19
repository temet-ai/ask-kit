# ask-kit

[![ask-kit — playful brown stacked wordmark](images/ask-kit-logo.png)](https://github.com/temet-ai/ask-kit)

Most of a coding agent's context goes on finding things out: searching, opening files, following
calls, checking what was tried before. All of it stays in the context and crowds out the work
the agent was asked to do.

ask-kit moves that work out of the agent's context. It gives the agent one tool, `ask`. The agent
asks a question in plain words, and a cheap investigator works it out in its own context. The
agent gets back a short answer with the evidence it's based on, and its own context stays free
for designing, writing and fixing code.

```
you:  add a CSV exporter like the other ones

agent → ask: how are the exporters built and registered, and which tests cover them?

ask   → Exporters implement Exporter in src/export/base.ts:12 and are registered in
        src/export/index.ts:30. JsonExporter (src/export/json.ts) is the closest model;
        tests are in test/export/*.test.ts.
```

The agent reads that three-line answer and starts the change from there. (The exchange above is
an example of what an answer looks like.)

## How the investigator answers

For each step of a question, the investigator writes a small JavaScript program and runs it in a
REPL. The program does whatever the step needs: loops, filters, joins, counts, comparisons,
parsing. It is written fresh for that question. A domain gives the programs access to the data.
What a program prints is all that returns to the investigator's model. Common
questions already have scripts, so it can start from one of those.

![Your agent sends one question; the investigator writes small programs for it in its own context, reaching code, sessions and your own domains, and returns a short answer with path:line evidence](images/how-an-ask-works.svg)

Your agent writes only the question and gets only the answer. The investigator is a cheap, fast
model, and its programs, their intermediate results and the files they read all stay in its
session; a follow-up with `continue: true` reuses what has already run, because the REPL's
variables are still there.

![Median per ask over 105 real asks to mike-ask: the investigator worked through 125,025 tokens, and about 445 went back to your agent; 36 seconds and $0.011](images/context-kept-out.svg)

[How it works](how-it-works.md) goes into more detail.

Each kind of thing `ask` can answer about is a **domain**. A domain gives the investigator's
programs access to its data, and instructions for searching it. ask-kit comes with two, as a
starting point:

- **code**: the repository the agent is working in, cited as `path:line`.
- **sessions**: your past agent sessions, from the transcripts Claude Code, Codex, Copilot CLI,
  Gemini CLI and opencode already save.

[Add your own](domains.md) for anything else your agent keeps digging through: a database, logs,
a service, a docs folder.

## Get started

1. Paste this into the agent you already use (Claude Code, Codex, Copilot CLI, Gemini CLI or
   opencode):

   ```
   Read https://github.com/temet-ai/ask-kit/blob/main/AGENTS.md, then set up ask-kit for me.
   ```

   It installs ask-kit and asks you a few questions. The main one is which model does the
   digging.
2. Restart your agents.
3. Give your agent a task. It calls `ask` by itself when it needs to find something out. You
   can also ask directly: `ask where the config file is read`.

## Guide pages

- [Use it](asking.md): what to ask, reading answers, follow-ups. **Start here.**
- [Set it up](setup.md): what setup does, and how to change it later.
- [Choose the model](models.md): an API key, a subscription you already pay for, or a local model.

Use cases:

- [Write code with it](use-coding.md)
- [Search code and past work](use-searching.md)
- [Pick up where you left off](use-resuming.md)
- [Search your past sessions](search-past-sessions.md): where each agent stores them, and how `ask` finds a decision or a change in them.
- [Keep your agent's context from filling up with searching](keep-agent-context-small.md): what fills an agent's context, the usual remedies, and what `ask` leaves out of it.
- [Make it better](tuning.md): fix the questions it answers badly.

More:

- [Kits](kits.md): teach `ask` about something new: install a shared kit or make one from a folder or a CLI.
- [Domains](domains.md): the older form of a kit.
- [How it works](how-it-works.md)
- [Code mode, recursive language models and subagents](code-mode.md): how ask-kit relates to each.
- [Command line and files](command-line.md)
- [What it stores and sends](privacy.md)
- [Troubleshooting](troubleshooting.md)

How-to guides:

- [Write a domain](guides/write-a-domain.md): a working domain over a folder of notes, step by
  step.
- [Add a script](guides/add-a-script.md), including turning a draft into a script.
- [Debug a bad answer](guides/debug-a-bad-answer.md): from a wrong answer to the fix, using the
  journal.
- [Add a model or provider](guides/add-a-backend.md)
- [Support another coding agent](guides/add-an-agent.md): a transcript adapter and setup.
- [Run the benchmark](guides/run-the-benchmark.md)
- [Run the tests](guides/testing.md)

Reference:

- [Config file](reference/config.md): every key in `config.json`.
- [The ask tool](reference/ask-tool.md): parameters, answers and errors.
- [What the investigator's programs can reach](reference/domain-api.md): globals, helpers and
  every script.
- [Files and environment variables](reference/files-and-env.md)
- [Journal format](reference/journal.md)

Internals, for changing ask-kit itself:

- [Map of the code](internals/README.md): the processes, every source file and a reading order.
- [Life of one ask](internals/ask-lifecycle.md): router, backend, cells, answer and journal.
- [The REPL](internals/repl.md): how cells run, saved state, scripts.
- [Backends](internals/backends.md): APIs, agent CLIs and local models.
- [Domains](internals/domains.md): the domain contract, the two built-in domains, the gallery.
- [Transcript adapters](internals/transcripts.md): how each agent's sessions are read.
- [Setup](internals/setup.md): `init`, `setup`, `apply`, `doctor`, `uninstall` and the files they
  write.

## Status

Early. It has been used on one Linux machine. CI runs on Linux, macOS and Windows. There are no
releases yet, so you install from `main`.

ask-kit started as mike-ask, a proof of concept that answers from what
[mike](https://github.com/temet-ai/mike) records of every Claude Code session. ask-kit is the
general version: it needs no mike and no server, reads what your agents already save, and can
be given any domain.
