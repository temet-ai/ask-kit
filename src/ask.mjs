// `ask`: hand a question to an investigator that runs inside this tool and get back the answer.
//
// The calling agent pays for one tool call and the answer's text. The investigator works from a
// fixed prefix (instructions, scripts, typed API) built once and reused, so each question pays
// only for its own work. Which model does it is config (`ask-kit setup`); four kinds:
//
//   claude-cli   `claude -p` warmed once, then `--resume <warm> --fork-session` per question
//   codex-cli    `codex exec` warmed once, then `codex exec fork <warm>` per question
//   copilot-cli  `copilot -p` per question, instructions in the prompt (Copilot cannot fork)
//   api          any OpenAI-compatible chat API: ask-kit runs the loop, the model calls a `repl`
//                tool (or writes ```js cells), and the provider's prompt cache serves the prefix
//
// The prefix is fingerprinted (instructions, scripts, API, server code, backend); a change re-warms
// on the next question, so tuning is a file edit. A follow-up (continue: true) goes back to the
// same investigator, whose REPL variables are restored.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ROOT, loadConfig, resolveKey } from "./config.mjs";
import { API_PRESETS } from "./providers.mjs";
import { runCli } from "./platform.mjs";
import { ollamaChat, OLLAMA_DEFAULT_CTX } from "./ollama.mjs";
import { parseDo, runShot, shotFooter } from "./shots.mjs";
import { NO_DATA_META } from "./capabilities.mjs";
import { AsyncLocalStorage } from "node:async_hooks";
import { ACTION_META, SHADOW_EVERY, asksForChange, logRun, logShadow, matchAction, noteQuestion, runCount, shapeProblem, statusOf } from "./actions.mjs";

// Set while a shadow run is in progress.
const shadowing = new AsyncLocalStorage();
// Each ask's { act }: whether its caller asked for a change. replEnv reads it when it starts the
// investigator's REPL, which builds its globals read-only without it (src/kits.mjs, "act").
const acting = new AsyncLocalStorage();
const withActing = (handler) => (input, extra) => acting.run({ act: false }, () => handler(input, extra));
const ACT_KEY = "__act";

// Held back from the client's tool timeout for the closing "what I found" call.
const RESERVE_MS = 15_000;
const CELL_MAX_S = 60;
// An agent CLI has no closing call, so its process may run RESERVE_MS - 2 s past the ask's limit (which
// already has RESERVE_MS taken off the client's timeout), but never to within 2 s of the client's own.
const CLI_MARGIN_MS = 2000;
/** How long an agent CLI process may run for an ask whose time limit is `timeoutMs`; `clientMs` is the client's tool timeout (0 when unknown). */
export const cliLimitMs = (timeoutMs, clientMs = 0) => {
  const own = timeoutMs + RESERVE_MS - CLI_MARGIN_MS;
  return clientMs ? Math.max(1000, Math.min(own, clientMs - CLI_MARGIN_MS)) : own;
};
const stoppedAtLimit = (b, r) => `${b} was stopped at the time limit before it answered. Ask again with a narrower question, or raise timeoutSeconds if the client allows it.`;
// No step limit: time is the budget. With this much left the investigator is told to answer.
const WRAP_MS = 30_000;
const SERVER = path.join(ROOT, "src", "server.mjs");
// The no-data signal: an answer from a capability provider that ends with this line held nothing
// for the question. The line is cut from the answer, journaled as noData, and returned to the
// router in the result's _meta, which then asks the next provider once.
const NO_DATA_RULE = "\nIf your sources hold nothing for this question (a session, agent, machine or time they do not cover), say what you searched and end the answer with the line [no data].";
export const NO_DATA = /\n?[ \t]*\[no data\][ \t.]*$/i;
// Claude Code's own tools, left out so the investigator works through the REPL, where every call is journaled.
const CLAUDE_DENY = ["Bash", "Read", "Grep", "Glob", "Edit", "Write", "NotebookEdit", "WebFetch", "WebSearch", "Agent", "Task", "Skill", "TodoWrite"];

function sha(files, extra) {
  const h = crypto.createHash("sha256");
  for (const f of files) {
    h.update(f);
    try {
      h.update(fs.readFileSync(f));
    } catch {}
  }
  h.update(extra);
  return h.digest("hex").slice(0, 16);
}

// Agent CLIs run through platform.mjs, which also starts Windows .cmd shims.
const run = runCli;

const jsonLines = (text) =>
  text
    .split("\n")
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

export function registerAsk(server, ctx) {
  const { z, config, domain: D, domainName, STATE_DIR, SESSION } = ctx;
  const BACKENDS = config.backends?.list ?? {};
  const NAMES = Object.keys(BACKENDS);
  if (!NAMES.length) throw new Error("no backends in config: run `ask-kit setup`");
  const domainCfg = config.domains?.[domainName] ?? {};
  const DEFAULT = [domainCfg.backend, D.defaultBackend, config.backends.default, NAMES[0]].find((b) => b && BACKENDS[b]);
  // A domain that provides a capability another may also provide says when it holds nothing for a
  // question, so the router can hand the question to the next provider (src/capabilities.mjs).
  const rulesFor = () => D.answerRules + (D.provides?.length ? NO_DATA_RULE : "");
  const WARM_DIR = path.join(STATE_DIR, "warm");
  const WARM_CWD = path.join(WARM_DIR, "cwd");
  fs.mkdirSync(WARM_CWD, { recursive: true, mode: 0o700 });
  const INSTRUCTIONS = D.instructions;
  const fingerprint = (b) => sha([INSTRUCTIONS, ...ctx.fingerprintFiles()], JSON.stringify(BACKENDS[b]));

  // Child processes never get this session's id, which would make them write into its REPL state.
  const childEnv = (extra = {}) => {
    const env = { ...process.env, ASK_KIT_DOMAIN: domainName, ...(D.childEnv?.() ?? {}) };
    for (const k of ["ASK_KIT_SESSION", "CLAUDE_CODE_SESSION_ID", "CODEX_THREAD_ID", "CODEX_SESSION_ID", "COPILOT_SESSION_ID", "ASK_KIT_INNER", "ASK_KIT_CALLER", "ASK_KIT_INHERIT", "ASK_KIT_ACT"]) delete env[k];
    return { ...env, ...extra };
  };
  // The REPL server's environment for an investigator: inner mode, acting for `caller`, starting
  // from `inherit`'s variables. The warm session belongs to no caller, so it holds nothing of one.
  const replEnv = (inherit, ownId) => ({
    ASK_KIT_INNER: "1",
    ASK_KIT_DOMAIN: domainName,
    ...(D.childEnv?.() ?? {}),
    ...(process.env.ASK_KIT_CONFIG ? { ASK_KIT_CONFIG: process.env.ASK_KIT_CONFIG } : {}),
    ...(process.env.ASK_KIT_STATE ? { ASK_KIT_STATE: process.env.ASK_KIT_STATE } : {}),
    ...(inherit ? { ASK_KIT_INHERIT: inherit } : {}),
    // Acting for the caller: a kit's tools that act (send mail, answer) do it in the caller's name.
    ...(inherit || ownId ? { ASK_KIT_CALLER: SESSION } : {}),
    ...(ownId ? { ASK_KIT_SESSION: ownId } : {}),
    // Acting calls only for an ask whose caller asked for a change; never for the warm session.
    ASK_KIT_ACT: (inherit || ownId) && acting.getStore()?.act ? "1" : "0",
  });
  // Every ask row says whether the ask could change things.
  const keepRow = ctx.keep;
  ctx.keep = (entry) => keepRow({ ...entry, act: acting.getStore()?.act === true });

  // The last investigator each backend ran for this calling session, so a follow-up can continue it.
  const lastFile = path.join(WARM_DIR, `last-${SESSION.replace(/[^A-Za-z0-9._-]/g, "-")}.json`);
  const readLast = () => {
    try {
      return JSON.parse(fs.readFileSync(lastFile, "utf8"));
    } catch {
      return {};
    }
  };
  // A shadow run (an action's answer checked by the model in the background) leaves the caller's
  // follow-up where the action put it.
  const writeLast = (b, value) => shadowing.getStore() || fs.writeFileSync(lastFile, JSON.stringify({ ...readLast(), [b]: value }), { mode: 0o600 });
  // Shots kept for this caller: the REPL they ran in (ask-<askId>) and the names a follow-up has not been told about.
  const SHOTS_KEY = "__shots";
  const readShots = () => readLast()[SHOTS_KEY] ?? null;

  const warmFile = (b) => path.join(WARM_DIR, `${b}.json`);
  const readWarm = (b, fp) => {
    try {
      const s = JSON.parse(fs.readFileSync(warmFile(b), "utf8"));
      if (s.fingerprint === fp && s.sessionId) return { ...s, reused: true };
    } catch {}
    return null;
  };
  const saveWarm = (b, s) => fs.writeFileSync(warmFile(b), JSON.stringify(s), { mode: 0o600 });

  // ---- claude-cli ----

  function claudeMcpFile(inherit) {
    // One file per call: a shared one could be rewritten by another session's ask in between.
    const file = path.join(WARM_DIR, `mcp-${process.pid}-${crypto.randomUUID()}.json`);
    fs.writeFileSync(file, JSON.stringify({ mcpServers: { repl: { type: "stdio", command: process.execPath, args: [SERVER], env: replEnv(inherit) } } }), { mode: 0o600 });
    return file;
  }
  const claudeArgs = (be, mcpFile) => [
    "--output-format", "json",
    ...(be.model ? ["--model", be.model] : []),
    "--strict-mcp-config", "--mcp-config", mcpFile,
    "--append-system-prompt-file", INSTRUCTIONS,
    "--permission-mode", "bypassPermissions",
    "--disallowedTools", ...CLAUDE_DENY,
  ];
  async function claudeCall(be, args, timeoutMs, signal) {
    const r = await run(be.bin ?? "claude", args, { cwd: WARM_CWD, env: childEnv(), timeoutMs, signal });
    try {
      return JSON.parse(r.out);
    } catch {
      throw new Error(r.timedOut ? stoppedAtLimit("claude", r) : `claude exited ${r.code}: ${(r.err || r.out).slice(0, 500)}`);
    }
  }

  async function askClaude(b, question, timeoutMs, cont, signal) {
    const be = BACKENDS[b];
    const fp = fingerprint(b);
    let warm = readWarm(b, fp);
    if (!warm) {
      const started = Date.now();
      const cfg = claudeMcpFile(null);
      const j = await claudeCall(be, ["-p", D.prime, ...claudeArgs(be, cfg)], 300_000, signal).finally(() => fs.rmSync(cfg, { force: true }));
      if (j.is_error) throw new Error(`warming failed: ${String(j.result).slice(0, 300)}`);
      // A fork's total_cost_usd includes the warm session's, so it is kept to subtract.
      warm = { fingerprint: fp, sessionId: j.session_id, warmCostUsd: j.total_cost_usd ?? 0, warmMs: Date.now() - started, reused: false };
      saveWarm(b, warm);
    }
    const prev = cont ? readLast()[b] : null;
    if (cont && !prev) throw new Error(`nothing to continue: no earlier ${b} question in this session`);
    const started = Date.now();
    const target = prev ? ["--resume", prev.innerSession] : ["--resume", warm.sessionId, "--fork-session"];
    const cfg = claudeMcpFile(warm.sessionId);
    const j = await claudeCall(be, ["-p", question + rulesFor(), ...target, ...claudeArgs(be, cfg)], timeoutMs, signal).finally(() => fs.rmSync(cfg, { force: true }));
    const u = j.usage ?? {};
    const before = prev ? prev.reportedTotalUsd ?? 0 : warm.warmCostUsd ?? 0;
    if (!j.is_error) writeLast(b, { innerSession: j.session_id, reportedTotalUsd: j.total_cost_usd ?? 0 });
    return {
      answer: String(j.result ?? ""),
      ok: !j.is_error,
      model: be.model,
      continued: !!prev,
      warm: { reused: warm.reused, warmCostUsd: warm.reused ? 0 : warm.warmCostUsd },
      turns: j.num_turns,
      ms: Date.now() - started,
      costUsd: j.total_cost_usd != null ? Math.max(0, Math.round((j.total_cost_usd - before) * 1e6) / 1e6) : null,
      usage: { input: u.input_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0, output: u.output_tokens ?? 0 },
    };
  }

  // ---- codex-cli ----

  const tomlString = (s) => JSON.stringify(String(s));
  function codexArgs(be, inherit) {
    const env = replEnv(inherit);
    const envToml = `{${Object.entries(env).map(([k, v]) => `${k}=${tomlString(v)}`).join(",")}}`;
    return [
      "--json",
      "--skip-git-repo-check",
      // No sandbox: the investigator acts through its REPL, and a sandbox would stop the domain's actions.
      "-s", "danger-full-access",
      "-C", WARM_CWD,
      ...(be.model ? ["-m", be.model] : []),
      // The user's own config.toml would add their MCP servers and instructions; the investigator
      // gets only its REPL. Auth lives in auth.json, which this keeps.
      ...(be.isolate === false ? [] : ["--ignore-user-config", "--ignore-rules"]),
      "-c", 'approval_policy="never"',
      "-c", `mcp_servers.repl.command=${tomlString(process.execPath)}`,
      "-c", `mcp_servers.repl.args=[${tomlString(SERVER)}]`,
      "-c", `mcp_servers.repl.env=${envToml}`,
      "-c", "mcp_servers.repl.tool_timeout_sec=180",
      "-c", "mcp_servers.repl.default_tools_approval_mode=\"approve\"",
    ];
  }
  function codexResult(r) {
    const ev = jsonLines(r.out);
    const thread = ev.find((e) => e.type === "thread.started")?.thread_id;
    const msgs = ev.filter((e) => e.type === "item.completed" && e.item?.type === "agent_message").map((e) => e.item.text);
    const failed = ev.find((e) => e.type === "turn.failed" || e.type === "error");
    const usage = ev.filter((e) => e.type === "turn.completed").map((e) => e.usage ?? {}).pop() ?? {};
    const cells = ev.filter((e) => e.type === "item.completed" && e.item?.type === "mcp_tool_call").length;
    if (!thread && !msgs.length && r.timedOut) throw new Error(stoppedAtLimit("codex", r));
    if (!thread && !msgs.length) throw new Error(`codex exited ${r.code}: ${(r.err || r.out).slice(-600)}`);
    return { thread, answer: msgs.pop() ?? "", error: failed ? JSON.stringify(failed).slice(0, 300) : null, usage, cells };
  }

  async function askCodex(b, question, timeoutMs, cont, signal) {
    const be = BACKENDS[b];
    const bin = be.bin ?? "codex";
    const fp = fingerprint(b);
    let warm = readWarm(b, fp);
    if (!warm) {
      const started = Date.now();
      const prompt = `${fs.readFileSync(INSTRUCTIONS, "utf8")}\n\n${D.codexNote ?? ""}Work only through the \`repl\` MCP tool (and its \`help\`); do not run shell commands or read files yourself.\n\n${D.prime}`;
      const r = codexResult(await run(bin, ["exec", ...codexArgs(be, null), prompt], { cwd: WARM_CWD, env: childEnv(), timeoutMs: 300_000, signal }));
      if (!r.thread) throw new Error(`warming failed: ${r.error ?? r.answer}`);
      warm = { fingerprint: fp, sessionId: r.thread, warmMs: Date.now() - started, reused: false };
      saveWarm(b, warm);
    }
    const prev = cont ? readLast()[b] : null;
    if (cont && !prev) throw new Error(`nothing to continue: no earlier ${b} question in this session`);
    const started = Date.now();
    const args = prev
      ? ["exec", "resume", ...codexArgs(be, warm.sessionId).filter((a, i, all) => !["-s", "-C"].includes(a) && !["-s", "-C"].includes(all[i - 1])), prev.innerSession, question + rulesFor()]
      : ["exec", "fork", ...codexArgs(be, warm.sessionId).filter((a, i, all) => !["-s", "-C"].includes(a) && !["-s", "-C"].includes(all[i - 1])), warm.sessionId, question + rulesFor()];
    const r = codexResult(await run(bin, args, { cwd: WARM_CWD, env: childEnv(), timeoutMs, signal }));
    if (r.thread) writeLast(b, { innerSession: r.thread });
    else if (prev) writeLast(b, prev);
    return {
      answer: r.answer || (r.error ? `codex failed: ${r.error}` : ""),
      ok: !!r.answer,
      model: be.model || "codex default",
      continued: !!prev,
      warm: { reused: warm.reused },
      cells: r.cells,
      ms: Date.now() - started,
      costUsd: null,
      usage: { input: r.usage.input_tokens ?? 0, cacheRead: r.usage.cached_input_tokens ?? 0, output: r.usage.output_tokens ?? 0 },
    };
  }

  // ---- copilot-cli ----

  async function askCopilot(b, question, timeoutMs, cont, signal) {
    const be = BACKENDS[b];
    const held = cont ? readShots() : null;
    const prev = cont ? readLast()[b] ?? null : null;
    if (cont && !prev && !held) throw new Error(`nothing to continue: no earlier ${b} question in this session`);
    const askId = prev?.askId ?? held?.askId ?? crypto.randomUUID();
    const cfg = path.join(WARM_DIR, `copilot-mcp-${process.pid}-${crypto.randomUUID()}.json`);
    fs.writeFileSync(cfg, JSON.stringify({ mcpServers: { repl: { type: "local", command: process.execPath, args: [SERVER], env: replEnv(null, `ask-${askId}`), tools: ["*"] } } }), { mode: 0o600 });
    const prompt = prev
      ? question + rulesFor()
      : `${fs.readFileSync(INSTRUCTIONS, "utf8")}\n\nWork only through the \`repl\` MCP server's tools (call its \`help\` first); do not run shell commands or read files yourself.\n\nThe question:\n${question}${rulesFor()}`;
    const started = Date.now();
    const r = await run(
      be.bin ?? "copilot",
      [
        "-p", prompt,
        ...(prev?.innerSession ? ["--resume", prev.innerSession] : []),
        ...(be.model ? ["--model", be.model] : []),
        "--additional-mcp-config", `@${cfg}`,
        "--disable-builtin-mcps",
        "--no-custom-instructions",
        "--no-ask-user",
        "--allow-all-tools",
        "--deny-tool", "shell", "--deny-tool", "write",
        "--output-format", "json",
        "-s",
      ],
      { cwd: WARM_CWD, env: childEnv(), timeoutMs, signal },
    ).finally(() => fs.rmSync(cfg, { force: true }));
    const ev = jsonLines(r.out);
    const msgs = ev.filter((e) => e.type === "assistant.message" && e.data?.content).map((e) => e.data.content);
    const sid = ev.find((e) => e.data?.sessionId)?.data.sessionId ?? null;
    const answer = msgs.pop() ?? (ev.length ? "" : r.out.trim());
    if (!answer && r.timedOut) throw new Error(stoppedAtLimit("copilot", r));
    if (!answer) throw new Error(`copilot exited ${r.code}: ${(r.err || r.out).slice(-600)}`);
    writeLast(b, { askId, innerSession: sid ?? prev?.innerSession });
    const usage = ev.filter((e) => e.type === "session.usage_record").map((e) => e.data?.usage ?? {});
    return {
      answer,
      ok: true,
      model: be.model || "copilot default",
      continued: !!prev,
      cells: ev.filter((e) => e.type === "tool.execution_start").length,
      ms: Date.now() - started,
      costUsd: null,
      premiumRequests: usage.reduce((s, u) => s + Number(u.cost ?? 0), 0),
      usage: { input: usage.reduce((s, u) => s + (u.inputTokens ?? 0), 0), cacheRead: usage.reduce((s, u) => s + (u.cacheReadTokens ?? 0), 0), output: usage.reduce((s, u) => s + (u.outputTokens ?? 0), 0) },
    };
  }

  // ---- api (OpenAI-compatible chat) ----

  function endpoint(be) {
    const preset = API_PRESETS[be.preset] ?? {};
    const base = be.baseUrl ?? preset.baseUrl;
    if (!base) throw new Error(`backend has no baseUrl (preset ${be.preset})`);
    const key = resolveKey(be.key) ?? (preset.keyEnv ? process.env[preset.keyEnv] : null);
    if (!key && !preset.local && !be.noKey) throw new Error(`no API key for ${preset.label ?? be.preset}: ${JSON.stringify(be.key ?? { env: preset.keyEnv })} is empty`);
    return {
      url: `${base.replace(/\/+$/, "")}/chat/completions`,
      base,
      key,
      extra: be.preset === "openrouter" ? { usage: { include: true } } : {},
      reportsCost: !!preset.reportsCost,
      // Ollama's /v1 cannot raise its 4096-token default context; its own /api/chat can (ollama.mjs).
      ollama: be.preset === "ollama",
    };
  }

  async function openInnerRepl(askId) {
    const transport = new StdioClientTransport({ command: process.execPath, args: [SERVER], env: childEnv(replEnv(null, `ask-${askId}`)), stderr: "ignore" });
    const client = new Client({ name: "ask-kit", version: "0" });
    await client.connect(transport);
    return client;
  }

  const CELL = /```(?:js|javascript|ts|typescript)?\s*\n([\s\S]*?)```/g;
  const REPL_TOOL = {
    type: "function",
    function: {
      name: "repl",
      description: "Run JavaScript in your persistent REPL (top-level await; variables persist) and get back what the last expression returned.",
      parameters: { type: "object", properties: { code: { type: "string", description: "JavaScript to run" } }, required: ["code"], additionalProperties: false },
    },
  };

  // An early answer: the investigator hands the caller the main fact while it goes on checking.
  const EARLY_TOOL = {
    type: "function",
    function: {
      name: "early_answer",
      description: "Send the caller the main fact now, while you carry on checking. Your final answer still follows and replaces it.",
      parameters: { type: "object", properties: { answer: { type: "string", description: "The main fact with its evidence" } }, required: ["answer"], additionalProperties: false },
    },
  };
  const EARLY_BLOCK = /```early\s*\n([\s\S]*?)```/;

  async function askApi(b, question, timeoutMs, cont, signal, onStep, onEarly) {
    const be = BACKENDS[b];
    const native = be.nativeTools !== false;
    const ep = endpoint(be);
    const fp = fingerprint(b);
    const prev = cont ? readLast()[b] ?? null : null;
    // A follow-up after shots alone (no earlier question) starts a new conversation in the shots' REPL.
    const held = cont ? readShots() : null;
    if (cont && !prev && !held) throw new Error(`nothing to continue: no earlier ${b} question in this session`);
    let messages;
    let askId;
    if (prev?.messages) {
      askId = prev.askId;
      messages = [...prev.messages, { role: "user", content: question + rulesFor() }];
    } else {
      const how = native
        ? "\n\nYou work by calling the `repl` tool with JavaScript; it runs in a persistent REPL (top-level await, " +
          "variables persist between calls) and the tool result is what it returned. Only a tool result is real: never write " +
          "a result yourself. You have a limited time; each result says how much is left. " +
          "When you have the answer, reply with the answer only and no tool call.\n\n"
        : "\n\nYou work by writing JavaScript cells. Put one cell in one ```js fenced block and stop: it runs in a persistent " +
          "REPL (top-level await, variables persist between cells) and the result comes back in the next message. Only that " +
          "message is real: never write a result yourself. You have a limited time; each result says how much is left. " +
          "When you have the answer, reply with the answer only and no code block.\n\n";
      const early = !onEarly
        ? ""
        : native
          ? "When a tool result already holds the main fact and you still want to check the rest, call `early_answer` with it once: the caller gets it at once while you carry on.\n\n"
          : "When a result already holds the main fact and you still want to check the rest, put it once in an ```early fenced block: the caller gets it at once while you carry on.\n\n";
      const system = fs.readFileSync(INSTRUCTIONS, "utf8") + how + early + D.openWith + (await ctx.helpText());
      askId = (cont && !prev && held?.askId) || crypto.randomUUID();
      messages = [
        be.explicitCache ? { role: "system", content: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }] } : { role: "system", content: system },
        { role: "user", content: question + rulesFor() },
      ];
    }
    const repl = await openInnerRepl(askId);
    const totals = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, costUsd: 0, calls: 0, missteps: 0, providers: new Set() };
    const started = Date.now();
    const leftMs = () => timeoutMs - (Date.now() - started);
    let answer = null;
    let cells = 0;
    let earlySent = false;
    // A history that holds an early_answer call keeps the tool declared, or a provider may refuse it.
    const earlyTool = !!onEarly || messages.some((m) => m.tool_calls?.some((c) => c.function?.name === "early_answer"));
    let outOfTime = false;
    let cutAtLength = false;
    let atLimit = false;
    const post = (body, ms) =>
      ep.ollama
        ? ollamaChat(ep.base, body, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms), numCtx: be.contextTokens ?? OLLAMA_DEFAULT_CTX })
        : fetch(ep.url, {
        method: "POST",
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms),
        headers: { "content-type": "application/json", ...(ep.key ? { authorization: `Bearer ${ep.key}` } : {}) },
        body: JSON.stringify(body),
      });
    const account = (body) => {
      const u = body.usage ?? {};
      totals.calls++;
      totals.input += u.prompt_tokens ?? 0;
      totals.cacheRead += u.prompt_tokens_details?.cached_tokens ?? 0;
      totals.cacheWrite += u.prompt_tokens_details?.cache_write_tokens ?? 0;
      totals.output += u.completion_tokens ?? 0;
      totals.costUsd += Number(u.cost ?? 0);
      if (body.provider) totals.providers.add(body.provider);
      if (body.choices?.[0]?.finish_reason === "length") cutAtLength = true;
    };
    // Lowered by the repeat guard below; otherwise only time ends the loop.
    let stopAt = Infinity;
    try {
      for (let step = 0; step < stopAt; step++) {
        if (signal?.aborted) throw new Error("the calling client cancelled the ask");
        if (leftMs() < 3000) {
          outOfTime = true;
          break;
        }
        let res;
        try {
          res = await post(
            {
              model: be.model,
              messages,
              temperature: 0,
              max_tokens: 4000,
              ...(native ? { tools: earlyTool ? [REPL_TOOL, EARLY_TOOL] : [REPL_TOOL], tool_choice: "auto", parallel_tool_calls: false } : {}),
              ...ep.extra,
              // One session_id per backend and prefix: OpenRouter then keeps every question on one
              // provider, so the shared prefix stays in its cache.
              ...(be.preset === "openrouter" ? { session_id: `ask-kit-${domainName}-${b}-${fp}` } : {}),
              ...(be.providerOrder ? { provider: { order: be.providerOrder, allow_fallbacks: true } } : {}),
            },
            leftMs(),
          );
        } catch (e) {
          if (e?.name !== "TimeoutError") throw e;
          outOfTime = true;
          break;
        }
        const body = await res.json().catch(() => ({}));
        if (signal?.aborted) throw new Error("the calling client cancelled the ask");
        if (!res.ok || body.error) throw new Error(`${be.preset} ${res.status}: ${JSON.stringify(body.error ?? body).slice(0, 300)}`);
        account(body);
        const msg = body.choices?.[0]?.message ?? {};
        const content = msg.content ?? "";
        const low = leftMs() < WRAP_MS || stopAt - step <= 2;
        // Read after the cell has run, so the time it took is counted.
        const nudge = () => {
          const secs = Math.max(0, Math.round(leftMs() / 1000));
          return leftMs() < WRAP_MS || stopAt - step <= 2
            ? `\n\nAbout ${secs}s left. Answer now with what you have, saying what you could not confirm.`
            : `\n\nAbout ${secs}s left.`;
        };
        const runCode = async (code) => {
          cells++;
          onStep?.(cells, code);
          const timeoutSeconds = Math.max(1, Math.min(CELL_MAX_S, Math.floor((leftMs() - 2000) / 1000)));
          try {
            const out = await repl.callTool({ name: "repl", arguments: { code, maxChars: 4000, timeoutSeconds } }, undefined, { timeout: timeoutSeconds * 1000 + 5000, signal });
            const text = out.content.map((c) => c.text).join("\n");
            // The REPL says when a cell repeats an earlier one with the same result; on the third, stop searching.
            if (Number(/one you already ran \((\d+) times now/.exec(text)?.[1] ?? 0) >= 3) {
              totals.stuck = (totals.stuck ?? 0) + 1;
              stopAt = Math.min(stopAt, step + 2);
              return text + "\n\n[Stop searching: this is the same result again. Answer now with what you found, and say what is still missing.]";
            }
            return text;
          } catch (e) {
            if (signal?.aborted) throw e;
            return `Error: the cell did not finish in ${timeoutSeconds}s (${e.message}). Narrow it: a shorter window, a sample, or a script.`;
          }
        };
        // At most one early answer; a second is told it was already sent.
        const sendEarly = (text) => {
          const t = String(text ?? "").trim();
          if (!t) return "Error: early_answer needs the answer text.";
          if (earlySent) return "An early answer was already sent; finish with your final answer.";
          earlySent = true;
          onEarly(t);
          return "Sent to the caller. Carry on checking; your final answer replaces it.";
        };
        if (native) {
          const isEarly = (c) => !!onEarly && c.function?.name === "early_answer";
          // Small models misname the one tool ("scripts.run", "javascript"); a call with `code` is a repl call.
          const calls = (msg.tool_calls ?? []).filter((c) => isEarly(c) || c.function?.name === "repl" || /"code"\s*:/.test(c.function?.arguments ?? ""));
          if (!calls.length) {
            // Tool-call markup in the text is a call the provider did not parse, not an answer.
            if (!content.trim() || /DSML|<\s*\/?\s*(tool_call|invoke|function_calls)/i.test(content)) {
              totals.missteps++;
              messages.push({ role: "assistant", content: content.trim() || "(empty reply)" });
              messages.push({ role: "user", content: "Call the `repl` tool to run code, or reply with the final answer as plain text." });
              continue;
            }
            messages.push({ role: "assistant", content });
            answer = content.trim();
            atLimit = low;
            break;
          }
          messages.push({ role: "assistant", content: content || null, tool_calls: calls });
          for (const [k, c] of calls.entries()) {
            let args;
            try {
              args = JSON.parse(c.function.arguments || "{}");
            } catch {
              args = {};
            }
            const code = args?.code;
            const text = isEarly(c)
              ? sendEarly(args?.answer)
              : typeof code === "string"
                ? await runCode(code)
                : "Error: the call's arguments were not JSON with a `code` string.";
            messages.push({ role: "tool", tool_call_id: c.id, content: text + (k === calls.length - 1 ? nudge() : "") });
          }
          continue;
        }
        // Code-block mode: run only the first block and keep only the text up to its end, so an
        // invented result written after it never enters the history. An ```early block goes to the caller first.
        const earlyBlock = onEarly ? content.match(EARLY_BLOCK) : null;
        if (earlyBlock) {
          const note = sendEarly(earlyBlock[1]);
          if (!CELL.test(content.replace(EARLY_BLOCK, ""))) {
            CELL.lastIndex = 0;
            messages.push({ role: "assistant", content });
            messages.push({ role: "user", content: `${note}${nudge()}` });
            continue;
          }
          CELL.lastIndex = 0;
        }
        const cellText = earlyBlock ? content.replace(EARLY_BLOCK, "") : content;
        const first = CELL.exec(cellText);
        CELL.lastIndex = 0;
        if (!first) {
          messages.push({ role: "assistant", content });
          answer = content.trim();
          atLimit = low;
          break;
        }
        messages.push({ role: "assistant", content: cellText.slice(0, first.index + first[0].length) });
        messages.push({ role: "user", content: `Cell result:\n\`\`\`\n${await runCode(first[1])}\n\`\`\`${nudge()}` });
      }
    } finally {
      await repl.close().catch(() => {});
    }
    // Out of steps or time: one more call, without tools, for what it found.
    let partial = false;
    if (answer == null) {
      partial = true;
      const limit = outOfTime ? `the ${Math.round(timeoutMs / 1000)}s time limit` : "a search that kept repeating";
      messages.push({
        role: "user",
        content: `You are out of ${outOfTime ? "time" : "steps"}. Reply now in plain text, with no tool call: what you found (with its evidence), what you tried, and what is still missing.`,
      });
      try {
        const res = await post({ model: be.model, messages, temperature: 0, max_tokens: 4000, ...ep.extra }, Math.max(1000, leftMs() + RESERVE_MS - 2000));
        const body = await res.json().catch(() => ({}));
        account(body);
        const m = body.choices?.[0]?.message ?? {};
        const text = (m.content ?? "").trim() || (m.reasoning ?? "").trim();
        if (text) {
          messages.push({ role: "assistant", content: text });
          answer = `[stopped at ${limit}; this is what it found]\n\n${text}`;
        }
      } catch {}
      answer ??= `[stopped at ${limit} after ${cells} cells, with nothing it could report]`;
    }
    if (cutAtLength) partial = true;
    if (partial) answer += (cutAtLength ? "\n\n[the reply hit the length limit and may be cut off]" : "") + "\n\n[not finished: ask again with continue: true to carry on from here]";
    else if (atLimit) answer += "\n\n[answered near the time limit: if something is missing, ask again with continue: true]";
    writeLast(b, { askId, messages });
    return {
      answer,
      askId,
      partial,
      cutAtLength,
      atLimit,
      ok: true,
      model: be.model,
      continued: !!prev,
      turns: totals.calls,
      cells,
      ms: Date.now() - started,
      costUsd: ep.reportsCost ? Math.round(totals.costUsd * 1e6) / 1e6 : null,
      usage: { input: totals.input, cacheRead: totals.cacheRead, cacheWrite: totals.cacheWrite, output: totals.output },
      providers: [...totals.providers],
      missteps: totals.missteps,
    };
  }

  const KINDS = { "claude-cli": askClaude, "codex-cli": askCodex, "copilot-cli": askCopilot, api: askApi };

  // A cell in one line for progress: its leading comment if it has one, else its first line.
  const cellLine = (code) => {
    const first = String(code).split("\n").map((l) => l.trim()).find(Boolean) ?? "";
    const t = first.replace(/^\/\/\s*/, "");
    return t.length > 100 ? `${t.slice(0, 99)}…` : t;
  };

  // ---- shots: a kit script with no model ----

  // Kinds whose investigator works in the REPL ask-<askId>, so a shot can land in the REPL its follow-up uses.
  const ASKID_KINDS = new Set(["api", "copilot-cli"]);
  async function shoot(backend, script, params, timeoutSeconds) {
    const last = readLast();
    const held = last[SHOTS_KEY] ?? null;
    const askId = (ASKID_KINDS.has(BACKENDS[backend].kind) && last[backend]?.askId) || held?.askId || crypto.randomUUID();
    const repl = await openInnerRepl(askId);
    let r;
    try {
      r = await runShot(repl, { script, params, timeoutSeconds: Math.min(timeoutSeconds, 600) });
    } finally {
      await repl.close().catch(() => {});
    }
    if (r.ok) {
      const names = held?.askId === askId ? (held.names ?? []).filter((n) => n !== script) : [];
      writeLast(SHOTS_KEY, { askId, names: [...names, script], at: new Date().toISOString() });
    }
    return r;
  }

  // One line for a follow-up: the shots it can use, and where they are when its REPL is another one.
  function heldShotsLine(backend) {
    const held = readShots();
    if (!held?.names?.length) return "";
    writeLast(SHOTS_KEY, { ...held, names: [] });
    const names = held.names.map((n) => `shots.${n}`).join(", ");
    const same = ASKID_KINDS.has(BACKENDS[backend].kind) && (readLast()[backend]?.askId ?? held.askId) === held.askId;
    return same
      ? `\n\n(Already in your REPL from shots the caller ran: ${names}.)`
      : `\n\n(Shots the caller ran are saved in the REPL of session ask-${held.askId}: ${names}. The \`load\` tool with that sessionId brings them into yours.)`;
  }

  // ---- early answers: runs that go on after the caller got the main fact ----

  const pending = new Map(); // backend -> Promise of the tool result the run ends with
  const PARTIAL_NOTE = "\n\n[partial: more is coming: ask again with continue: true]";

  // ---- the tool ----

  server.registerTool(
    "ask",
    {
      description:
        `${D.askDescription} For a follow-up, pass continue: true: the same investigator answers, keeping what it found. ` +
        `To run one of this kit's scripts with no model, pass do: "<script>" and params: the result comes back at once and stays in the REPL as shots.<script> for a follow-up. ` +
        `The investigator only reads unless the ask may change things: pass act: true for a request to change something (edit, run, send, restart); ` +
        `a request that opens with what to do ("fix ...", "restart ...") sets it, and a follow-up keeps it. ` +
        `backend: ${NAMES.join(", ")} (default ${DEFAULT}).`,
      inputSchema: {
        question: z.string().optional().describe("The question or request, with any ids, names or dates you already know"),
        request: z.string().optional().describe("Same as question"),
        prompt: z.string().optional().describe("Same as question"),
        do: z.string().optional().describe(`A shot: "<script>" or "${domainName}.<script>" runs that script with no model and returns its result`),
        params: z.record(z.string(), z.any()).optional().describe("The shot script's parameters"),
        backend: z.enum(NAMES).optional(),
        continue: z.boolean().optional().describe("Ask the same investigator as your last question on this backend, so it keeps what it found"),
        early: z.boolean().optional().describe("Let the investigator send the main fact before it finishes (default true); continue: true then collects the rest"),
        timeoutSeconds: z.number().int().min(30).max(900).optional().describe("Default 300"),
        act: z.boolean().optional().describe("true: this request asks for a change, so the investigator gets its acting calls (write, edit, run, a kit's acts). Left out, it is true when the request opens with what to do, or continues an ask that could act; false keeps it read-only"),
      },
    },
    withActing(async ({ question: q, request, prompt, do: doWhat, params = {}, backend = DEFAULT, continue: cont = false, early = true, timeoutSeconds = 300, act }, extra) => {
      const question = [q, request, prompt].find((v) => typeof v === "string" && v.trim());
      const started = Date.now();
      // Only the caller's words decide: act as given, else the request itself (or the ask it continues).
      // A shot runs the script the caller named, with no model, so it may act unless act is false.
      const state = acting.getStore();
      state.act = doWhat ? act !== false : act ?? (asksForChange(question) || (cont && readLast()[ACT_KEY] === true));
      if (!doWhat && question) writeLast(ACT_KEY, state.act);
      if (doWhat) {
        let target;
        try {
          target = parseDo(doWhat);
          if (target.kit && target.kit !== domainName) throw new Error(`this is the ${domainName} kit; ${target.kit}.${target.script} belongs to another (send it through the router's ask)`);
          const r = await shoot(backend, target.script, params, timeoutSeconds);
          ctx.keep({ question: question ?? `do ${domainName}.${target.script}`, shot: true, do: target.script, params, ok: r.ok, ms: r.ms, cells: 1, answer: r.text, ...(r.ok ? {} : { error: r.text.slice(0, 300) }) });
          return { content: [{ type: "text", text: r.text + (config.footer ? shotFooter(domainName, target.script, Date.now() - started) : "") }], isError: !r.ok };
        } catch (e) {
          const message = String(e?.message ?? e);
          ctx.keep({ question: question ?? `do ${doWhat}`, shot: true, do: target?.script ?? String(doWhat), ok: false, error: message.slice(0, 300), ms: Date.now() - started });
          return { content: [{ type: "text", text: `shot failed (${domainName}): ${message}` }], isError: true };
        }
      }
      if (!question) return { content: [{ type: "text", text: "ask needs `question`: the question or request, in plain words (or `do` to run a script)." }], isError: true };
      // Actions: one of the kit's scripts answers the question with no model (src/actions.mjs).
      // Anything short of a clean answer falls through to the investigator below.
      let fell = null;
      if (!cont && D.actions?.length) {
        const cfg = loadConfig({ required: false }) ?? config;
        const hit = matchAction(D.actions.filter((a) => statusOf(domainName, a, cfg).on), question);
        noteQuestion(domainName, SESSION, hit);
        if (hit) {
          const { action, params: p } = hit;
          // An acting action the config turned on, matching the whole request, is the caller asking for that change.
          if (action.acts) state.act = true;
          let r;
          try {
            r = await shoot(backend, action.script, p, Math.min(timeoutSeconds, 120));
          } catch (e) {
            r = { ok: false, text: String(e?.message ?? e), ms: Date.now() - started };
          }
          const why = r.ok ? shapeProblem(action, r.text) : "error";
          const run = logRun(domainName, { action: action.name, script: action.script, session: SESSION, question: question.slice(0, 500), params: p, ms: r.ms, ...(why ? { fellThrough: why } : {}), ...(why === "error" ? { error: r.text.slice(0, 300) } : {}) });
          if (!why) {
            ctx.keep({ question, action: action.name, do: action.script, params: p, ok: true, ms: Date.now() - started, cells: 1, answer: r.text });
            // A shadow check, one run in SHADOW_EVERY: the model answers the same question in the
            // background, and both answers go to the action log for `report` to show side by side.
            const every = cfg.actions?.shadowEvery ?? SHADOW_EVERY;
            const kind = BACKENDS[backend].kind;
            if (every > 0 && KINDS[kind] && runCount(domainName, action.name) % every === 0) {
              const base = { run: run.id, action: action.name, session: SESSION, question: question.slice(0, 500), actionAnswer: r.text.slice(0, 4000), backend };
              shadowing.run(true, () =>
                KINDS[kind](backend, question, Math.min(timeoutSeconds, 300) * 1000, false)
                  .then((m) => logShadow(domainName, { ...base, ok: m.ok !== false, modelAnswer: String(m.answer ?? "").slice(0, 4000), ms: m.ms, costUsd: m.costUsd ?? null, cells: m.cells ?? null }))
                  .catch((e) => logShadow(domainName, { ...base, ok: false, error: String(e?.message ?? e).slice(0, 300) })),
              );
            }
            const shown = Object.keys(p).length ? ` ${JSON.stringify(p)}` : "";
            return {
              content: [{ type: "text", text: `${r.text}\n\n[answered by ${domainName}'s action ${action.name}: script ${action.script}${shown}, no model; continue: true hands it to the investigator]` }],
              _meta: { [ACTION_META]: { kit: domainName, action: action.name, run: run.id } },
            };
          }
          fell = { action: action.name, why, ...(run.off ? { turnedOff: run.off } : {}) };
        }
      }
      // A follow-up to an ask that answered early collects the rest of that run first.
      if (cont && pending.has(backend)) {
        const out = await pending.get(backend);
        pending.delete(backend);
        const text = (out.content ?? []).map((c) => c.text).join("\n");
        return { ...out, content: [{ type: "text", text: `${text}\n\n[the rest of your earlier question; to ask something new of it, send that with continue: true]` }] };
      }
      // A client drops a call at its own tool timeout and the answer is lost; finish before it.
      const clientMs = Number(process.env.MCP_TOOL_TIMEOUT) || 0;
      const timeoutMs = Math.max(20_000, Math.min(timeoutSeconds * 1000, clientMs ? clientMs - RESERVE_MS : Infinity));
      const kind = BACKENDS[backend].kind;
      const asked = cont ? question + heldShotsLine(backend) : question;
      // After an early answer the request is over: progress stops and the run no longer follows the caller's cancel.
      let detached = false;
      const ac = new AbortController();
      const onAbort = () => ac.abort();
      extra?.signal?.addEventListener("abort", onAbort, { once: true });
      // A caller that asked for progress gets one note per cell, so a person watching sees the digging.
      const token = extra?._meta?.progressToken;
      const onStep =
        token === undefined
          ? null
          : (n, code) =>
              detached ||
              extra
                .sendNotification({ method: "notifications/progress", params: { progressToken: token, progress: n, message: `cell ${n}: ${cellLine(code)}` } })
                .catch(() => {});
      let earlyHit;
      let detachedMs;
      const earlyP = new Promise((resolve) => (earlyHit = resolve));
      const onEarly = kind === "api" && early ? (text) => earlyHit({ text, ms: Date.now() - started }) : undefined;
      const run = (async () => {
        try {
          if (!KINDS[kind]) throw new Error(`backend ${backend} has unknown kind "${kind}"`);
          const r = await KINDS[kind](backend, asked, kind === "api" ? timeoutMs : cliLimitMs(timeoutMs, clientMs), cont, ac.signal, onStep, onEarly);
          const noData = !!(r.ok && D.provides?.length && NO_DATA.test(r.answer ?? ""));
          if (noData) r.answer = r.answer.replace(NO_DATA, "").trimEnd();
          ctx.keep({ question, backend, kind, ...r, ...(noData ? { noData } : {}), ...(detached ? { earlyMs: detachedMs } : {}), ...(fell ? { actionFellThrough: fell } : {}) });
          // Run details go to the journal; the reply shows them only with `footer: true` in config,
          // because callers quote whatever the reply carries.
          const footer = config.footer ? `\n\n[${domainName} · ${backend} · ${Math.round(r.ms / 1000)}s]` : "";
          return { content: [{ type: "text", text: r.answer + footer }], isError: !r.ok, ...(noData ? { _meta: { [NO_DATA_META]: true } } : {}) };
        } catch (e) {
          const cancelled = ac.signal.aborted;
          const message = cancelled ? "the calling client cancelled the ask" : String(e?.message ?? e ?? "unknown error");
          ctx.keep({ question, backend, kind, ok: false, cancelled, continued: cont, error: message.slice(0, 300), ms: Date.now() - started, ...(fell ? { actionFellThrough: fell } : {}) });
          return { content: [{ type: "text", text: `ask failed (${backend}): ${message}` }], isError: true };
        } finally {
          extra?.signal?.removeEventListener("abort", onAbort);
        }
      })();
      const first = await Promise.race([run.then((out) => ({ out })), earlyP.then((e) => ({ early: e }))]);
      if (first.out) return first.out;
      detached = true;
      detachedMs = first.early.ms;
      extra?.signal?.removeEventListener("abort", onAbort);
      pending.set(backend, run);
      ctx.keep({ question, backend, kind, early: true, partial: true, continued: cont, ok: true, ms: first.early.ms, answer: first.early.text, ...(fell ? { actionFellThrough: fell } : {}) });
      return { content: [{ type: "text", text: first.early.text + PARTIAL_NOTE + (config.footer ? `\n\n[${domainName} · ${backend} · early · ${Math.round(first.early.ms / 1000)}s]` : "") }] };
    }),
  );
}

