// `ask.kit(name, question, { continue })` in a REPL cell: one kit's investigator asks another kit's.
// The target's server starts the way the router starts it (src/server.mjs with ASK_KIT_DOMAIN, outer
// face, so its `ask` tool answers), is kept for the REPL's life, and runs with ASK_KIT_DEPTH=1: an
// ask.kit inside it is refused. Each call is journaled through push() with the target kit, seconds
// and cost read from the answer's footer.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";
import { ROOT } from "./config.mjs";

export const MAX_DEPTH = 1;
const SERVER = path.join(ROOT, "src", "server.mjs");
const SESSION_VARS = ["ASK_KIT_SESSION", "CLAUDE_CODE_SESSION_ID", "CODEX_THREAD_ID", "CODEX_SESSION_ID", "COPILOT_SESSION_ID", "ASK_KIT_INNER", "ASK_KIT_CALLER", "ASK_KIT_INHERIT"];

// "[kit · backend · 12s · $0.0031]" at the end of an ask's answer.
export function parseFooter(text) {
  const m = /\[([^\]\n·]+) · ([^\]\n·]+) · (\d+)s(?: · \$([\d.]+))?\]\s*$/.exec(text.replace(/\n\[routed to [^\]]*\]\s*$/, ""));
  return m ? { backend: m[2].trim(), seconds: Number(m[3]), costUsd: m[4] ? Number(m[4]) : 0 } : {};
}

// Kits that can run here: enabled in the config and available on this machine.
async function runnable(config) {
  const { makeRouter } = await import("./router.mjs");
  const r = await makeRouter(config);
  return r.enabled;
}

// from: this REPL's kit, to refuse a kit asking itself. session: the calling session, passed through
// so `continue: true` finds the same investigator. connect/runnableKits are for tests.
export function makeAskKit({ config, from, session, push, depth = Number(process.env.ASK_KIT_DEPTH) || 0, connect, runnableKits }) {
  const children = new Map();
  const open = (name) => {
    if (children.has(name)) return children.get(name);
    const p = (connect ?? defaultConnect)(name, { depth: depth + 1, session });
    children.set(name, p);
    p.catch(() => children.delete(name));
    return p;
  };
  async function askKit(name, question, opts = {}) {
    if (depth >= MAX_DEPTH) throw new Error(`ask.kit is refused here: this investigator was itself started by ask.kit (depth ${depth}, the limit is ${MAX_DEPTH}). Answer from your own sources, or say what the other kit would know.`);
    if (typeof name !== "string" || typeof question !== "string" || !question.trim()) throw new Error('ask.kit(name, question, { continue }): both are strings, e.g. ask.kit("sessions", "what did we decide about X?")');
    const names = await (runnableKits ?? (() => runnable(config)))();
    const others = names.filter((n) => n !== from);
    if (name === from) throw new Error(`ask.kit: "${name}" is this kit; ask the others: ${others.join(", ") || "none can run"}`);
    if (!names.includes(name)) throw new Error(`ask.kit: no kit "${name}" can run here. Kits that can: ${others.join(", ") || "none"}`);
    const t0 = Date.now();
    let text = "";
    let failed = null;
    try {
      const c = await open(name);
      const out = await c.callTool({ name: "ask", arguments: { question, ...(opts.continue ? { continue: true } : {}) } }, undefined, { timeout: 300_000 });
      text = (out.content ?? []).map((x) => x.text ?? "").join("\n");
      if (out.isError) failed = text.slice(0, 300) || "the other kit's ask failed";
    } catch (e) {
      failed = String(e.message ?? e).slice(0, 300);
    }
    const f = parseFooter(text);
    push?.({ kind: "ask.kit", kit: name, detail: question.slice(0, 200), ms: Date.now() - t0, seconds: f.seconds ?? Math.round((Date.now() - t0) / 1000), costUsd: f.costUsd ?? 0, ...(f.backend ? { backend: f.backend } : {}), ...(failed ? { error: failed } : {}) });
    if (failed) throw new Error(`ask.kit(${name}) failed: ${failed}`);
    return text;
  }
  askKit.close = () => Promise.all([...children.values()].map((p) => p.then((c) => c.close()).catch(() => {})));
  return askKit;
}

async function defaultConnect(name, { depth, session }) {
  const env = { ...process.env };
  for (const k of SESSION_VARS) delete env[k];
  Object.assign(env, { ASK_KIT_DOMAIN: name, ASK_KIT_DEPTH: String(depth), ...(session ? { ASK_KIT_SESSION: session } : {}) });
  // ASK_KIT_KITCALL_SERVER swaps the server script: tests start a stub MCP server with no model.
  const script = process.env.ASK_KIT_KITCALL_SERVER || SERVER;
  const c = new Client({ name: "ask-kit-kitcall", version: "0" });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [script], env, cwd: process.cwd(), stderr: "ignore" }));
  return c;
}
