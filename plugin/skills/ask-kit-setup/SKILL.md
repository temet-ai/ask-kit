---
name: ask-kit-setup
description: Set up ask-kit, the one-tool `ask` for coding agents, by talking it through with the user - find which agents, subscriptions, API keys and local models this machine has, ask the user which to use, then write the config and register `ask` with their agents. Use when the user says "set up ask-kit", "install ask", "configure ask-kit", asks to change ask-kit's model, sources or agents, or when `ask` reports it is not set up.
---

# Setting up ask-kit with the user

ask-kit gives coding agents one tool, `ask`: a question in plain words goes to a cheap
investigator model with a JavaScript REPL and ready-made scripts, which digs through the user's
past agent sessions (their transcripts) or the current repository, and answers with evidence. The
setup is a short conversation: you find what the machine has, the user chooses, you apply it.

The command is `node "${CLAUDE_PLUGIN_ROOT}/bin/ask-kit.mjs"` (below: `ask-kit`). ask-kit's guide, with every path on this
machine, is ~/.config/ask-kit/AGENTS.md (Windows: %APPDATA%\ask-kit\AGENTS.md; `ask-kit doctor` prints where).

## 1. Find what is here

Run `ask-kit questions`. It prints JSON:

- `found`: the agents installed and how many sessions each has on disk, the subscription CLIs
  that can run the investigator (and whether they are signed in), API keys found (by name only)
  and local model servers.
- `questions`: each with `id`, `question`, `why`, `options` (value, label, note) and `suggested`.
- `existing`: the current config if ask-kit is already set up. When it is, say what it is set to
  and ask only about what the user wants to change.

## 2. Ask the user

Tell them in two or three sentences what you found (for example: "You have Claude Code and Codex,
with about 1,300 and 60 sessions on disk, an OpenRouter key, and Ollama running"). Then ask the
questions, in order, using your own question tool if you have one (one question per prompt, the
options as choices, the suggested one first and marked recommended). Put each question's `why`
in your words where it helps the choice.

- `sources` and `clients` and `domains` and `extras` are multi-choice; `investigator` is one.
- `investigator` is the one that matters most. Explain the trade-off plainly: an API key
  (OpenRouter, OpenAI, Anthropic, Gemini) is cheapest and fastest, about a third of a cent per
  question on the suggested model; a subscription they already pay for (Claude, ChatGPT through
  Codex, Copilot) costs nothing extra but each question starts a CLI, which is slower, and
  Copilot spends premium requests; a local model is free and private but answers worse.
- If they choose an API whose key was not found, ask where it is: the name of an environment
  variable (`{"env": "NAME"}`), a file holding `NAME=value` (`{"file": "path", "var": "NAME"}`),
  or the key itself (`{"value": "..."}`, stored in ~/.config/ask-kit/keys.env with mode 0600).
  Never echo a key back, and never write one anywhere else.
- If they want a model that is not listed for an API (any model id the provider serves), use
  `"<preset>:<model id>"`, e.g. `"openrouter:qwen/qwen4-max"`.
- An option list can be empty (no agent found for `clients`, say). Say so and ask whether to
  continue without it.

## 3. Show the plan, then apply

Write the answers to a temporary JSON file:

```json
{
  "sources": ["claude-code", "codex"],
  "clients": ["claude-code", "codex"],
  "investigator": "openrouter:z-ai/glm-5.3-flash",
  "extras": ["claude-cli:haiku"],
  "domains": ["sessions", "code"],
  "keys": {}
}
```

Run `ask-kit apply <file> --dry-run` and show the user the `changes` it lists (the config file,
and the MCP registration in each agent's own config). Apply only when they agree:
`ask-kit apply <file>`. Delete the answers file afterwards if it held a key.

## 4. Check it

Run `ask-kit doctor`: every source should show sessions and every API backend `ok`. Then try
one question from the shell, for example
`ask-kit ask --domain sessions "what did I work on yesterday?"`, and show the answer.

Tell the user to restart their agents so they load the new `ask` tool, and that a follow-up goes
to the same investigator with `continue: true`.

## Changing it later

Run this conversation again: `ask-kit questions` shows the current config in `existing`, and
`apply` replaces it. Registrations are idempotent (Codex's lives between `# >>> ask-kit` markers
in its config.toml).
