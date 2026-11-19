// One chat call to a configured API backend, for ask-kit's own work outside an ask: smith's drafts
// and kit test's judge. The backend is the config's default unless one is named.
import { API_PRESETS } from "./providers.mjs";
import { loadConfig, resolveKey } from "./config.mjs";

export async function chat({ system, user, maxTokens = 2000, backend, config = loadConfig(), timeoutMs = 120_000, json = false }) {
  const name = backend ?? config.backends?.default;
  const be = config.backends?.list?.[name];
  if (!be || be.kind !== "api") throw new Error(`backend ${name}: an API backend is needed (kind "api")`);
  const preset = API_PRESETS[be.preset] ?? {};
  const base = (be.baseUrl ?? preset.baseUrl).replace(/\/+$/, "");
  const key = resolveKey(be.key) ?? (preset.keyEnv ? process.env[preset.keyEnv] : null);
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({
      model: be.model,
      temperature: 0,
      max_tokens: maxTokens,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      ...(json ? { response_format: { type: "json_object" } } : {}),
      ...(be.providerOrder ? { provider: { order: be.providerOrder, allow_fallbacks: true } } : {}),
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  const text = (await res.json()).choices?.[0]?.message?.content ?? "";
  return json ? parseJson(text) : text;
}

/** The first JSON object in a reply, fenced or not. */
export function parseJson(text) {
  const s = String(text ?? "");
  const body = s.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1] ?? s.slice(s.indexOf("{"), s.lastIndexOf("}") + 1);
  return JSON.parse(body);
}
