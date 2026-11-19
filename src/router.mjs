// One `ask` for every enabled domain. A small router picks which investigator answers and
// forwards the call to that domain's own server (src/server.mjs with ASK_KIT_DOMAIN), started on
// first use and kept for the session. Each domain keeps its own warm session, scripts, journal and
// follow-ups; the router only chooses and remembers the last choice, so `continue: true` goes back
// to the same investigator.
//
// Routing: the caller's `about` when given; a follow-up goes where the last question went; else one
// call to config.router.backend (an `api` backend: a word back) when there is one; else keyword rules.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { CONFIG_FILE, ROOT, STATE_ROOT, callerSession, loadConfig, resolveKey, slug } from "./config.mjs";
import { indexDomain, loadDomain } from "./domains.mjs";
import { API_PRESETS } from "./providers.mjs";
import { parseDo } from "./shots.mjs";
import { NO_DATA_META, capabilityLines, providersOf, ranked, scopeOf, tiesOf, winnersOf } from "./capabilities.mjs";
import { ACTION_META, markReaskOf, matchAction, statusOf } from "./actions.mjs";

const SERVER = path.join(ROOT, "src", "server.mjs");

// Words that make a question about past work: what a session did, said or decided.
export const PAST_WORK = /\b(sessions?|we (did|tried|built|said|decided)|discussed|decided|yesterday|last (week|night|time)|earlier|did (i|we|you)|when did|which session|transcripts?)\b/i;
// Fallback only, in this order: past-work words, then kit keywords, then code words, else the
// first enabled domain. Past work comes first so "which session restarted the docker container"
// goes to session history, not to docker.
const CODE_WORDS = /`[^`]+`|\b[\w-]+\/[\w./-]+\.\w+\b|\b(where is|defined|definition|function|struct|module|class|env var|flag|toggle|constant|calls?|implement\w*|in (this|the) (repo|code))\b/i;
// Routes the router decided itself; a caller who corrects one of these within MISROUTE_MS made it a misroute.
// "action": a kit's [[actions]] pattern matched the whole question, so that kit answers it with no model.
export const DECIDED = ["model", "rules", "pattern", "timeout", "action"];
export const MISROUTE_MS = 120_000;
// Past this many domains the router model sees only those the question's words point at.
export const SHORTLIST_AT = 15;
// Domain names other hosts use in kit hints (mike-ask's mike for past work); here they mean the past-work domain.
const PAST_NAMES = ["sessions", "mike"];

// A kit's route_hint names domains ("... is ops; ... are mike"). A name that is not enabled here is
// rewritten to the past-work domain when it means past work, else dropped; a clause left naming
// nothing is dropped, so the router model is never told to answer with a name it may not use.
export function rewriteHint(hint, enabled, pastWork) {
  const clauses = String(hint).split(/;\s*/).map((clause) => {
    const m = clause.match(/^(.*\b(?:is|are)\s+)([a-z][a-z0-9-]*(?:(?:,\s*|\s+or\s+)[a-z][a-z0-9-]*)*)\s*$/);
    if (!m) return clause;
    const names = [...new Set(m[2].split(/,\s*|\s+or\s+/).map((n) => (enabled.includes(n) ? n : PAST_NAMES.includes(n) ? pastWork : null)).filter(Boolean))];
    return names.length ? m[1] + names.join(" or ") : null;
  });
  return clauses.filter(Boolean).join("; ") || null;
}

export async function makeRouter(config) {
  const DOMAINS = {};
  const skipped = {};
  // Milliseconds each domain added to building the router (kit profile reads them).
  const loadMs = {};
  for (const n of Object.entries(config.domains ?? {}).filter(([, d]) => d.enabled !== false).map(([n]) => n)) {
    const t0 = performance.now();
    try {
      // The index only: a kit's detect commands, sources and API wait for its first use.
      const d = await indexDomain(n, config);
      // A kit that cannot run here (a missing program, setting or folder) is not offered.
      if (d.unavailable) skipped[n] = d.unavailable;
      else DOMAINS[n] = d;
    } catch (e) {
      skipped[n] = String(e.message ?? e).split("\n")[0];
    }
    loadMs[n] = Math.round((performance.now() - t0) * 10) / 10;
  }
  if (!Object.keys(DOMAINS).length) throw new Error(`no domains can run: ${JSON.stringify(skipped)}`);
  // Capabilities are resolved before routing: for each one, the providers that can run here are
  // ranked by priority (a config pin wins). A domain that wins no capability for any scope is
  // hidden: not offered, not in the prompt, kept only as a fallback for the one above it.
  const providers = providersOf(Object.keys(DOMAINS), (n) => DOMAINS[n].provides, config);
  const { caps, hidden } = winnersOf(providers);
  const ties = tiesOf(providers);
  for (const n of hidden) skipped[n] = `every capability it provides goes to another: ${[...new Set(providers.filter((p) => p.domain === n).map((p) => caps[p.capability].top))].join(", ")}`;
  const enabled = Object.keys(DOMAINS).filter((n) => !hidden.includes(n));
  // The domain past-work questions fall back to: the session-history winner.
  const pastWork = caps["session-history"]?.top ?? (DOMAINS.sessions ? "sessions" : null);
  const capLines = capabilityLines(caps, enabled);
  // Where a question routed to `name` goes once capabilities are resolved for its scope (the
  // agents it names): the best provider of the first capability `name` provides that holds it.
  const resolve = (name, q) => {
    const scope = scopeOf(q);
    for (const p of providers.filter((x) => x.domain === name)) {
      const order = ranked(providers, p.capability, scope);
      if (order.length) return order[0];
    }
    return name;
  };
  // The providers to try after `name` when it has no data for the question.
  const nextAfter = (name, q) => {
    const scope = scopeOf(q);
    for (const p of providers.filter((x) => x.domain === name)) {
      const order = ranked(providers, p.capability, scope).filter((d) => d !== name);
      if (order.length) return order;
    }
    return [];
  };
  // Kits bring their own routing: `keywords` join the fallback rules, and `patterns` claim a
  // question outright (no model call) unless it has past-work words, when they are a hint instead.
  const kitRules = enabled
    .filter((n) => DOMAINS[n].keywords?.length)
    .map((n) => [n, new RegExp(`\\b(${DOMAINS[n].keywords.join("|")})\\b`, "i")]);
  const patternOf = (q) => enabled.find((n) => DOMAINS[n].patterns?.some((re) => re.test(q))) ?? null;
  const byPattern = (q) => (PAST_WORK.test(q) ? null : patternOf(q));
  // An enabled action of a kit whose pattern matches the whole question claims it, ahead of the
  // kits' patterns and the router model: the kit's server then answers it with the action's script.
  const byAction = (q, cfg = config) => enabled.find((n) => DOMAINS[n].actions?.length && matchAction(DOMAINS[n].actions.filter((a) => statusOf(n, a, cfg).on), q)) ?? null;
  const rules = [...(pastWork ? [[pastWork, PAST_WORK]] : []), ...kitRules, ...(DOMAINS.code ? [["code", CODE_WORDS]] : [])];
  const byRules = (q) => rules.find(([, re]) => re.test(q))?.[0] ?? enabled[0];
  // `aliases` in the config: other words a caller may give as `about` ({"docs": "claude-code-docs"}),
  // so a host keeps the names its callers already use. An alias of a domain not enabled here, or one
  // that is itself a domain's name, is left out.
  const aliases = Object.fromEntries(Object.entries(config.aliases ?? {}).filter(([a, d]) => /^[a-z][a-z0-9-]*$/.test(a) && enabled.includes(d) && !enabled.includes(a)));
  const hintOf = Object.fromEntries(enabled.map((n) => [n, DOMAINS[n].routeHint ? rewriteHint(DOMAINS[n].routeHint, enabled, pastWork) : null]));
  const hints = enabled.map((n) => hintOf[n]).filter(Boolean);
  // What each domain adds to every routed ask's router prompt, in tokens (about 4 characters each).
  const promptTokens = Object.fromEntries(enabled.map((n) => [n, Math.round((`${n}: ${DOMAINS[n].says}\n`.length + (hintOf[n] ? hintOf[n].length + 1 : 0)) / 4)]));

  // Past SHORTLIST_AT domains, keywords and patterns pick the candidates the router model sees: the
  // kits they match, with the built-in domains and the past-work domain. When none match, all go.
  const keywordRe = Object.fromEntries(kitRules);
  const offered = (q) => {
    if (enabled.length <= SHORTLIST_AT) return enabled;
    const hit = enabled.filter((n) => DOMAINS[n].kit && (keywordRe[n]?.test(q) || DOMAINS[n].patterns?.some((re) => re.test(q))));
    return hit.length ? enabled.filter((n) => hit.includes(n) || !DOMAINS[n].kit || n === pastWork) : enabled;
  };

  const routerBe = config.router?.backend ? config.backends?.list?.[config.router.backend] : null;
  const timeoutMs = config.router?.timeoutMs ?? 8000;
  // What does not change comes first (the rules, the domains, capabilities, hints), so a provider
  // can cache the prefix across projects; the working directory and the question's own hint last.
  const systemPrompt = (q) => {
    const list = offered(q);
    const hinted = patternOf(q);
    const lines = capabilityLines(caps, list);
    const shownHints = list.map((n) => hintOf[n]).filter(Boolean);
    return (
      `Route a question from a coding agent to the one investigator that can answer it. Reply with one word: ${list.join(", ")}.\n` +
      list.map((n) => `${n}: ${DOMAINS[n].says}`).join("\n") +
      (lines.length ? `\nWhat more than one of them holds goes to the first named, or to the one named for the agent the question is about:\n${lines.join("\n")}` : "") +
      (pastWork && list.includes(pastWork) && list.includes("code") ? `\nPast work (what a session did or why) is ${pastWork} even when it is about code; the code as it is now is code.` : "") +
      (shownHints.length ? `\n${shownHints.join("\n")}` : "") +
      `\nThe coding agent is working in ${process.cwd()}.` +
      (hinted && list.includes(hinted) ? `\nThe question names something ${hinted} holds (it matches ${hinted}'s pattern): choose ${hinted} unless it asks what a past session did or said.` : "")
    );
  };
  async function byModel(q) {
    if (!routerBe || routerBe.kind !== "api") throw new Error("no router model");
    const preset = API_PRESETS[routerBe.preset] ?? {};
    const base = (routerBe.baseUrl ?? preset.baseUrl).replace(/\/+$/, "");
    const key = resolveKey(routerBe.key) ?? (preset.keyEnv ? process.env[preset.keyEnv] : null);
    let res;
    try {
      res = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
        // A reasoning model can spend all 200 tokens thinking and reply with nothing (mike-ask on
        // deepseek, 2026-11-19), so OpenRouter is told not to reason; `router.body` adds or overrides fields.
        body: JSON.stringify({ ...(routerBe.preset === "openrouter" ? { reasoning: { enabled: false } } : {}), ...config.router.body, model: config.router.model ?? routerBe.model, temperature: 0, max_tokens: 200, messages: [{ role: "system", content: systemPrompt(q) }, { role: "user", content: q.slice(0, 2000) }] }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      if (e?.name === "TimeoutError") throw Object.assign(new Error(`router model: no reply in ${timeoutMs} ms`), { timeout: true });
      throw e;
    }
    if (!res.ok) throw new Error(`router model: HTTP ${res.status}`);
    const j = await res.json();
    const word = (j.choices?.[0]?.message?.content ?? "").toLowerCase().match(/[a-z][a-z0-9-]*/)?.[0];
    if (!enabled.includes(word)) throw new Error(`router model said "${word}"`);
    return word;
  }
  // When the model fails: a timeout goes to session history (a slow router is no sign the question
  // is about anything else), any other failure to the keyword rules.
  const fallback = (q, e) => (e?.timeout && pastWork ? pastWork : byRules(q));
  return { enabled, aliases, DOMAINS, byRules, byModel, byPattern, byAction, fallback, hints, systemPrompt, offered, pastWork, skipped, providers, caps, hidden, ties, capLines, resolve, nextAfter, loadMs, promptTokens };
}

// Misroutes: the router's choice that the caller corrected, or (with capabilities) that answered
// with no data. Each is a routing record and a router-bench row: the question, where it went, and
// where it should have gone. bench/router.mjs reads the rows.
export const benchFile = () => path.join(STATE_ROOT, "router", "bench.jsonl");
export function recordMisroute(session, row) {
  const at = new Date().toISOString();
  try {
    fs.mkdirSync(path.join(STATE_ROOT, "router"), { recursive: true, mode: 0o700 });
    fs.appendFileSync(path.join(STATE_ROOT, "router", `${slug(session)}.jsonl`), JSON.stringify({ at, type: "misroute", ...row }) + "\n", { mode: 0o600 });
    fs.appendFileSync(benchFile(), JSON.stringify({ at, question: row.question, routed: row.routed, correct: row.correct, why: row.why }) + "\n", { mode: 0o600 });
  } catch {}
}

// Before setup there is no config. The server still starts and lists `ask`, so a client that
// installed ask-kit from a registry or an extension connects, and an ask says how to set it up.
export const NOT_SET_UP =
  "ask-kit is installed but not set up yet, so it can't answer. Set it up by running `npx @temet-ai/ask-kit setup` " +
  "(or `ask-kit setup` when it is installed globally) in a terminal, or by following the ask-kit-setup skill, then restart this agent. " +
  `The config goes in ${CONFIG_FILE}.`;

async function serveNotSetUp() {
  const server = new McpServer({ name: "ask", version: "0.1.0" });
  server.registerTool(
    "ask",
    {
      description: "Ask a question in plain words and get a short answer with its evidence, from a cheap investigator working outside your context. ask-kit is not set up on this machine yet; calling this says how to set it up.",
      inputSchema: { question: z.string().optional().describe("The question or request") },
    },
    async () => ({ content: [{ type: "text", text: NOT_SET_UP }], isError: true }),
  );
  await server.connect(new StdioServerTransport());
}

export async function serveRouter() {
  const config = loadConfig({ required: false });
  if (!config) return serveNotSetUp();
  const { enabled, aliases, DOMAINS, byModel, byPattern, byAction, fallback, pastWork, resolve, nextAfter, capLines } = await makeRouter(config);
  const aliasLine = Object.entries(aliases).map(([a, d]) => `"${a}" for ${d}`).join(", ");
  const SESSION = callerSession();
  const children = new Map();
  const child = (name) => {
    if (children.has(name)) return children.get(name);
    const env = { ...process.env, ASK_KIT_DOMAIN: name };
    const c = new Client({ name: "ask-kit-router", version: "0" });
    const p = c.connect(new StdioClientTransport({ command: process.execPath, args: [SERVER], env, cwd: process.cwd(), stderr: "ignore" })).then(() => c);
    children.set(name, p);
    p.catch(() => children.delete(name));
    return p;
  };
  const journal = (row) => {
    try {
      fs.mkdirSync(path.join(STATE_ROOT, "router"), { recursive: true, mode: 0o700 });
      fs.appendFileSync(path.join(STATE_ROOT, "router", `${slug(SESSION)}.jsonl`), JSON.stringify({ at: new Date().toISOString(), ...row }) + "\n");
    } catch {}
  };
  // The domain that answered this caller last, kept on disk: a follow-up from a new process (the
  // shell, a restarted agent) must still reach the same investigator. It keeps the question and how
  // it was routed too, so a correction from a new process is still seen as one.
  const lastFile = path.join(STATE_ROOT, "router", `last-${slug(SESSION)}.json`);
  const readLast = () => {
    try {
      return JSON.parse(fs.readFileSync(lastFile, "utf8"));
    } catch {
      return null;
    }
  };
  let last = readLast()?.domain ?? null;
  const remember = (row) => {
    last = row.domain;
    try {
      fs.mkdirSync(path.dirname(lastFile), { recursive: true, mode: 0o700 });
      fs.writeFileSync(lastFile, JSON.stringify({ ...row, at: new Date().toISOString() }));
    } catch {}
  };

  const server = new McpServer(
    { name: "ask", version: "0.1.0" },
    {
      // The domains are listed once, in the tool's description; these words stay the same for every set of kits.
      instructions:
        "One `ask` for questions whose answer you would otherwise dig for; its description lists what it answers about. " +
        "Call it before a run of searches, reads or lookups whose purpose is to answer a question; read files yourself when you are about to edit them. " +
        "It is a conversation: continue: true sends a follow-up to the investigator that answered last, which keeps what it found.",
    },
  );
  server.registerTool(
    "ask",
    {
      description:
        "Ask a question in plain words and get a short answer with its evidence. A cheap investigator does the digging outside your context, " +
        "so you pay for one call and the answer. It goes to one of: " +
        enabled.map((n) => `${n} (${DOMAINS[n].says})`).join("; ") +
        (capLines.length ? `. Held by more than one, so the router picks by the agent a question names (first named otherwise): ${capLines.join("; ")}` : "") +
        ". Pass `about` to choose yourself" +
        (aliasLine ? ` (it also takes ${aliasLine})` : "") +
        ". For a follow-up, pass continue: true. " +
        'To run a kit\'s script with no model, pass do: "<kit>.<script>" and params: the result comes back at once and stays in that kit\'s REPL as shots.<script> for a continue: true question.',
      inputSchema: {
        question: z.string().optional().describe("The question or request, with any ids, names or dates you already know"),
        about: z.enum([...enabled, ...Object.keys(aliases)]).optional().describe("Which investigator; left out, the router chooses"),
        do: z.string().optional().describe('A shot: "<kit>.<script>" runs that kit script with no model and returns its result'),
        params: z.record(z.string(), z.any()).optional().describe("The shot script's parameters"),
        continue: z.boolean().optional().describe("Send this to the investigator that answered your last question"),
        early: z.boolean().optional().describe("Let the investigator send the main fact before it finishes (default true); continue: true collects the rest"),
        backend: z.string().optional().describe("The investigator's model: a backend name from ask-kit's config"),
        timeoutSeconds: z.number().int().min(30).max(900).optional(),
      },
    },
    async ({ question = "", about, do: doWhat, params, continue: cont = false, early, backend, timeoutSeconds }, extra) => {
      const t0 = Date.now();
      let name = about ? (aliases[about] ?? about) : about;
      let how = "caller";
      let err;
      let shot = null;
      if (doWhat) {
        // A shot goes to its kit with no model call: "<kit>.<script>", or "<script>" with `about`,
        // the only kit, or the one kit that has that script.
        try {
          shot = parseDo(doWhat);
        } catch (e) {
          return { content: [{ type: "text", text: `ask failed: ${e.message}` }], isError: true };
        }
        const has = (n) => (DOMAINS[n].scriptsDirs ?? [DOMAINS[n].scriptsDir]).some((d) => d && fs.existsSync(path.join(d, `${shot.script}.mjs`)));
        const owners = shot.kit ? [aliases[shot.kit] ?? shot.kit] : about ? [name] : enabled.length === 1 ? enabled : enabled.filter(has);
        if (owners.length !== 1 || !enabled.includes(owners[0]))
          return { content: [{ type: "text", text: `ask failed: no single kit for do "${doWhat}"${shot.kit && !enabled.includes(shot.kit) ? ` (${shot.kit} is not a kit that can run here)` : ""}; kits: ${enabled.join(", ")}. Write it as "<kit>.<script>".` }], isError: true };
        (name = owners[0]), (how = "shot");
      } else if (!question.trim()) return { content: [{ type: "text", text: "ask needs `question` (or `do` to run a kit script)." }], isError: true };
      if (!name && cont && last) (name = last), (how = "follow-up");
      if (!name && enabled.length === 1) (name = enabled[0]), (how = "only");
      if (!name) {
        const claimed = byAction(question, loadConfig({ required: false }) ?? config);
        if (claimed) (name = claimed), (how = "action");
      }
      if (!name) {
        const claimed = byPattern(question);
        if (claimed) (name = claimed), (how = "pattern");
      }
      if (!name) {
        try {
          name = await byModel(question);
          how = "model";
        } catch (e) {
          name = fallback(question, e);
          how = e?.timeout && pastWork ? "timeout" : "rules";
          err = String(e.message ?? e).slice(0, 160);
        }
      }
      // The caller naming another domain for its next question within two minutes corrects the
      // router: the earlier route was a misroute, and the caller's choice stands as given.
      let correcting = false;
      if (how === "caller" && !shot) {
        const prev = readLast();
        const gap = prev?.at ? Date.now() - Date.parse(prev.at) : Infinity;
        if (prev && DECIDED.includes(prev.how) && prev.domain !== name && gap < MISROUTE_MS) {
          correcting = true;
          recordMisroute(SESSION, { question: prev.question, routed: prev.domain, how: prev.how, correct: name, why: "re-asked" + (prev.action ? ` after action ${prev.action.action}` : ""), afterMs: gap });
          // An action's answer the caller took elsewhere counts against the action (src/actions.mjs).
          if (prev.action) markReaskOf(prev.action.kit, prev.action.run, `re-asked of ${name}`);
        }
      }
      // Capabilities: a question routed (or sent with `about`) to one provider goes to the best
      // provider for its scope: Claude Code history to mike when mike is here, Codex to sessions.
      // A question an action claimed stays with the action's kit.
      let resolvedFrom;
      if (!correcting && (how === "caller" || (DECIDED.includes(how) && how !== "action"))) {
        const best = resolve(name, question);
        if (best !== name) (resolvedFrom = name), (name = best);
      }
      const args = shot
        ? { ...(question.trim() ? { question } : {}), do: shot.script, ...(params ? { params } : {}), ...(backend ? { backend } : {}), ...(timeoutSeconds ? { timeoutSeconds } : {}) }
        : { question, ...(backend ? { backend } : {}), ...(timeoutSeconds ? { timeoutSeconds } : {}), ...(early === false ? { early: false } : {}), ...(cont && name === last ? { continue: true } : {}) };
      journal({ question: (question || `do ${name}.${shot?.script}`).slice(0, 500), domain: name, how, routeMs: Date.now() - t0, ...(resolvedFrom ? { resolvedFrom } : {}), ...(shot ? { do: shot.script } : {}), ...(err ? { routeError: err } : {}) });
      remember({ domain: name, how, question: (question || "").slice(0, 500) });
      // Pass the investigator's progress (one note per cell) on to the caller, if it asked for it.
      const token = extra?._meta?.progressToken;
      const onprogress = token === undefined ? undefined : (p) => extra.sendNotification({ method: "notifications/progress", params: { ...p, progressToken: token } }).catch(() => {});
      const call = async (n, a) => (await child(n)).callTool({ name: "ask", arguments: a }, undefined, { timeout: (timeoutSeconds ?? 300) * 1000 + 30_000, signal: extra?.signal, onprogress });
      try {
        let out = await call(name, args);
        // Fallback, once: the provider held nothing for this question (its answer ended with the
        // no-data line), so the next provider of the same capability gets the same question.
        const next = !shot && out._meta?.[NO_DATA_META] ? nextAfter(name, question)[0] : null;
        if (next) {
          const from = name;
          recordMisroute(SESSION, { question: question.slice(0, 500), routed: from, how, correct: next, why: "no data" });
          journal({ question: question.slice(0, 500), domain: next, how: "fallback", from, routeMs: Date.now() - t0 });
          remember({ domain: next, how: "fallback", question: question.slice(0, 500) });
          name = next;
          how = "fallback";
          const { continue: _, ...fresh } = args;
          out = await call(next, fresh);
        }
        // The action that answered, kept with the route, so a correction can count against it.
        if (out._meta?.[ACTION_META]) remember({ domain: name, how, question: question.slice(0, 500), action: out._meta[ACTION_META] });
        const text = (out.content ?? []).map((x) => x.text ?? "").join("\n");
        return { ...out, content: [{ type: "text", text: `${text}${!config.footer || ["caller", "only", "shot"].includes(how) ? "" : `\n[routed to ${name} by ${how}]`}` }] };
      } catch (e) {
        // A kit's detect settings run at its first use; one that turns out unable to run here says why.
        let why = null;
        if (DOMAINS[name]?.index) why = await loadDomain(name).then((d) => d.unavailable, () => null);
        return { content: [{ type: "text", text: why ? `ask failed: ${name} cannot run here: ${why}` : `ask failed (${name}): ${e.message ?? e}` }], isError: true };
      }
    },
  );
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => process.exit(0));
  await server.connect(new StdioServerTransport());
}
