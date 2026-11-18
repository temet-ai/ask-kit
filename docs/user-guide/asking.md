# Ask a question

After setup, ask your agent in plain words and it calls the tool:

```
ask what we decided about the retry timeout
ask which session changed the CI cache key, and why
ask where the config file is read in this repo
```

The rule `init` installed tells the agent to call `ask` when the answer lies in past work or in
code it has not read yet, instead of grepping and reading files itself.

## What makes a good question

- **Name what you already know.** A date, a project, a branch, a session id, a file. The
  investigator searches narrowly from there instead of reading everything.
- **One question at a time.** Two unrelated questions are two asks.
- **Ask for the evidence you want.** "Which session, and what did it change" gets session ids
  and files back; "is it done" gets a yes or no and the turn it rests on.

Every answer cites what it relied on: a session and turn for transcripts (`codex 5ca1ab1e #12`),
a `path:line` for code. An answer can be wrong in a confident voice, so check the one claim your
next step depends on.

## Follow-ups

Pass `continue: true` and the question goes to the same investigator, which still holds what it
found. The REPL's variables are saved after every cell and restored for the follow-up, so "and
what happened after that?" does not start the search again.

Use a follow-up to dig into something the answer named, or to finish an answer that stopped
short. Start a new ask for an unrelated question.

## Choosing the investigator

One `ask` serves every enabled domain. When the call does not say which, a router picks one: a
one-word call to the cheap router model when one is set, otherwise keyword rules. The agent can
name it with `about` (`sessions` or `code`, or a domain you added). A follow-up goes back to the
investigator that answered last.

From the shell:

```sh
ask-kit ask "which sessions touched the deploy script this week?"
ask-kit ask --domain code "where is the retry timeout set?"
ask-kit ask --continue "and who changed it last?"
ask-kit ask --backend codex "same question, answered by Codex"
```

## What it can and cannot do

The investigator only reads. Transcripts come through the `history` API; code through ripgrep,
file reads and an allowlist of git subcommands. It cannot edit files, run your tests or reach the
network beyond the model it runs on. When an agent CLI is the investigator, that CLI's own tools
are turned off or sandboxed read-only.
