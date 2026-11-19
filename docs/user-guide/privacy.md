# What it stores and sends

## What it sends

- Your question, and the transcript and code excerpts the investigator reads, to the model you
  chose: an API provider, an agent CLI's own service, or a local model server.
- When a router model is set, picking the domain is one more short call to it, with the question,
  the working directory and what each enabled domain answers.
- `ask-kit gallery` queries GitHub's search API. `ask-kit doctor` lists each provider's models.

Nothing else. There is no telemetry.

With an agent CLI as the investigator, its questions are sessions of that CLI: the excerpts go to
that CLI's service under its own terms, and the sessions appear in its history.

## What it stores

- Under `~/.config/ask-kit/`: the config, the guide for agents and `keys.env`.
- Under `~/.local/state/ask-kit/`: the journals of every ask and cell, REPL snapshots, warm
  investigator sessions and the transcript index. The router keeps each routed question, and in
  `router/bench.jsonl` every misrouted question with where it went and where it should have gone.
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
