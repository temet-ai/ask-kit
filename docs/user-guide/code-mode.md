# How ask-kit relates to code mode, recursive language models and subagents

Source:
[`src/server.mjs`](https://github.com/temet-ai/ask-kit/blob/main/src/server.mjs) (the REPL and its globals),
[`src/kitcall.mjs`](https://github.com/temet-ai/ask-kit/blob/main/src/kitcall.mjs) (`ask.kit`) and
[`src/ask.mjs`](https://github.com/temet-ai/ask-kit/blob/main/src/ask.mjs) (the backends).

## Code mode

In Anthropic's [Code execution with MCP](https://www.anthropic.com/research/code-execution-with-mcp)
and Cloudflare's Code Mode, the agent writes code that calls the tools, keeps their results in
variables and returns one value to the model. WorkOS's write-up of
[Cloudflare's results](https://workos.com/blog/cloudflare-code-mode-cuts-token-usage-by-81)
reports a demo where Code Mode used 32% fewer tokens than direct tool calls to create one
calendar event, and 81% fewer to create 31.

In code mode the agent you're working with writes the code. In ask-kit a separate investigator
writes it, on the model set for the domain, and your agent only sends the question and gets the
answer back. The investigator writes a program for each step in front of it: it loops, filters,
joins and counts over the domain's data, and what it prints is all that returns to the
investigator's model. The example in
[How it works](how-it-works.md#each-step-is-a-small-javascript-program) is one program that
stands in for two file listings, a file read and a comparison. With separate tool calls, each of
those is its own round trip and its result joins the context.

Your agent makes a single `ask` call, and the investigator's whole session, programs and results
included, runs in the investigator's context. The README's
[context, time and cost per ask](../../README.md#context-time-and-cost-per-ask) has the
measurement: over 105 real asks to mike-ask, the medians per ask were 125,025 tokens worked
through by the investigator, about 445 sent back to the calling agent, 36 seconds and $0.011.
mike-ask is the proof of concept ask-kit grew from, so these figures are not from ask-kit itself.

## Recursive language models

Zhang, Kraska and Khattab, [Recursive Language Models](https://arxiv.org/abs/2512.24601)
(arXiv 2512.24601), keep a long input outside the model's context, in a REPL. The model writes
code to inspect and split the input and calls language models on the pieces. Their aim is inputs
far longer than a model's context window, and avoiding context rot, the decline in a model's
answers as its context fills.

ask-kit shares the first part. The data (transcripts, a repository, whatever a domain provides)
stays outside the model's context, and the model writes programs that read it through globals
such as `repo` and `history`.

The REPL's globals in [`newContext`](https://github.com/temet-ai/ask-kit/blob/main/src/server.mjs)
are the domain's own, `scripts`, `tk`, the toolkit helpers, `console` and `ask`. Only
`ask.kit(name, question, { continue })` is there to reach a model. It asks another enabled kit's
investigator, a whole investigation with its own REPL and backend, and returns that kit's answer
text. Nothing in ask-kit lets a program call a model on a slice of the data the way an RLM does.
(`repo.run` in the code domain runs any program, so a model CLI could be started from it, but no
script does that.) A program cannot ask its own kit. A kit started by `ask.kit` cannot call
`ask.kit` itself: `MAX_DEPTH` in
[`src/kitcall.mjs`](https://github.com/temet-ai/ask-kit/blob/main/src/kitcall.mjs) is 1, and a
call beyond it throws. [Ask another kit from a REPL cell](kits.md#ask-another-kit-from-a-repl-cell)
describes the call and its journal entry.

## Claude Code subagents

A Claude Code subagent also keeps a search out of the main agent's context. Where `ask` differs:

- A subagent runs on a Claude model. Each ask-kit domain picks its own backend with
  `domains.<name>.backend` in the [config](reference/config.md): an API model such as glm or
  deepseek, a Claude Code, Codex or Copilot CLI session, or a local model
  ([Choose the model](models.md)).
- A domain brings ready-made scripts for its common questions, such as `where` and `outline` for
  code and `find-sessions` and `session-digest` for sessions
  ([How it works](how-it-works.md#scripts-for-the-common-questions)).
- A follow-up (`continue: true`) restores the investigator's REPL variables, so its programs carry
  on from the values the last answer computed
  ([Saved state for follow-ups](how-it-works.md#saved-state-for-follow-ups)).
- `ask` is an MCP server, so any of Claude Code, Codex, GitHub Copilot CLI, Gemini CLI and
  opencode can call it, and it reads the transcripts all five write. The
  [README](../../README.md#status) says which of these have been tried on a real install.

More on the REPL: [The REPL](internals/repl.md).
