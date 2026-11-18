# Use it

Mostly you don't call `ask` at all. You give your agent its task as usual. Setup installed a
rule that makes the agent call `ask` whenever it needs to find something out, instead of
searching and reading files in its own context. It reads the files itself once it's about to
edit them.

You can also ask directly. Starting your message with "ask" makes sure the agent uses the tool.

## Ask about the code

The code is the repository the agent is working in, as it is now.

| You want to | Type |
|---|---|
| Find where something lives | `ask where the retry timeout is set` |
| Find what controls it | `ask which settings and env vars change how uploads are retried` |
| Follow the calls | `ask what calls loadConfig, and from where` |
| See how something is done here | `ask how the other exporters are built and registered` |
| Find when it changed | `ask when the cache key format last changed, and in which commit` |

## Ask about past work

Past work means what your agents did in earlier sessions, in Claude Code, Codex, Copilot CLI,
Gemini CLI or opencode.

| You want to | Type |
|---|---|
| Pick up where you left off | `ask what I was doing on the billing branch yesterday, and what was left` |
| Find a decision and why | `ask what we decided about the retry timeout, and why` |
| Find who changed something | `ask which session changed the CI cache key, and what else it changed` |
| See what another agent found | `ask what the Codex session on Tuesday found about the flaky login test` |
| Get back a command | `ask what command I used to seed the dev database last week` |

If a question is about why the code changed, it is about past work, so it goes to sessions.

## Ask about anything else

Every domain you add is another thing your agent can ask about without loading it into its own
context. See [Domains](domains.md).

## Read the answer

```
ask → A Codex session found the retry test's timeout was too tight for CI and widened it in
      test/retry.test.js (codex 5ca1ab1e #12, #19).
      [sessions · glm-5.3-flash · 16s · $0.0022]
```

- `codex 5ca1ab1e #12` is the agent, the session and the turn the claim comes from. Code answers
  cite `path:line`.
- The last line shows the investigator that answered, its model, how long it took and what it
  cost.
- An answer can be wrong and still sound sure. Check the one claim your next step depends on,
  for example `ask to quote turn #12 of that session`.

## Follow up

A follow-up goes to the same investigator. It still has everything it found, so it doesn't
search again and is quicker and cheaper than a new question.

```
you:  ask which sessions worked on the deploy script this week
ask → Three: ...
you:  follow up: what did the second one change, exactly?
you:  follow up: and did anyone test that change?
```

Say "follow up" and the agent passes `continue: true`. If the answer ends with
`[answered at the step limit ...]`, follow up with `carry on`.

For an unrelated question, start a new ask.

## Get better answers

- **Say what you already know**: a date, a branch, a file, a session id. The search starts there
  instead of reading everything.
- **One question per ask.** Two questions get two asks.
- **Say what you want back**: "which session, and what did it change" gets ids and files; "is
  it done?" gets yes or no and the turn that shows it.

## Choose the investigator or model

Usually you don't. A router picks sessions or code from the question, and setup chose the
model. To choose anyway, say so:

```
ask the code investigator where the retry timeout is set
ask with codex as the backend: which session changed the cache key?
```

The agent passes `about` (the investigator) or `backend` (the model).

## From the shell

```sh
ask-kit ask "which sessions touched the deploy script this week?"
ask-kit ask --domain code "where is the retry timeout set?"
ask-kit ask --continue "and who changed it last?"
ask-kit ask --backend codex "which session changed the cache key?"
```

## More examples

- [Write code with it](use-coding.md)
- [Search code and past work](use-searching.md)
- [Pick up where you left off](use-resuming.md)
- [Make it better](tuning.md)

## What it can't do

The investigator only reads: transcripts, files, ripgrep, and some git commands that only read.
It can't edit files, run your tests or reach the network, apart from the model it runs on.
