// Keys and tokens masked out of transcript text before the investigator sees it. A transcript
// holds whatever its session printed or pasted (an `env` dump, a curl with a bearer token, a
// database URL), and what history returns goes to a model. Each match keeps its kind and loses
// its value: "sk-[redacted]", "Bearer [redacted]", "DATABASE_PASSWORD=[redacted]".
const R = "[redacted]";
const RULES = [
  // PEM private keys, whole block.
  [/-----BEGIN ([A-Z ]*)PRIVATE KEY-----[\s\S]*?(?:-----END \1PRIVATE KEY-----|$)/g, (_, k) => `-----BEGIN ${k}PRIVATE KEY----- ${R}`],
  // user:password@ in any URL (postgres://, mysql://, redis://, https://).
  [/\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@'"`]+:)([^\s@/'"`]+)@/gi, (_, head) => `${head}${R}@`],
  // Authorization headers.
  [/\b(Bearer|Basic|Token)(\s+)[A-Za-z0-9._~+/=-]{12,}/g, (_, kind, sp) => `${kind}${sp}${R}`],
  // Provider key shapes: OpenAI, Anthropic and OpenRouter (sk-...), GitHub, Slack, AWS, Google.
  [/\b(sk-(?:ant-|or-v1-|proj-|svcacct-)?)[A-Za-z0-9_-]{16,}/g, (_, p) => `${p}${R}`],
  [/\b(gh[pousr]_)[A-Za-z0-9]{30,}/g, (_, p) => `${p}${R}`],
  [/\b(github_pat_)[A-Za-z0-9_]{20,}/g, (_, p) => `${p}${R}`],
  [/\b(xox[abposre]-)[A-Za-z0-9-]{10,}/g, (_, p) => `${p}${R}`],
  [/\b(AKIA|ASIA)[0-9A-Z]{16}\b/g, (_, p) => `${p}${R}`],
  [/\b(AIza)[0-9A-Za-z_-]{30,}/g, (_, p) => `${p}${R}`],
  // NAME=value where the name says it is a secret (env style, upper case): API_KEY=..., GH_TOKEN="...".
  // A reference ($OTHER, ${OTHER}) and a short value (MAX_TOKENS=4000) are left alone.
  [/\b([A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIALS?)[A-Z0-9_]*)(\s*=\s*)("[^"\n]{8,}"|'[^'\n]{8,}'|(?![$])[^\s"'`;&|,)]{8,})/g, (_, name, eq) => `${name}${eq}${R}`],
  // "apiKey": "value" in JSON or YAML.
  [/(["']?\b[\w-]*(?:api[_-]?key|token|secret|password)["']?\s*:\s*)(["'])[^"'\s]{12,}\2/gi, (_, head, q) => `${head}${q}${R}${q}`],
];

/** `text` with keys, tokens and passwords masked. */
export function scrubSecrets(text) {
  if (typeof text !== "string" || text.length < 8) return text;
  let t = text;
  for (const [re, to] of RULES) t = t.replace(re, to);
  return t;
}

/** Every string in a value (an event, a tool's input) scrubbed; other values as they are. */
export function scrubDeep(v, depth = 0) {
  if (typeof v === "string") return scrubSecrets(v);
  if (!v || typeof v !== "object" || depth > 8) return v;
  if (Array.isArray(v)) return v.map((x) => scrubDeep(x, depth + 1));
  const out = {};
  for (const [k, x] of Object.entries(v)) out[k] = scrubDeep(x, depth + 1);
  return out;
}
