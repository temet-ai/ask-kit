# Choose the model that digs

The investigator is the model that answers each ask. It does not need to be clever, it needs to
be cheap, fast and good at writing small pieces of JavaScript. Setup offers what this machine
already has, in three kinds.

## An API key

The cheapest and fastest. ask-kit runs the loop itself against any OpenAI-compatible chat API,
and the provider's prompt cache serves the fixed part of every question (the instructions, the
API and the scripts), so each question pays only for its own work.

| Provider | Key it looks for | Suggested models |
|---|---|---|
| OpenRouter | `OPENROUTER_API_KEY` | `z-ai/glm-5.3-flash`, `deepseek/deepseek-v4.1-flash-1017`, `anthropic/claude-haiku-5-5` |
| OpenAI | `OPENAI_API_KEY` | `gpt-6-mini`, `gpt-6` |
| Anthropic | `ANTHROPIC_API_KEY` | `claude-haiku-5-5`, `claude-sonnet-5-5` |
| Google Gemini | `GEMINI_API_KEY` | `gemini-4-flash` |
| DeepSeek | `DEEPSEEK_API_KEY` | `deepseek-chat` |
| Another endpoint | (you say) | (you say) |

The model ids for OpenAI, Anthropic and Gemini are suggestions. `ask-kit doctor` checks them
against the provider's model list.

On OpenRouter, the glm preset is pinned to one provider, so every question lands where the
prefix is already cached.

## A subscription you already pay for

No extra cost, but slower, because each question starts an agent CLI.

- **Claude Code** (`haiku` or `sonnet`): warmed once, then each question forks the warm session
  (`claude --resume <warm> --fork-session`).
- **Codex** (your ChatGPT plan or OpenAI key): warmed once, then `codex exec fork <warm>` per
  question.
- **Copilot CLI**: Copilot cannot fork, so each question starts fresh with the instructions in its
  prompt, and each uses premium requests.

The CLI must be signed in: run it once by hand first. Its questions become sessions of that CLI,
so they show in its history and go to its service under its terms.

## A local model

Ollama (`localhost:11434`) or LM Studio (`localhost:1234`). Free and private; nothing leaves the
machine. Small local models answer noticeably worse at this, because the work is writing correct
code against an API they have never seen.

## Different models for different domains

The default backend serves every domain. To give one domain another, set
`domains.<name>.backend` in `~/.config/ask-kit/config.json`, or ask an agent:

```
Read ~/.config/ask-kit/AGENTS.md, then answer code questions with deepseek.
```

To try a backend on one question without changing anything, pass `--backend <name>` to
`ask-kit ask`.
