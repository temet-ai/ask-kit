# Pick up where you left off

A new session knows nothing about yesterday's. `ask` reads yesterday's sessions for it.

## Start of the day

```
ask what I worked on yesterday, and what was left unfinished
```

Then narrow it down:

```
follow up: what was the last thing the billing session tried, and did it work?
follow up: which files did it change that aren't committed?
```

## Taking over another agent's work

When a Codex or Copilot session did the first half, a Claude Code session can do the second:

```
ask what the Codex session this morning did on the search index, what it decided, and what it left to do
```

The answer cites that session's turns, so the new agent can check the details before going on.

## After a break of weeks

```
ask to summarise all work on the importer since October: what was built, what was dropped, and why
```

## Handing work to someone else

The same question gives you a short handover note:

```
ask for a handover of the auth refactor: what's done, what's open, which sessions and commits
```
