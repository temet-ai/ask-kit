# Troubleshooting

Start with these two:

```sh
ask-kit detect   # what was found: agents, transcripts, logins, keys, local models, tools
ask-kit doctor   # whether the config works: sources, backends, tools
```

## The agent does not have `ask`

Restart the agent after setup; agents load MCP servers when they start. Then check the table in
[What init puts in each agent](command-line.md#what-init-puts-in-each-agent) for where the tool
should be registered for that agent.

## Codex drops the call after a minute

Codex stops tool calls at 60 seconds by default. Setup sets `tool_timeout_sec = 600` for `ask` in
Codex's `config.toml`; if you registered it by hand, add that.

## An agent CLI as the investigator fails at once

It must be signed in. Run `claude`, `codex` or `copilot` once by hand.

## A source shows no sessions

`ask-kit detect` lists where it looked for each agent's transcripts. If your agent keeps them
somewhere else, tell the setup agent where.

## An answer is wrong or slow

The journal records every step of it: see [Make it better](tuning.md).

## Known gaps

- The Gemini CLI reader follows Gemini's documented session format and has not yet read a real
  store.
- The opencode and Gemini skill and agent formats follow their docs and have not yet been checked
  on a real install.
- ask-kit has been used on one Linux machine. CI runs on Linux and macOS, on Node 26, against fixtures.

Bugs and fixes are welcome at
[github.com/temet-ai/ask-kit](https://github.com/temet-ai/ask-kit/issues).
