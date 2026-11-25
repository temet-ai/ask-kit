// One `ask` for every enabled domain. A small router picks which investigator answers and
// forwards the call to that domain's own server (src/server.mjs with ASK_KIT_DOMAIN), started on
// first use and kept for the session. Each domain keeps its own warm session, scripts, journal and
// follow-ups; the router only chooses and remembers the last choice, so `continue: true` goes back
// to the same investigator.
//
// Routing: the caller's `about` when given; a follow-up goes where the last question went; else one
// call to config.router.backend, or to the default backend when none is set (an API, or the claude,
// codex or copilot CLI: a word back); else keyword rules.
// The caller's side speaks protocol revision 2026-07-28 as well as the earlier ones (the v2 server
// package), so a slow ask can be answered with a task. The domain children stay on SDK 1.x.
import { McpServer, ProtocolError, ProtocolErrorCode, acceptedContent, inputRequired } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { z } from "zod";
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { CONFIG_FILE, ROOT, STATE_ROOT, callerSession, loadConfig, resolveKey, saveConfig, slug } from "./config.mjs";
import { indexDomain, loadDomain } from "./domains.mjs";
import { API_PRESETS } from "./providers.mjs";
import { parseDo } from "./shots.mjs";
import { NO_DATA_META, capabilityLines, providersOf, ranked, scopeOf, tiesOf, winnersOf } from "./capabilities.mjs";
import { ACTION_META, asksForChange, markReaskOf, matchAction, statusOf } from "./actions.mjs";

const SERVER = path.join(ROOT, "src", "server.mjs");

// A slow ask answered as an MCP task (the Tasks extension, protocol revision 2026-07-28): the call
// returns a task id once the ask has run for config.taskAfterSeconds, the caller goes on working,
// and its client collects the answer with tasks/get when the ask ends.
const TASKS_EXT = "io.modelcontextprotocol/tasks";
const CLIENT_CAPS = "io.modelcontextprotocol/clientCapabilities";
export const TASK_AFTER_SECONDS = 10;
// A finished task's answer is kept this long, for a client that asks late.
const TASK_KEEP_MS = 3_600_000;
// What a caller is told to do with an ask that came back as a task: the tool's description and the
// server's instructions both carry it, since the task answer itself has no room for words.
const SENT_OFF =
  "A slow ask may come back as a background task instead of an answer: the investigator is still digging and its answer is delivered to you when it is ready. " +
  "While it digs, do the work that does not depend on its answer: read the files you are about to change, prepare what the answer will not alter, send your other asks. Don't wait for it, poll it or ask the same thing again, and start on an answer as soon as it arrives, without waiting for the others. " +
  "End your turn only when every step left needs an answer that has not arrived; it will be delivered. To follow up on a task's answer, pass its task id (the one that starts with ask-) as continue. With more than one question, send each with wait: false: they are handed back as tasks at once and run side by side.";
// Claude Code loads a tool marked alwaysLoad into context at the start of a session, and passes a
// result of up to maxResultSizeChars (500,000 is its ceiling) on whole.
const TOOL_META = { "anthropic/alwaysLoad": true, "anthropic/maxResultSizeChars": 500_000 };
// Claude Code cuts the description of a tool loaded upfront, and the server's instructions, at this
// many characters. It does not cut the input schema.
const DESCRIPTION_LIMIT = 4096;
/**
 * The words of the `ask` tool: its description (how to call it and the names of what it answers
 * about) and the text of its `about` parameter (every domain's whole `says`, and which domain wins a
 * shared capability). A list of names or aliases that would take the description to the limit
 * moves whole to `about`; nothing is shortened.
 */
export function describeAsk({ enabled, DOMAINS, aliasLine, capLines, tasks }) {
  const aliasText = aliasLine ? ` (it also takes ${aliasLine})` : "";
  const build = (names, alias) =>
    "Ask a question in plain words and get a short answer with its evidence. A cheap investigator does the digging outside your context, " +
    "so you pay for one call and the answer. It goes to one of: " +
    (names ? enabled.join(", ") + " (the `about` parameter says what each answers)" : "the investigators the `about` parameter names and describes") +
    ". Pass `about` to choose yourself" +
    alias +
    ". For a follow-up, pass continue: true. " +
    (tasks ? SENT_OFF + " " : "") +
    "The investigator only reads unless the ask may change things: a request that opens with what to do (\"fix ...\", \"restart ...\", \"send ...\") gets its acting calls, " +
    "and so does any request sent with act: true; a follow-up keeps the act of the ask it continues. " +
    'To run a kit\'s script with no model, pass do: "<kit>.<script>" and params: the result comes back at once and stays in that kit\'s REPL as shots.<script> for a continue: true question.';
  const fits = (text) => text.length < DESCRIPTION_LIMIT;
  const aliasInside = fits(build(true, aliasText));
  const alias = aliasInside ? aliasText : "";
  const description = build(fits(build(true, alias)), alias);
  const about =
    "Which investigator; left out, the router chooses." +
    (capLines.length ? ` Held by more than one, so the router picks by the agent a question names (first named otherwise): ${capLines.join("; ")}.` : "") +
    (aliasLine && !aliasInside ? ` It also takes ${aliasLine}.` : "") +
    ` What each answers:\n${enabled.map((n) => `${n}: ${DOMAINS[n].says}`).join("\n")}`;
  return { description, about };
}
// How this caller can show the person a form (MCP elicitation): on revision 2026-07-28 the tool
// returns input_required and the client sends the ask again with the answer; on earlier revisions
// the server asks while the call waits. null when the client shows no forms.
const pickerFor = (server, ctx) => {
  if (ctx?.mcpReq?.envelope) return ctx.mcpReq.envelope[CLIENT_CAPS]?.elicitation ? { modern: true } : null;
  return server.server.getClientCapabilities?.()?.elicitation ? { legacy: (form) => ctx.mcpReq.elicitInput(form, { timeout: 600_000, signal: ctx.mcpReq.signal }) } : null;
};
const jsonLinesOf = (out) => String(out).split("\n").flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
const textOf = (out) => (out.content ?? []).map((x) => x.text ?? "").join("\n");
const acceptsTasks = (ctx) => !!ctx?.mcpReq?.envelope?.[CLIENT_CAPS]?.extensions?.[TASKS_EXT];

// The tasks of one router process. `start(run)` races the ask against the delay: the ask's own
// result when it ends first, else a task that `get` reports on until the ask ends.
export function taskBoard({ afterMs, onTask = () => {}, onEnd = () => {} }) {
  const tasks = new Map();
  const view = (t) => ({
    taskId: t.id,
    status: t.status,
    ...(t.statusMessage ? { statusMessage: t.statusMessage } : {}),
    createdAt: t.createdAt,
    lastUpdatedAt: t.updatedAt,
    ttlMs: t.ttlMs,
    // Asked often while the ask is young, so a short one is delivered soon; less often after a minute.
    pollIntervalMs: Date.now() - t.startedMs < 60_000 ? 2000 : 10_000,
  });
  const touch = (t, fields) => Object.assign(t, fields, { updatedAt: new Date().toISOString() });
  return {
    size: () => tasks.size,
    working: () => [...tasks.values()].filter((t) => t.status === "working").map((t) => ({ id: t.id, ms: Date.now() - t.startedMs })),
    // Every ask gets its id before it starts, so the investigator can file its follow-up record under it.
    newId: () => `ask-${crypto.randomBytes(6).toString("hex")}`,
    async start({ run, timeoutMs, signal, id = this.newId(), after = afterMs }) {
      const ac = new AbortController();
      const onAbort = () => ac.abort();
      signal?.addEventListener("abort", onAbort, { once: true });
      // The latest note is kept from the start, so a new task already says what the ask is doing.
      const state = { task: null, note: undefined };
      const startedMs = Date.now();
      const note = (message) => {
        state.note = String(message).slice(0, 200) || undefined;
        if (state.task?.status === "working") touch(state.task, { statusMessage: state.note });
      };
      const work = run({ id, signal: ac.signal, note, detached: () => !!state.task });
      let timer;
      const first = await Promise.race([work.then((out) => ({ out })), new Promise((resolve) => (timer = setTimeout(() => resolve({ late: true }), after)))]);
      clearTimeout(timer);
      if (first.out) {
        signal?.removeEventListener("abort", onAbort);
        return first.out;
      }
      // From here the call is over for the caller: only tasks/cancel stops the ask.
      signal?.removeEventListener("abort", onAbort);
      const now = new Date().toISOString();
      const t = { id, status: "working", createdAt: now, updatedAt: now, startedMs, ttlMs: timeoutMs + TASK_KEEP_MS, statusMessage: state.note, ac };
      state.task = t;
      tasks.set(t.id, t);
      onTask(t.id, Date.now() - startedMs);
      // Each ending is reported once: the "working" guard lets only the first of answer, failure and cancel through.
      work.then(
        (out) => t.status === "working" && (touch(t, { status: "completed", result: out, statusMessage: undefined }), onEnd(t.id, out?.isError ? "failed" : "answered", Date.now() - startedMs)),
        (e) => t.status === "working" && (touch(t, { status: "failed", error: { code: -32603, message: String(e?.message ?? e) }, statusMessage: String(e?.message ?? e).slice(0, 200) }), onEnd(t.id, "failed", Date.now() - startedMs)),
      ).finally(() => setTimeout(() => tasks.delete(t.id), TASK_KEEP_MS).unref());
      return { resultType: "task", ...view(t) };
    },
    get(id) {
      const t = tasks.get(id);
      if (!t) return null;
      return { resultType: "complete", ...view(t), ...(t.status === "completed" ? { result: t.result } : {}), ...(t.status === "failed" ? { error: t.error } : {}) };
    },
    cancel(id) {
      const t = tasks.get(id);
      if (!t) return false;
      if (t.status === "working") {
        touch(t, { status: "cancelled", statusMessage: "cancelled by the caller" });
        onEnd(t.id, "cancelled", Date.now() - t.startedMs);
        t.ac.abort();
      }
      return true;
    },
  };
}

// A backend that refused the ask for its key or account: out of credit, past a key's limit, a bad
// key, rate limited. `text` is a domain's failed reply, `ask failed (<backend>): <preset> <status>: <body>`
// (src/ask.mjs). Returns { backend, reason } with the provider's own message, links left out, or null.
const REFUSED = /\b(usage limit|credit|quota|limit exceeded|rate.?limit|invalid api key|unauthori[sz]ed)\b/i;
export function refusalOf(text, list = {}) {
  const m = /^ask failed \(([^)]+)\): ([\s\S]*)$/.exec(String(text ?? "").trim());
  if (!m || !list[m[1]]) return null;
  const [, backend, rest] = m;
  const status = /^\S+ (\d{3}): /.exec(rest)?.[1];
  if (!["401", "402", "403", "429"].includes(status) && !REFUSED.test(rest)) return null;
  let reason = status ? rest.slice(rest.indexOf(": ") + 2) : rest;
  try {
    const j = JSON.parse(reason);
    reason = j.message ?? j.error?.message ?? reason;
  } catch {}
  reason = String(reason).replace(/\s*Manage it using https?:\/\/\S+/i, "").replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim().slice(0, 200);
  return { backend, reason: reason || `HTTP ${status}` };
}

// The other backends a person can pick when `failed` refused: those on another key or account
// first, then those that share its key (the same limit, so they say they will likely fail too).
export function backendChoices(list = {}, failed) {
  const group = (b) => (b?.kind === "api" ? `api|${b.preset}|${b.baseUrl ?? ""}|${JSON.stringify(b.key ?? null)}` : b?.kind);
  const shared = group(list[failed]);
  const what = (b) => (b.kind === "api" ? `${b.model} on ${b.preset ?? "api"}` : `${b.model ?? "default model"} through the ${b.kind}`);
  return Object.entries(list)
    .filter(([n]) => n !== failed)
    .map(([name, b]) => ({ name, same: group(b) === shared, label: `${name}: ${what(b)}` }))
    .map((c) => ({ ...c, label: c.same ? `${c.label} (same ${list[c.name].kind === "api" ? "key" : "account"}, likely refused too)` : c.label }))
    .sort((a, b) => a.same - b.same);
}

// Puts `to` wherever the config names `from`: the default, the router, escalate, hedge, and each
// domain pinned to it.
export function replaceBackend(config, from, to) {
  if (config.backends?.default === from) config.backends.default = to;
  for (const k of ["router", "escalate", "hedge"]) if (config[k]?.backend === from) config[k].backend = to;
  for (const d of Object.values(config.domains ?? {})) if (d && typeof d === "object" && d.backend === from) d.backend = to;
  return config;
}

// The form a person answers when a backend refused: which backend answers instead, and whether it
// replaces the refused one from now on.
const PICK = "backend";
const pickForm = (refused, choices) => ({
  message: `${refused.backend} refused this ask: ${refused.reason}. Which model should answer it instead?`,
  requestedSchema: {
    type: "object",
    properties: {
      backend: { type: "string", title: "Answer with", oneOf: choices.map((c) => ({ const: c.name, title: c.label })), default: choices[0].name },
      always: { type: "boolean", title: `Use it instead of ${refused.backend} from now on`, description: "Changes ask-kit's config: the default, the router and any kit set to it", default: false },
    },
    required: ["backend"],
  },
});
// What a caller that cannot show the form is told: the same choices, for it to put to the person.
const choicesLine = (refused, choices) =>
  `\n\nOther backends in ask-kit's config: ${choices.map((c) => c.label).join("; ")}. ` +
  `Ask the user which one to use, then send the same ask again with backend: "<name>". ` +
  `To stop using ${refused.backend}, change it in ${CONFIG_FILE} (backends.default, router.backend, and any domain set to it).`;

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
  // The fallback when no model routes: past-work words first, then the kit most of whose keywords
  // the question holds (the longer matched text on a tie, each match counted to 25 characters so a
  // wildcard keyword does not outweigh a plain one; config order after that), then code.
  const kitWords = enabled
    .filter((n) => DOMAINS[n].keywords?.length)
    .map((n) => [n, DOMAINS[n].keywords.map((k) => new RegExp(`\\b(${k})\\b`, "i"))]);
  const byKeywords = (q) => {
    let top = null, best = 0;
    for (const [n, res] of kitWords) {
      let score = 0;
      for (const re of res) {
        const m = re.exec(q);
        if (m) score += 100 + Math.min(m[0].length, 25);
      }
      if (score > best) (best = score), (top = n);
    }
    return top;
  };
  const byRules = (q) => (pastWork && PAST_WORK.test(q) ? pastWork : byKeywords(q) ?? (DOMAINS.code && CODE_WORDS.test(q) ? "code" : enabled[0]));
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

  // With no router backend set (older setups wrote none when no backend was an API), the investigator's
  // routes; `router: false` routes by keywords only.
  const routerBe = config.router === false ? null : (config.backends?.list?.[config.router?.backend ?? config.backends?.default] ?? null);
  // An agent CLI starts before it answers: about 4 s for claude on Haiku, 7.6 s for codex (2026-11-23).
  const timeoutMs = config.router?.timeoutMs ?? ({ "claude-cli": 15_000, "codex-cli": 20_000, "copilot-cli": 20_000 }[routerBe?.kind] ?? 8000);
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
  // An agent CLI as the router, for a machine whose only model is a subscription (Claude through
  // claude, ChatGPT through codex, Copilot): one print-mode call with no tools, no MCP servers and
  // none of the person's settings, hooks, plugins (ask-kit's own included) or instructions, run from
  // the temp folder so no CLAUDE.md or AGENTS.md is read, and no session kept where the CLI allows it.
  const model = config.router?.model ?? routerBe?.model;
  const CLI = {
    "claude-cli": {
      bin: "claude",
      args: (q) => ["-p", q.slice(0, 2000), "--system-prompt", systemPrompt(q), "--output-format", "json", "--tools", "", "--strict-mcp-config", "--setting-sources", "", "--no-session-persistence", ...(model ? ["--model", model] : [])],
      word: (out) => {
        const j = JSON.parse(out);
        if (j.is_error) throw new Error(String(j.result).slice(0, 160));
        return String(j.result ?? "");
      },
    },
    "codex-cli": {
      bin: "codex",
      // Low reasoning: a one-word route needs none, and it is about 3 s faster (7.6 s, 2026-11-23).
      args: (q) => ["exec", "--json", "--skip-git-repo-check", "--ignore-user-config", "--ignore-rules", "--ephemeral", "-s", "read-only", "-C", os.tmpdir(), "-c", 'model_reasoning_effort="low"', ...(model ? ["-m", model] : []), `${systemPrompt(q)}\n\nThe question:\n${q.slice(0, 2000)}`],
      word: (out) => jsonLinesOf(out).filter((e) => e.type === "item.completed" && e.item?.type === "agent_message").map((e) => e.item.text).pop() ?? "",
    },
    "copilot-cli": {
      bin: "copilot",
      args: (q) => ["-p", `${systemPrompt(q)}\n\nThe question:\n${q.slice(0, 2000)}`, "--no-custom-instructions", "--disable-builtin-mcps", "--no-ask-user", "--deny-tool", "shell", "--deny-tool", "write", "--output-format", "json", "-s", ...(model ? ["--model", model] : [])],
      word: (out) => jsonLinesOf(out).filter((e) => e.type === "assistant.message" && e.data?.content).map((e) => e.data.content).pop() ?? "",
    },
  };
  async function byCli(q) {
    const cli = CLI[routerBe.kind];
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(ASK_KIT_SESSION|ASK_KIT_CALLER|ASK_KIT_INHERIT|CLAUDE_CODE_SESSION_ID|CLAUDECODE|CODEX_THREAD_ID)$/.test(k)));
    const out = await new Promise((resolve, reject) =>
      execFile(routerBe.bin ?? cli.bin, cli.args(q), { cwd: os.tmpdir(), timeout: timeoutMs, killSignal: "SIGKILL", maxBuffer: 4 << 20, env }, (e, stdout) => {
        if (e?.killed) reject(Object.assign(new Error(`router model: no reply in ${timeoutMs} ms`), { timeout: true }));
        else if (e) reject(new Error(`router model: ${cli.bin} exited ${e.code}`));
        else resolve(stdout);
      }),
    );
    try {
      return cli.word(out);
    } catch (e) {
      throw new Error(`router model: ${cli.bin} ${e instanceof SyntaxError ? "printed no JSON" : e.message}`);
    }
  }
  async function byModel(q) {
    if (CLI[routerBe?.kind]) {
      const word = (await byCli(q)).toLowerCase().match(/[a-z][a-z0-9-]*/)?.[0];
      if (!enabled.includes(word)) throw new Error(`router model said "${word}"`);
      return word;
    }
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
        body: JSON.stringify({ ...(routerBe.preset === "openrouter" ? { reasoning: { enabled: false } } : {}), ...config.router?.body, model, temperature: 0, max_tokens: 200, messages: [{ role: "system", content: systemPrompt(q) }, { role: "user", content: q.slice(0, 2000) }] }),
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

function serveNotSetUp() {
  serveStdio(() => {
    const server = new McpServer({ name: "ask", version: "0.1.0" });
    server.registerTool(
      "ask",
      {
        _meta: TOOL_META,
        description: "Ask a question in plain words and get a short answer with its evidence, from a cheap investigator working outside your context. ask-kit is not set up on this machine yet; calling this says how to set it up.",
        inputSchema: { question: z.string().optional().describe("The question or request") },
      },
      async () => ({ content: [{ type: "text", text: NOT_SET_UP }], isError: true }),
    );
    return server;
  });
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

  const afterMs = Math.max(0, Number(config.taskAfterSeconds ?? TASK_AFTER_SECONDS) || 0) * 1000;
  // Asks a follow-up can name: id -> the domain and backend that took it, and `root`, the id its
  // investigator files the conversation under (a follow-up that became a task has an id of its own
  // and the root of the ask it continued). Those that became tasks are kept on disk for a day.
  const THREAD_KEEP_MS = 86_400_000;
  const threadsFile = path.join(STATE_ROOT, "router", `threads-${slug(SESSION)}.json`);
  const threads = new Map();
  try {
    for (const [id, t] of Object.entries(JSON.parse(fs.readFileSync(threadsFile, "utf8")))) if (Date.now() - Date.parse(t.at) < THREAD_KEEP_MS) threads.set(id, { ...t, task: true });
  } catch {}
  const saveThreads = () => {
    try {
      fs.mkdirSync(path.dirname(threadsFile), { recursive: true, mode: 0o700 });
      fs.writeFileSync(threadsFile, JSON.stringify(Object.fromEntries([...threads].filter(([, t]) => t.task && Date.now() - Date.parse(t.at) < THREAD_KEEP_MS))));
    } catch {}
  };
  // What a caller who sent an id this server does not hold can pick from: its latest tasks, newest first.
  const keptLine = () => {
    const kept = [...threads].filter(([, t]) => t.task).slice(-5).reverse();
    return kept.length ? ` Kept: ${kept.map(([id, t]) => `${id} (${t.domain}: "${t.question ?? ""}")`).join("; ")}.` : "";
  };
  // One ask at a time per conversation: a follow-up to an ask still running waits for it.
  // A kit that names its service (`up` in its manifest) is asked only while that service answers:
  // one GET, a second and a half at most, the result kept for 15 s. Any HTTP reply below 500 is up.
  const upAt = new Map();
  const isUp = async (n) => {
    const url = DOMAINS[n]?.up;
    if (!url) return true;
    const kept = upAt.get(n);
    if (kept && Date.now() - kept.at < 15_000) return kept.up;
    const up = await fetch(url, { signal: AbortSignal.timeout(1500) }).then((r) => r.status < 500, () => false);
    upAt.set(n, { up, at: Date.now() });
    return up;
  };
  // `to` replaces `from` in the config (the person ticked "from now on"). Domain servers read the
  // config when they start, so those running now are retired: the next ask starts them on `to`.
  // The router's own model is read at start; it changes when the agent restarts.
  const switchBackend = (from, to) => {
    try {
      saveConfig(replaceBackend(loadConfig(), from, to));
    } catch {
      return;
    }
    for (const [n, p] of children) {
      children.delete(n);
      setTimeout(() => p.then((c) => c.close(), () => {}), 900_000).unref();
    }
    journal({ switched: { from, to } });
  };
  const tails = new Map();
  const inTurn = (root, fn) => {
    const p = (tails.get(root) ?? Promise.resolve()).then(fn, fn);
    const tail = p.catch(() => {});
    tails.set(root, tail);
    tail.then(() => tails.get(root) === tail && tails.delete(root));
    return p;
  };
  const board = taskBoard({
    afterMs,
    onTask: (task, afterMs) => {
      journal({ task, afterMs, ...(threads.get(task)?.root !== task ? { continues: threads.get(task)?.root } : {}) });
      if (threads.has(task)) (threads.get(task).task = true), saveThreads();
    },
    // How a task ended, after the {task, afterMs} row that says it began: `ms` is the time since the ask started.
    onEnd: (task, done, ms) => journal({ task, done, ms }),
  });

  const answer = async ({ question = "", about, do: doWhat, params, continue: cont = false, early, backend, timeoutSeconds, act }, ctx, job) => {
    // The caller's words decide whether the investigator may change things: act as given, else a
    // request that opens with what to do. Left unset otherwise, so a follow-up keeps the act of the ask it continues.
    const actBy = act != null ? "caller" : !doWhat && asksForChange(question) ? "request" : null;
    if (actBy === "request") act = true;
    const t0 = Date.now();
    let name = about ? (aliases[about] ?? about) : about;
    let how = "caller";
    // continue: "<id>" names the ask to follow up; true means the last one.
    const ref = typeof cont === "string" ? cont.trim() : null;
    const held = ref ? threads.get(ref) : null;
    if (ref && !held)
      return { content: [{ type: "text", text: `ask failed: no ask with the id "${ref}" is kept here (an id is kept for a day).${keptLine()} Send the question without continue, or with continue: true to follow up your last ask.` }], isError: true };
    if (held) {
      (name = held.domain), (how = "follow-up"), (about = undefined);
      backend ??= held.backend;
    }
    // The same ask sent again with the person's answer to the backend form (revision 2026-07-28):
    // the form's key names the backend that refused, the answer the one to use now.
    const answered = Object.keys(ctx?.mcpReq?.inputResponses ?? {}).find((k) => k.startsWith(`${PICK}:`));
    if (answered) {
      const refusedName = answered.slice(PICK.length + 1);
      const got = acceptedContent(ctx.mcpReq.inputResponses, answered);
      const list = (loadConfig({ required: false }) ?? config).backends?.list ?? {};
      if (!got || !list[got.backend]) return { content: [{ type: "text", text: `ask failed (${refusedName}): it refused this ask, and no other backend was chosen.` }], isError: true };
      backend = got.backend;
      if (got.always === true) switchBackend(refusedName, got.backend);
    }
    const root = held?.root ?? job.id;
    let err;
    let shot = null;
    let downNote = "";
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
    const acting = act != null ? { act } : {};
    const args = shot
      ? { ...(question.trim() ? { question } : {}), do: shot.script, ...(params ? { params } : {}), ...(backend ? { backend } : {}), ...(timeoutSeconds ? { timeoutSeconds } : {}), ...acting }
      : { question, ...(backend ? { backend } : {}), ...(timeoutSeconds ? { timeoutSeconds } : {}), ...(early === false ? { early: false } : {}), ...(held ? { continue: root } : cont && name === last ? { continue: true } : {}), ...(!held && root ? { thread: root } : {}), ...acting };
    // The ask may already be a task (wait: false, or a router model slower than the delay).
    if (job.id && !shot) {
      threads.set(job.id, { domain: name, backend, root, at: new Date().toISOString(), question: question.slice(0, 80), task: job.detached() });
      if (job.detached()) saveThreads();
    }
    journal({ question: (question || `do ${name}.${shot?.script}`).slice(0, 500), domain: name, how, routeMs: Date.now() - t0, ...(held ? { continues: root } : {}), ...(resolvedFrom ? { resolvedFrom } : {}), ...(shot ? { do: shot.script } : {}), ...(err ? { routeError: err } : {}), ...(actBy ? { act, actBy } : {}) });
    remember({ domain: name, how, question: (question || "").slice(0, 500) });
    // Pass the investigator's progress (one note per cell) on to the caller, if it asked for it.
    // Once the ask has become a task the call is over, and the same notes become the task's status line.
    const token = ctx?.mcpReq?._meta?.progressToken;
    const onprogress =
      token === undefined && !job.task
        ? undefined
        : (p) => {
            job.note(p.message ?? "");
            if (!job.detached() && token !== undefined) ctx.mcpReq.notify({ method: "notifications/progress", params: { ...p, progressToken: token } }).catch(() => {});
          };
    const send = async (n, a) => (await child(n)).callTool({ name: "ask", arguments: a }, undefined, { timeout: (timeoutSeconds ?? 300) * 1000 + 30_000, signal: job.signal, onprogress });
    // One turn holds the whole ask, its fallback included: a follow-up sent meanwhile waits for both,
    // and goes to the investigator that answered in the end.
    const turn = (fn) => (root && !shot ? inTurn(root, fn) : fn());
    try {
      let out = await turn(async () => {
      // A follow-up goes where its conversation is now, which a fallback may have moved while it waited.
      if (held) name = threads.get(held.root)?.domain ?? held.domain;
      let sendArgs = args;
      // The kit's service is not answering: no investigator is started for it. The next provider of
      // the same capability gets the question, as a new conversation under the same id; with none, the caller is told at once.
      if (!shot && !(await isUp(name))) {
        const from = name;
        const next = nextAfter(from, question)[0];
        journal({ question: question.slice(0, 500), domain: next ?? null, how: "down", from, routeMs: Date.now() - t0 });
        if (!next) return { content: [{ type: "text", text: `ask failed: ${from}'s service is not answering (${new URL(DOMAINS[from].up).origin}), and nothing else here covers this question. Start it and ask again.` }], isError: true };
        remember({ domain: next, how: "down", question: question.slice(0, 500) });
        name = next;
        how = "down";
        downNote = `\n\n[${from}'s service is not answering, so this was answered by ${next}]`;
        for (const id of new Set([job.id, root])) if (threads.has(id)) threads.get(id).domain = next;
        if (job.detached()) saveThreads();
        const { continue: _, ...rest } = args;
        sendArgs = { ...rest, ...(root ? { thread: root } : {}) };
      }
      let out = await send(name, sendArgs);
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
        for (const id of new Set([job.id, root])) if (threads.has(id)) threads.get(id).domain = next;
        if (job.detached()) saveThreads();
        // The next provider starts the conversation anew, filed under the same id.
        const { continue: _, ...rest } = sendArgs;
        const fresh = { ...rest, ...(root ? { thread: root } : {}) };
        out = await send(next, fresh);
      }
      return out;
      });
      // A backend that refused for its key or account (out of credit, past a limit, a bad key): the
      // person picks another one, in a form when the client can show one; a caller that cannot show
      // it is told the choices, to put to the person.
      const list = (loadConfig({ required: false }) ?? config).backends?.list ?? {};
      const refused = !shot && out.isError ? refusalOf(textOf(out), list) : null;
      const choices = refused ? backendChoices(list, refused.backend) : [];
      if (choices.length) {
        const form = pickForm(refused, choices);
        if (job.pick?.modern && !job.detached()) return inputRequired({ inputRequests: { [`${PICK}:${refused.backend}`]: inputRequired.elicit(form) } });
        const said = job.pick?.legacy ? await job.pick.legacy(form).catch(() => null) : null;
        const got = said?.action === "accept" && choices.some((c) => c.name === said.content?.backend) ? said.content : null;
        if (got) {
          if (got.always === true) switchBackend(refused.backend, got.backend);
          journal({ question: question.slice(0, 500), domain: name, how: "picked", from: refused.backend, backend: got.backend, always: got.always === true, routeMs: Date.now() - t0 });
          if (threads.has(job.id)) threads.get(job.id).backend = got.backend;
          // The chosen backend starts the conversation anew, filed under the same id.
          const { continue: _, ...rest } = args;
          out = await turn(() => send(name, { ...rest, ...(root ? { thread: root } : {}), backend: got.backend }));
        } else out = { ...out, content: [{ type: "text", text: textOf(out) + (said ? "\n\nThe user chose no other backend, so don't ask again." : choicesLine(refused, choices)) }] };
      }
      // The action that answered, kept with the route, so a correction can count against it.
      if (out._meta?.[ACTION_META]) remember({ domain: name, how, question: question.slice(0, 500), action: out._meta[ACTION_META] });
      let text = (out.content ?? []).map((x) => x.text ?? "").join("\n");
      // An answer delivered as a task says how to follow it up by its id: by then another ask may be the last one.
      text += downNote;
      if (job.detached()) text = text.replaceAll("continue: true", `continue: "${job.id}"`);
      return { ...out, content: [{ type: "text", text: `${text}${!config.footer || ["caller", "only", "shot"].includes(how) ? "" : `\n[routed to ${name} by ${how}]`}` }] };
    } catch (e) {
      // A kit's detect settings run at its first use; one that turns out unable to run here says why.
      let why = null;
      if (DOMAINS[name]?.index) why = await loadDomain(name).then((d) => d.unavailable, () => null);
      return { content: [{ type: "text", text: why ? `ask failed: ${name} cannot run here: ${why}` : `ask failed (${name}): ${e.message ?? e}` }], isError: true };
    } finally {
      // An ask answered in the call never showed its id, so nothing can name it.
      if (job.id && !job.detached()) threads.delete(job.id);
    }
  };

  // One server per connection, from the same factory for both protocol revisions; the state above is shared.
  const told = describeAsk({ enabled, DOMAINS, aliasLine, capLines, tasks: Boolean(afterMs) });
  const build = () => {
    const server = new McpServer(
      { name: "ask", version: "0.1.0" },
      {
        capabilities: { extensions: { [TASKS_EXT]: {} } },
        // The domains are named in the tool's description and described in its `about` parameter; these words stay the same for every set of kits.
        instructions:
          "One `ask` for questions whose answer you would otherwise dig for; its description names what it answers about, and its `about` parameter says what each of those covers. " +
          "Call it before a run of searches, reads or lookups whose purpose is to answer a question; read files yourself when you are about to edit them. " +
          "It is a conversation: continue: true sends a follow-up to the investigator that answered last, which keeps what it found." +
          (afterMs ? " " + SENT_OFF : ""),
      },
    );
    server.registerTool(
      "ask",
      {
        description: told.description,
        _meta: TOOL_META,
        inputSchema: {
          question: z.string().optional().describe("The question or request, with any ids, names or dates you already know"),
          about: z.enum([...enabled, ...Object.keys(aliases)]).optional().describe(told.about),
          do: z.string().optional().describe('A shot: "<kit>.<script>" runs that kit script with no model and returns its result'),
          params: z.record(z.string(), z.any()).optional().describe("The shot script's parameters"),
          continue: z
            .union([z.boolean(), z.string()])
            .optional()
            .describe('true: send this to the investigator that answered your last question. A task id ("ask-..."): send it to the investigator of that ask, whatever you have asked since'),
          wait: z.boolean().optional().describe("false: hand the ask back as a background task at once, for a question you expect to take long. Left out, an ask becomes a task only when it is still running after a few seconds"),
          early: z.boolean().optional().describe("Let the investigator send the main fact before it finishes (default true); continue: true collects the rest"),
          backend: z.string().optional().describe("The investigator's model: a backend name from ask-kit's config"),
          timeoutSeconds: z.number().int().min(30).max(900).optional(),
          act: z.boolean().optional().describe("true: the request asks for a change, so the investigator gets its acting calls. Left out, the router sets it when the request opens with what to do (fix, add, restart, send ...); false keeps the ask read-only"),
        },
      },
      (input, ctx) => {
        const signal = ctx?.mcpReq?.signal;
        const pick = pickerFor(server, ctx);
        if (!afterMs || !acceptsTasks(ctx)) return answer(input, ctx, { signal, task: false, detached: () => false, note() {}, pick });
        return board.start({ timeoutMs: (input.timeoutSeconds ?? 300) * 1000 + 30_000, signal, after: input.wait === false && !input.do ? 0 : afterMs, run: (job) => answer(input, ctx, { ...job, task: true, pick }) });
      },
    );
    // The Tasks extension's two methods; an id this process does not hold is the invalid-params error the extension names.
    const TaskParams = z.looseObject({ taskId: z.string() });
    const unknownTask = (taskId) => new ProtocolError(ProtocolErrorCode.InvalidParams, `Unknown task: ${taskId}`);
    server.server.setRequestHandler("tasks/get", { params: TaskParams }, async ({ taskId }) => {
      const got = board.get(taskId);
      if (!got) throw unknownTask(taskId);
      return got;
    });
    server.server.setRequestHandler("tasks/cancel", { params: TaskParams }, async ({ taskId }) => {
      if (!board.cancel(taskId)) throw unknownTask(taskId);
      return {};
    });
    return server;
  };
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => process.exit(0));
  // The tasks still running when this process ends go with it; the journal says so.
  process.on("exit", () => {
    for (const t of board.working()) journal({ task: t.id, done: "stopped", ms: t.ms });
  });
  serveStdio(build);
}
