// Everything ask-kit knows about where a model can come from. Setup offers these; ask.mjs runs them.
//
// Two kinds of investigator:
//   agent CLIs   a subscription the user already pays for (Claude Code, Codex, Copilot CLI), run
//                headless with the REPL as its only MCP server.
//   chat APIs    any OpenAI-compatible chat endpoint: ask-kit runs the loop itself, the model writes
//                JavaScript cells, and the provider's prompt cache serves the fixed prefix.

/** Chat APIs. `models` lists suggestions, cheapest first; the first is setup's default. */
export const API_PRESETS = {
  openrouter: {
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    keyEnv: "OPENROUTER_API_KEY",
    keyFiles: ["~/.config/openrouter/active.env"],
    reportsCost: true,
    models: [
      // The best of the cheap models on the benchmark (bench/RESULTS.md) at well under a cent a question. The provider pin
      // keeps every question on one provider, so the prefix cache hits.
      { id: "z-ai/glm-5.3-flash", note: "cheapest that answers well (~$0.003/question)", providerOrder: ["DeepInfra"] },
      { id: "deepseek/deepseek-v4.1-flash-1017", note: "best on code questions, about the same price" },
      { id: "anthropic/claude-haiku-5-5", note: "Anthropic's small model through OpenRouter" },
    ],
  },
  openai: {
    label: "OpenAI API",
    baseUrl: "https://api.openai.com/v1",
    keyEnv: "OPENAI_API_KEY",
    models: [{ id: "gpt-6-mini", note: "small and cheap" }, { id: "gpt-6", note: "stronger, dearer" }],
  },
  anthropic: {
    label: "Anthropic API",
    // Anthropic's OpenAI-compatible endpoint, so one loop serves every API.
    baseUrl: "https://api.anthropic.com/v1",
    keyEnv: "ANTHROPIC_API_KEY",
    models: [{ id: "claude-haiku-5-5", note: "small and cheap" }, { id: "claude-sonnet-5-5", note: "stronger, dearer" }],
  },
  gemini: {
    label: "Google Gemini API",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    keyEnv: "GEMINI_API_KEY",
    models: [{ id: "gemini-4-flash", note: "small and cheap" }],
  },
  deepseek: {
    label: "DeepSeek API",
    baseUrl: "https://api.deepseek.com/v1",
    keyEnv: "DEEPSEEK_API_KEY",
    models: [{ id: "deepseek-chat", note: "cheap" }],
  },
  ollama: {
    label: "Ollama (local)",
    baseUrl: "http://localhost:11434/v1",
    local: true,
    models: [],
  },
  lmstudio: {
    label: "LM Studio (local)",
    baseUrl: "http://localhost:1234/v1",
    local: true,
    models: [],
  },
  custom: {
    label: "Another OpenAI-compatible endpoint",
    baseUrl: null,
    models: [],
  },
};

/** Agent CLIs. `bin` is what detect looks for on PATH. */
export const AGENT_CLIS = {
  "claude-cli": {
    label: "Claude Code (your Claude subscription or API key)",
    bin: "claude",
    // Warmed once, then each question forks the warm session (--resume --fork-session).
    forks: true,
    models: [{ id: "haiku", note: "fast and cheap" }, { id: "sonnet", note: "better on hard questions" }],
  },
  "codex-cli": {
    label: "Codex CLI (your ChatGPT plan or OpenAI key)",
    bin: "codex",
    // `codex exec fork` copies the warm session.
    forks: true,
    models: [{ id: "", note: "Codex's configured default" }],
  },
  "copilot-cli": {
    label: "GitHub Copilot CLI (your Copilot plan; each question uses premium requests)",
    bin: "copilot",
    // No fork: each question starts fresh with the instructions in its prompt.
    forks: false,
    models: [{ id: "", note: "Copilot's configured default" }],
  },
};

/** Coding agents whose transcripts ask-kit can read, and that it can install its tool into. */
export const AGENTS = {
  "claude-code": { label: "Claude Code", bin: "claude", source: "claude-code", client: "claude-code" },
  codex: { label: "Codex", bin: "codex", source: "codex", client: "codex" },
  "copilot-cli": { label: "GitHub Copilot CLI", bin: "copilot", source: "copilot-cli", client: "copilot-cli" },
  "gemini-cli": { label: "Gemini CLI", bin: "gemini", source: "gemini-cli", client: "gemini-cli" },
  opencode: { label: "opencode", bin: "opencode", source: "opencode", client: null },
};
