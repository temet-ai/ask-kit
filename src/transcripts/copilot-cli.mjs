// GitHub Copilot CLI: ~/.copilot/session-state/<session id>/events.jsonl (COPILOT_HOME moves
// ~/.copilot). Lines are {type, data, id, timestamp}: session.start, user.message,
// assistant.message, tool.execution_start / tool.execution_complete, session.usage_record.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { head, indexed, parseLines, textOf, titleOf } from "./common.mjs";

const base = () => path.join(process.env.COPILOT_HOME || path.join(os.homedir(), ".copilot"), "session-state");

function files() {
  try {
    return fs
      .readdirSync(base(), { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith("."))
      .map((d) => path.join(base(), d.name, "events.jsonl"))
      .filter((f) => fs.existsSync(f));
  } catch {
    return [];
  }
}

function meta(file) {
  let id = path.basename(path.dirname(file));
  let cwd = null;
  let startedAt = null;
  let title = null;
  let model = null;
  for (const line of head(file).split("\n")) {
    if (!line) continue;
    let r;
    try {
      r = JSON.parse(line);
    } catch {
      continue;
    }
    if (r.type === "session.start") {
      id = r.data?.sessionId ?? id;
      cwd = r.data?.context?.cwd ?? null;
      startedAt = r.data?.startTime ?? r.timestamp;
      model = r.data?.selectedModel ?? null;
    }
    if (!title && r.type === "user.message") title = titleOf(r.data?.content);
    if (startedAt && title) break;
  }
  if (!startedAt) return null;
  return { id, cwd, project: cwd ? path.basename(cwd) : null, startedAt, title, model };
}

// o.usage: also a "usage" event per model call (session.usage_record) and `req` on tool calls,
// the number of the assistant.turn_start both follow.
function events(s, o = {}) {
  const out = [];
  const push = (e) => out.push({ i: out.length, ...e });
  let turn = 0;
  for (const r of parseLines(s.file)) {
    const ts = r.timestamp;
    const d = r.data ?? {};
    if (o.usage && r.type === "assistant.turn_start") turn++;
    if (o.usage && r.type === "session.usage_record") {
      const u = d.usage ?? {};
      push({ ts, role: "usage", req: String(turn), model: u.model, text: "", tokens: { input: u.inputTokens ?? 0, cacheWrite: u.cacheWriteTokens ?? 0, cacheRead: u.cacheReadTokens ?? 0, output: u.outputTokens ?? 0 } });
    }
    switch (r.type) {
      case "user.message":
        push({ ts, role: "user", text: textOf(d.content) });
        break;
      case "assistant.message":
        if (d.content) push({ ts, role: "assistant", text: textOf(d.content), model: d.model });
        break;
      case "tool.execution_start":
        // An MCP tool is named "<server>-<tool>"; `server` says where the split is.
        push({ ts, role: "tool_call", tool: d.toolName, toolId: d.toolCallId, input: d.arguments, text: JSON.stringify(d.arguments ?? {}), model: d.model, ...(d.mcpServerName ? { server: d.mcpServerName } : {}), ...(o.usage ? { req: String(turn) } : {}) });
        break;
      case "tool.execution_complete":
        push({ ts, role: "tool_result", toolId: d.toolCallId, ok: d.success !== false, text: textOf(d.result?.content ?? d.result ?? d.error) });
        break;
    }
  }
  return out;
}

function usage(s) {
  const byModel = {};
  for (const r of parseLines(s.file)) {
    if (r.type !== "session.usage_record") continue;
    const u = r.data?.usage ?? {};
    const m = (byModel[u.model ?? "unknown"] ??= { calls: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, premiumRequests: 0 });
    m.calls++;
    m.input += u.inputTokens ?? 0;
    m.cacheRead += u.cacheReadTokens ?? 0;
    m.cacheWrite += u.cacheWriteTokens ?? 0;
    m.output += u.outputTokens ?? 0;
    m.premiumRequests += Number(u.cost ?? 0);
  }
  return byModel;
}

export const adapter = {
  name: "copilot-cli",
  label: "GitHub Copilot CLI",
  where: () => base(),
  available: () => fs.existsSync(base()),
  sessions: () => indexed("copilot-cli", files(), meta),
  events,
  usage,
};
