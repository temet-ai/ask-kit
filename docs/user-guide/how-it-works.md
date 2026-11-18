# How it works

Your agent makes one tool call with a question and gets back one answer. The programs the
investigator writes, their intermediate results and the files they read all stay in the
investigator's own session, so none of them enter your agent's context. The investigator is a
cheap, fast model that starts from ready-made scripts and extends them. A follow-up reuses what
has already run, because the REPL's variables are still there
([Saved state for follow-ups](#saved-state-for-follow-ups)).

![Your agent sends one question; the investigator writes small programs for it in its own context, reaching code, sessions and your own domains, and returns a short answer with path:line evidence](images/how-an-ask-works.svg)

## Each step is a small JavaScript program

For each step of a question, the investigator writes a small piece of JavaScript and runs it in a
REPL. The program loops over files, joins one search with another, counts, compares, parses and
filters, then prints only the result. Each program is written for the question in front of it.

For "which exporters have no test, and are they all registered?" it might write:

```js
const name = (f) => f.split("/").pop().replace(/(\.test)?\.ts$/, "");
const exporters = (await repo.files("src/export/*.ts")).map(name)
  .filter((n) => n !== "index" && n !== "base");
const tested = new Set((await repo.files("test/export/*.test.ts")).map(name));
const registry = repo.read("src/export/index.ts").text;

exporters.map((n) => ({ exporter: n, tested: tested.has(n), registered: registry.includes(n) }));
```

That is one step. Done with separate tool calls, it would be a file listing, a second listing, a
file read and a comparison done in the model's head, each in its own round trip, with each
result added to the context.

What the programs can reach comes from the domains:

- `repo` for code: `rg` (ripgrep), `files`, `read`, and some git commands that only read,
- `history` for your past sessions, across every agent's transcripts,
- `scripts` for ready-made programs for common questions,
- helpers such as `table`, `top`, `groupBy` and `countBy`,
- and whatever a domain you add provides.

Each domain lists what it provides in a typed file, `api.d.ts`.
[Domains](domains.md) shows how to write one.

## Scripts for the common questions

| Domain | Scripts |
|---|---|
| code | `where`, `knobs`, `history`, `outline`, `overview` |
| sessions | `find-sessions`, `session-digest`, `grep`, `session-tools`, `session-changes`, `recent` |

When the investigator writes something useful by hand, it can save it as a draft script.
[Make it better](tuning.md) shows how to turn a draft into a script.

## How the investigator is chosen

Each domain has its own investigator. Your agent can name one with `about`. A follow-up goes to
the investigator that answered last. Otherwise a router picks one from the question, with one
short call to the cheap model or with keyword rules.

## Loading a domain once

A domain's instructions, `api.d.ts` and scripts are the same for every question, so they are
loaded once:

- With Claude Code or Codex as the investigator, ask-kit starts one session with them loaded
  and copies it for each question.
- With an API, the provider caches them.

If you edit the instructions, a script or `api.d.ts`, the next question loads them again.
Nothing needs restarting.

## Saved state for follow-ups

The REPL's variables are saved after every cell. A follow-up (`continue: true`) restores them,
so the investigator carries on from what it found. Each of your agent's sessions has its own
saved state.

## The journal

Every ask and every cell is logged under `~/.local/state/ask-kit/` with time, cost, steps and the
scripts it used. `ask-kit report` reads it, and it's how you [make it better](tuning.md).

## What the investigator can read

It reads transcripts and files, and runs ripgrep and git commands that only read. When an agent
CLI is the investigator, that CLI's own tools are turned off or limited to reading.

## In the code

[Map of the code](internals/README.md) lists every source file and a reading order.
[Life of one ask](internals/ask-lifecycle.md) follows one question through the router, the
backend and the REPL, with the functions and limits involved.
