# What it stores and sends

## What it sends

- Your question, and the transcript and code excerpts the investigator reads, to the model you
  chose: an API provider, an agent CLI's own service, or a local model server.
- In transcript excerpts (everything `history` returns: events, tool inputs, grep snippets,
  session titles), keys and tokens are masked first: `sk-...`, `ghp_...`, `github_pat_...`,
  `xox...`, `AKIA...`, `AIza...`, `Bearer` and `Basic` values, `NAME=value` where the name holds
  KEY, TOKEN, SECRET or PASSWORD, `"apiKey": "..."`, the password in a `postgres://user:pass@`
  URL and private key blocks ([`src/transcripts/scrub.mjs`](https://github.com/temet-ai/ask-kit/blob/main/src/transcripts/scrub.mjs)).
  Code excerpts are sent as they are; a kit's folder `exclude` keeps credential files out.
- On an API backend, the model's own reasoning from each reply goes back to the same provider
  with that reply on the ask's later calls, as the provider returned it.
- Picking the domain, when the caller did not name one and no pattern did, is one more short call
  to the router's backend (`router.backend`, else the investigator's), with the question, the
  working directory and what each enabled domain answers. On an agent CLI (`claude`, `codex`,
  `copilot`) that call goes to the CLI's provider like any other prompt you send it.
- When you set `escalate` or `hedge` in the config, a slow ask also goes to that second backend:
  the question, and for `escalate` the code of the cells already run with the start of each
  result. A backend's `body` fields go with each of its requests.
- `ask-kit gallery` queries GitHub's search API. `ask-kit doctor` lists each provider's models.

Nothing else. There is no telemetry.

With an agent CLI as the investigator, its questions are sessions of that CLI: the excerpts go to
that CLI's service under its own terms, and the sessions appear in its history.

## What it stores

- Under `~/.config/ask-kit/`: the config, the guide for agents and `keys.env`.
- Under `~/.local/state/ask-kit/`: the journals of every ask and cell (each ask's record says
  whether it could change things, `act`), REPL snapshots, warm investigator sessions and the
  transcript index. The router keeps each routed question, and in
  `router/bench.jsonl` every misrouted question with where it went and where it should have gone.
  For follow-ups, `warm/last-<caller>.json` holds the last conversation with each backend (with
  the model's reasoning on an API backend), and for
  an agent that takes tasks `warm/threads/` holds one per ask for a day; `router/threads-<caller>.json`
  lists the asks that became tasks, each with the first 80 characters of its question.
  `<session>.quotes.json` beside each REPL snapshot holds the rows the investigator kept with
  `quote` for its answer to quote word for word.
  An ask's row also holds how many of the answer's citations resolved and up to ten that did not
  (`path:line`, or source, session and event). The check reads local files and transcripts, and
  calls no model.
- A script result with an explicit `review` stores its status (`pass`, `needs_review` or
  `unverified`), up to eight warnings of 300 characters each and notes of up to 300 characters.
  Cell records name their calling session when available. These fields are kept with trajectories
  off; the full result is not. Background kits can append `outcome` records with job id, caller,
  execution status, duration and the same review summary, without prompts or images.
- `ask-kit improve <kit> --record <file>` keeps the agent’s per-kit review under
  `improvements/<kit>.jsonl`: window, outcome, summary, journal paths and timestamps or
  chain ids, changed paths, check commands and reported results, and commit. The command makes no model calls and
  does not run the listed checks. Review records should stay outside public repositories.
- With `machines` in the config, `ask-kit improve` copies those machines' journals, action logs and
  review records over ssh to `~/.local/state/ask-kit/machines/<host>/`, and their lookup chains with
  the first 200 characters of each prompt and up to 600 of what was answered after. Nothing else
  is sent or fetched. `ask-kit improve --label` sends each chain's prompt (200 characters), area, shell
  descriptions, 500 characters of what was answered after, the ask before it and how the turn ended to
  the `labeller` (by default your own Claude login). A review record also holds each chain's question, cause and answer.
- With `journal.trajectories: true` in the config (off by default), those journals also hold each
  cell's printed result, cut at 4,000 characters, and each answer, cut at 8,000: excerpts of
  what the investigator read. `ask-kit doctor` says whether it is on.
- In `~/.local/state/ask-kit/actions/`: each question a kit's action answered or tried, with the
  params it ran the script with. For a shadow run (one action answer in 20), both answers are
  kept in full up to 4,000 characters each; this is the only place ask-kit keeps an answer's
  text. The shadow run sends the question to the kit's model, as any ask does.
  `actions.shadowEvery: 0` in the config stops it.
- `ask-kit gaps` keeps the lookup chains and asks it found in each session in
  `~/.local/state/ask-kit/index/gaps.json`: time, kit, area, token count, the first 200
  characters of the prompt, up to six descriptions the chain's shell calls carried (120 characters
  each) and the id of the ask made earlier in the turn. `ask-kit improve` reads it and prints, for
  up to 30 chains of a kit, what the agent answered after. It sends nothing.
- With the Claude Code plugin, in `~/.local/state/ask-kit/nudges/`: a counter file per session (and
  per subagent) holding how many lookups in a row it has made, their kinds (`rg`, `git log`, `Read`) and which
  kits would answer them, and `nudges.jsonl`, one line each
  time the hook told an agent to use `ask`: time, session id, subagent type, the `about` named, the
  kind of lookup and the count. No command, path or prompt is kept. Counter files older than a
  week are removed. It sends nothing.
- `find-sessions` keeps a digest of each session it found a match in, in
  `~/.local/state/ask-kit/index/digests.json`: title, the first 200 characters of the first
  prompt, project, dates and the twelve most used words of your prompts. It sends nothing; the
  investigator reads the digests of the sessions it searched.
- The skills, agent and rule it installed into your agents, each listed with its hash in
  `installed.json`.

The config records where a key is (an environment variable or a file), never the key.

## Remove it

```sh
ask-kit uninstall --dry-run   # see what would go
ask-kit uninstall
npm uninstall -g ask-kit
```

`uninstall` removes only what ask-kit wrote; a file you edited stays. The config and state
folders are yours to delete.
