// Ollama through its own /api/chat, not its OpenAI-compatible /v1: the /v1 endpoint takes no
// context size, so every prompt is cut at Ollama's default (4096 tokens) and the investigator's
// prefix (instructions, API, scripts: ~7k tokens) never arrives whole. /api/chat takes
// options.num_ctx. This translates an OpenAI chat request to /api/chat and the reply back, so the
// api loop in ask.mjs stays one loop.

// Enough for the prefix plus twenty cells of clipped results. A backend's `contextTokens` overrides.
export const OLLAMA_DEFAULT_CTX = 32_768;

const parseArgs = (s) => {
  if (s && typeof s === "object") return s;
  try {
    return JSON.parse(s || "{}");
  } catch {
    return {};
  }
};
const text = (c) => (typeof c === "string" ? c : Array.isArray(c) ? c.map((p) => p.text ?? "").join("") : c ?? "");
export const nativeBase = (baseUrl) => baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");

/** POST an OpenAI-shaped chat body to Ollama's /api/chat; returns {ok, status, json()} with an OpenAI-shaped reply. */
export async function ollamaChat(baseUrl, body, { signal, numCtx = OLLAMA_DEFAULT_CTX } = {}) {
  const req = {
    model: body.model,
    stream: false,
    messages: body.messages.map((m) => ({
      role: m.role,
      content: text(m.content),
      ...(m.tool_calls ? { tool_calls: m.tool_calls.map((c) => ({ function: { name: c.function.name, arguments: parseArgs(c.function.arguments) } })) } : {}),
      ...(m.role === "tool" ? { tool_name: "repl" } : {}),
    })),
    ...(body.tools ? { tools: body.tools } : {}),
    // A thinking model otherwise writes its final answer into `thinking` and leaves the reply empty.
    think: false,
    options: { num_ctx: numCtx, ...(body.temperature != null ? { temperature: body.temperature } : {}), ...(body.max_tokens ? { num_predict: body.max_tokens } : {}) },
  };
  const res = await fetch(`${nativeBase(baseUrl)}/api/chat`, { method: "POST", signal, headers: { "content-type": "application/json" }, body: JSON.stringify(req) });
  const j = await res.json().catch(() => ({}));
  if (process.env.ASK_KIT_DEBUG) process.stderr.write(`[ollama] ${res.status} ${JSON.stringify({ ...j, message: { ...j.message, content: j.message?.content?.slice(0, 300), thinking: j.message?.thinking?.slice(0, 300) } }).slice(0, 1200)}\n`);
  const m = j.message ?? {};
  const reply = {
    ...(j.error ? { error: j.error } : {}),
    choices: [
      {
        finish_reason: j.done_reason === "length" ? "length" : "stop",
        message: {
          role: "assistant",
          content: m.content ?? "",
          ...(m.thinking ? { reasoning: m.thinking } : {}),
          ...(m.tool_calls?.length
            ? { tool_calls: m.tool_calls.map((c, i) => ({ id: `call_${Date.now().toString(36)}_${i}`, type: "function", function: { name: c.function?.name, arguments: JSON.stringify(c.function?.arguments ?? {}) } })) }
            : {}),
        },
      },
    ],
    usage: { prompt_tokens: j.prompt_eval_count ?? 0, completion_tokens: j.eval_count ?? 0 },
  };
  return { ok: res.ok && !j.error, status: res.status, json: async () => reply };
}

/** The model's own maximum context, from /api/show, or null. */
export async function ollamaContextLength(baseUrl, model) {
  try {
    const res = await fetch(`${nativeBase(baseUrl)}/api/show`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model }), signal: AbortSignal.timeout(5000) });
    const j = await res.json();
    const k = Object.keys(j.model_info ?? {}).find((x) => x.endsWith(".context_length"));
    return k ? j.model_info[k] : null;
  } catch {
    return null;
  }
}
