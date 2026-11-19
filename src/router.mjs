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
import { ROOT, STATE_ROOT, callerSession, loadConfig, resolveKey, slug } from "./config.mjs";
import { loadDomain } from "./domains.mjs";
import { API_PRESETS } from "./providers.mjs";
import { parseDo } from "./shots.mjs";

const SERVER = path.join(ROOT, "src", "server.mjs");

// Fallback only: the first domain whose words appear, else the first enabled domain.
const RULES = [
  ["sessions", /\b(sessions?|we (did|tried|built|said|decided)|discussed|decided|yesterday|last (week|night|time)|earlier|did (i|we|you)|when did|which session|transcripts?)\b/i],
  ["code", /`[^`]+`|\b[\w-]+\/[\w./-]+\.\w+\b|\b(where is|defined|definition|function|struct|module|class|env var|flag|toggle|constant|calls?|implement\w*|in (this|the) (repo|code))\b/i],
];

export async function makeRouter(config) {
  const DOMAINS = {};
  const skipped = {};
  for (const n of Object.entries(config.domains ?? {}).filter(([, d]) => d.enabled !== false).map(([n]) => n)) {
    try {
      const d = await loadDomain(n);
      // A kit that cannot run here (a missing program, setting or folder) is not offered.
      if (d.unavailable) skipped[n] = d.unavailable;
      else DOMAINS[n] = d;
    } catch (e) {
      skipped[n] = String(e.message ?? e).split("\n")[0];
    }
  }
  const enabled = Object.keys(DOMAINS);
  if (!enabled.length) throw new Error(`no domains can run: ${JSON.stringify(skipped)}`);
  // Kits bring their own routing: `patterns` claim a question outright (no model call), and
  // `keywords` join the fallback rules.
  const kitRules = enabled
    .filter((n) => DOMAINS[n].keywords?.length)
    .map((n) => [n, new RegExp(`\\b(${DOMAINS[n].keywords.join("|")})\\b`, "i")]);
  const byPattern = (q) => enabled.find((n) => DOMAINS[n].patterns?.some((re) => re.test(q))) ?? null;
  const byRules = (q) => [...kitRules, ...RULES].find(([n, re]) => DOMAINS[n] && re.test(q))?.[0] ?? enabled[0];
  const hints = enabled.map((n) => DOMAINS[n].routeHint).filter(Boolean);

  const routerBe = config.router?.backend ? config.backends?.list?.[config.router.backend] : null;
  async function byModel(q) {
    if (!routerBe || routerBe.kind !== "api") throw new Error("no router model");
    const preset = API_PRESETS[routerBe.preset] ?? {};
    const base = (routerBe.baseUrl ?? preset.baseUrl).replace(/\/+$/, "");
    const key = resolveKey(routerBe.key) ?? (preset.keyEnv ? process.env[preset.keyEnv] : null);
    const system =
      `Route a question from a coding agent (working in ${process.cwd()}) to the one investigator that can answer it. Reply with one word: ${enabled.join(", ")}.\n` +
      enabled.map((n) => `${n}: ${DOMAINS[n].says}`).join("\n") +
      (DOMAINS.sessions && DOMAINS.code ? "\nPast work (what a session did or why) is sessions even when it is about code; the code as it is now is code." : "") +
      (hints.length ? `\n${hints.join("\n")}` : "");
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({ model: config.router.model ?? routerBe.model, temperature: 0, max_tokens: 200, messages: [{ role: "system", content: system }, { role: "user", content: q.slice(0, 2000) }] }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`router model: HTTP ${res.status}`);
    const j = await res.json();
    const word = (j.choices?.[0]?.message?.content ?? "").toLowerCase().match(/[a-z]+/)?.[0];
    if (!enabled.includes(word)) throw new Error(`router model said "${word}"`);
    return word;
  }
  return { enabled, DOMAINS, byRules, byModel, byPattern, skipped };
}

export async function serveRouter() {
  const config = loadConfig();
  const { enabled, DOMAINS, byRules, byModel, byPattern } = await makeRouter(config);
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
  // shell, a restarted agent) must still reach the same investigator.
  const lastFile = path.join(STATE_ROOT, "router", `last-${slug(SESSION)}.json`);
  let last = (() => {
    try {
      return JSON.parse(fs.readFileSync(lastFile, "utf8")).domain ?? null;
    } catch {
      return null;
    }
  })();
  const remember = (name) => {
    last = name;
    try {
      fs.mkdirSync(path.dirname(lastFile), { recursive: true, mode: 0o700 });
      fs.writeFileSync(lastFile, JSON.stringify({ domain: name, at: new Date().toISOString() }));
    } catch {}
  };

  const server = new McpServer(
    { name: "ask", version: "0.1.0" },
    {
      instructions:
        `One \`ask\` for questions whose answer you would otherwise dig for: ${enabled.map((n) => `${n} (${DOMAINS[n].says})`).join("; ")}. ` +
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
        ". Pass `about` to choose yourself. For a follow-up, pass continue: true. " +
        'To run a kit\'s script with no model, pass do: "<kit>.<script>" and params: the result comes back at once and stays in that kit\'s REPL as shots.<script> for a continue: true question.',
      inputSchema: {
        question: z.string().optional().describe("The question or request, with any ids, names or dates you already know"),
        about: z.enum(enabled).optional().describe("Which investigator; left out, the router chooses"),
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
      let name = about;
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
        const owners = shot.kit ? [shot.kit] : about ? [about] : enabled.length === 1 ? enabled : enabled.filter(has);
        if (owners.length !== 1 || !enabled.includes(owners[0]))
          return { content: [{ type: "text", text: `ask failed: no single kit for do "${doWhat}"${shot.kit && !enabled.includes(shot.kit) ? ` (${shot.kit} is not a kit that can run here)` : ""}; kits: ${enabled.join(", ")}. Write it as "<kit>.<script>".` }], isError: true };
        (name = owners[0]), (how = "shot");
      } else if (!question.trim()) return { content: [{ type: "text", text: "ask needs `question` (or `do` to run a kit script)." }], isError: true };
      if (!name && cont && last) (name = last), (how = "follow-up");
      if (!name && enabled.length === 1) (name = enabled[0]), (how = "only");
      if (!name) {
        const claimed = byPattern(question);
        if (claimed) (name = claimed), (how = "pattern");
      }
      if (!name) {
        try {
          name = await byModel(question);
          how = "model";
        } catch (e) {
          name = byRules(question);
          how = "rules";
          err = String(e.message ?? e).slice(0, 160);
        }
      }
      const args = shot
        ? { ...(question.trim() ? { question } : {}), do: shot.script, ...(params ? { params } : {}), ...(backend ? { backend } : {}), ...(timeoutSeconds ? { timeoutSeconds } : {}) }
        : { question, ...(backend ? { backend } : {}), ...(timeoutSeconds ? { timeoutSeconds } : {}), ...(early === false ? { early: false } : {}), ...(cont && name === last ? { continue: true } : {}) };
      journal({ question: (question || `do ${name}.${shot?.script}`).slice(0, 500), domain: name, how, routeMs: Date.now() - t0, ...(shot ? { do: shot.script } : {}), ...(err ? { routeError: err } : {}) });
      remember(name);
      try {
        const c = await child(name);
        // Pass the investigator's progress (one note per cell) on to the caller, if it asked for it.
        const token = extra?._meta?.progressToken;
        const onprogress = token === undefined ? undefined : (p) => extra.sendNotification({ method: "notifications/progress", params: { ...p, progressToken: token } }).catch(() => {});
        const out = await c.callTool({ name: "ask", arguments: args }, undefined, { timeout: (timeoutSeconds ?? 300) * 1000 + 30_000, signal: extra?.signal, onprogress });
        const text = (out.content ?? []).map((x) => x.text ?? "").join("\n");
        return { ...out, content: [{ type: "text", text: `${text}${!config.footer || ["caller", "only", "shot"].includes(how) ? "" : `\n[routed to ${name} by ${how}]`}` }] };
      } catch (e) {
        return { content: [{ type: "text", text: `ask failed (${name}): ${e.message ?? e}` }], isError: true };
      }
    },
  );
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => process.exit(0));
  await server.connect(new StdioServerTransport());
}
