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
- When a router model is set, picking the domain is one more short call to it, with the question,
  the working directory and what each enabled domain answers.
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
- In `~/.local/state/ask-kit/actions/`: each question a kit's action answered or tried, with the
  params it ran the script with. For a shadow run (one action answer in 20), both answers are
  kept in full up to 4,000 characters each; this is the only place ask-kit keeps an answer's
  text. The shadow run sends the question to the kit's model, as any ask does.
  `actions.shadowEvery: 0` in the config stops it.
- `ask-kit gaps` keeps the lookup chains and asks it found in each session in
  `~/.local/state/ask-kit/index/gaps.json`: time, kit, area, token count and the first 200
  characters of the prompt. It sends nothing.
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
