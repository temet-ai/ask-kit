// Turn setup answers into ask-kit's config, and register the `ask` server with each chosen agent.
// plan() is pure: it returns the config and the list of changes, so setup can show them before
// anything is written. apply() carries them out.
import { API_PRESETS, AGENT_CLIS } from "../providers.mjs";
import { CONFIG_FILE, loadConfig, saveConfig, storeKey } from "../config.mjs";
import { writeAgentsMd } from "../agentsmd.mjs";
import { investigatorChoices } from "./questions.mjs";
import { REGISTER } from "./register.mjs";
import { installBundle } from "./bundle.mjs";

/** A short backend name for a choice id: "openrouter:z-ai/glm-5.3-flash" -> "glm-5.3-flash". */
export function backendName(id) {
  const [kind, model = ""] = id.split(/:(.*)/s);
  if (kind === "claude-cli") return `claude-${model || "default"}`;
  if (kind === "codex-cli") return model ? `codex-${model}` : "codex";
  if (kind === "copilot-cli") return model ? `copilot-${model}` : "copilot";
  return model.split("/").pop().replace(/[^A-Za-z0-9._-]+/g, "-").toLowerCase() || kind;
}

/** The env var a pasted key for the "custom" preset is stored under (it has no keyEnv of its own). */
export const CUSTOM_KEY_ENV = "ASK_KIT_CUSTOM_API_KEY";
const keyEnvOf = (preset) => API_PRESETS[preset].keyEnv ?? CUSTOM_KEY_ENV;

function backendFor(id, d, answers) {
  const keys = answers.keys;
  const [kind, model = ""] = id.split(/:(.*)/s);
  if (AGENT_CLIS[kind]) return { kind, ...(model ? { model } : {}) };
  const preset = API_PRESETS[kind];
  if (!preset) throw new Error(`unknown investigator choice "${id}"`);
  const m = preset.models.find((x) => x.id === model);
  const be = { kind: "api", preset: kind, model, ...(m?.providerOrder ? { providerOrder: m.providerOrder } : {}) };
  // "custom" has no address of its own: answers.custom = {baseUrl, noKey?} names it.
  if (kind === "custom") {
    const baseUrl = answers.custom?.baseUrl;
    if (!baseUrl) throw new Error(`"${id}" needs answers.custom.baseUrl (the endpoint's OpenAI-compatible base, e.g. https://llm.example.com/v1)`);
    if (!model) throw new Error(`"${id}" needs a model name after "custom:"`);
    be.baseUrl = baseUrl;
    if (answers.custom.noKey) return Object.assign(be, { noKey: true });
  }
  if (preset.local) return be;
  const given = keys?.[kind];
  if (given?.value) be.key = { value: true }; // replaced by storeKey in apply()
  else if (given?.env && !given.file && d.apis[kind]?.keyRefs?.some((r) => r.file && (r.var || given.env) === given.env)) {
    // Codex starts MCP servers with a reduced environment: when detect found the same variable in
    // a file, keep the file as the fallback.
    const f = d.apis[kind].keyRefs.find((r) => r.file && (r.var || given.env) === given.env);
    be.key = { env: given.env, file: f.file, var: f.var };
  }
  else if (given?.env || given?.file) be.key = given;
  else if (d.apis[kind]?.keyRefs?.length) {
    // Keep the env name and a file that holds the key: an agent may start ask without the shell's
    // environment, and then the file still works.
    const refs = d.apis[kind].keyRefs;
    const env = refs.find((r) => r.env && !r.file);
    const file = refs.find((r) => r.file);
    be.key = env && file ? { env: env.env, file: file.file, var: file.var } : refs[0];
  }
  else throw new Error(`no key for ${preset.label}: answer keys.${kind} with {env}, {file, var} or {value}${kind === "custom" ? ", or answers.custom.noKey" : ""}`);
  return be;
}

// ---- plan and apply ----

export function plan(answers, d, { dry = false } = {}) {
  const ids = [answers.investigator, ...(answers.extras ?? [])].filter(Boolean);
  if (!ids.length) throw new Error("answers.investigator is required");
  const known = new Set(investigatorChoices(d).map((c) => c.id));
  const list = {};
  for (const id of ids) {
    // A model the user named that setup did not list is fine for an API (any model id it serves).
    if (!known.has(id) && !API_PRESETS[id.split(":")[0]]) throw new Error(`"${id}" is not one of the investigator choices`);
    list[backendName(id)] = backendFor(id, d, answers);
  }
  const def = backendName(answers.investigator);
  // What the person already set and the answers don't speak to stays: backends they added, a
  // domain's own backend, kits and domains they enabled, the router's model.
  let old = d.existing?.config ?? null;
  if (!old) {
    try {
      old = loadConfig({ required: false });
    } catch {}
  }
  old ??= {};
  const mergedList = { ...(old.backends?.list ?? {}) };
  for (const [n, b] of Object.entries(list)) mergedList[n] = { ...(mergedList[n] ?? {}), ...b };
  const routerName = Object.entries(list).find(([, b]) => b.kind === "api")?.[0] ?? null;
  const domains = { ...(old.domains ?? {}) };
  const asked = answers.domains ?? ["sessions", "code"];
  for (const n of asked) domains[n] = { ...(domains[n] ?? {}), enabled: true };
  // Unticked in a conversation that offered them: off, with what else the domain had kept.
  if (answers.domains) for (const n of ["sessions", "code"]) if (!asked.includes(n) && domains[n]) domains[n] = { ...domains[n], enabled: false };
  const router = old.router?.backend && mergedList[old.router.backend] ? old.router : routerName ? { backend: routerName } : null;
  const config = {
    ...old,
    version: 1,
    sources: answers.sources ?? old.sources ?? [],
    clients: answers.clients ?? old.clients ?? [],
    backends: { ...(old.backends ?? {}), default: def, list: mergedList },
    domains,
    router,
    setupAt: new Date().toISOString(),
  };
  const clients = (answers.clients ?? []).filter((c) => REGISTER[c]);
  const bundle = installBundle(clients, { dry: true }).filter((r) => !r.action.startsWith("skip-no") && r.action !== "skip-plugin" && r.action !== "unchanged");
  const changes = [
    { client: null, what: `write ${CONFIG_FILE}`, run() {} },
    ...clients.map((c) => REGISTER[c]()),
    ...(bundle.length
      ? [{ client: null, what: `install ask-kit's skills, agent and rule for ${clients.join(", ")}: ${bundle.length} file(s), leaving any you edited`, run: () => installBundle(clients) }]
      : []),
  ];
  return { config, changes };
}

export function apply(answers, d, { dry = false } = {}) {
  const p = plan(answers, d, { dry });
  if (dry) return { ...p, applied: [] };
  // Pasted keys go to keys.env; config keeps only where they are.
  for (const be of Object.values(p.config.backends.list)) {
    if (be.key?.value === true) be.key = storeKey(keyEnvOf(be.preset), answers.keys[be.preset].value);
  }
  saveConfig(p.config);
  writeAgentsMd();
  const applied = [];
  for (const c of p.changes) {
    try {
      c.run();
      applied.push({ client: c.client, what: c.what, ok: true });
    } catch (e) {
      applied.push({ client: c.client, what: c.what, ok: false, error: e.message });
    }
  }
  return { ...p, applied };
}
