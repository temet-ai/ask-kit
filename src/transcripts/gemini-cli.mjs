// Gemini CLI: ~/.gemini/tmp/<project hash>/chats/session-*.json, one JSON document per session:
// {sessionId, projectHash, startTime, lastUpdated, messages: [{timestamp, type: "user" | "gemini" |
// "info" | "error", content, toolCalls: [{id, name, args, result, status}], model}]}.
// Not yet checked against a real store (none on the machine this was written on), so every
// field is read defensively.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { textOf, titleOf, indexed, walk } from "./common.mjs";

const base = () => path.join(process.env.GEMINI_CLI_HOME || path.join(os.homedir(), ".gemini"), "tmp");
const files = () => walk(base(), /^session-.*\.json$/, 3);
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

function meta(file) {
  const j = read(file);
  const first = (j.messages ?? []).find((m) => m.type === "user");
  return {
    id: j.sessionId ?? path.basename(file, ".json"),
    cwd: null,
    project: j.projectHash ? `gemini:${String(j.projectHash).slice(0, 8)}` : null,
    startedAt: j.startTime ?? first?.timestamp ?? null,
    title: titleOf(textOf(first?.content)),
  };
}

function events(s) {
  const out = [];
  const push = (e) => out.push({ i: out.length, ...e });
  for (const m of read(s.file).messages ?? []) {
    const ts = m.timestamp;
    if (m.type === "user") push({ ts, role: "user", text: textOf(m.content) });
    else if (m.type === "gemini") {
      if (m.content) push({ ts, role: "assistant", text: textOf(m.content), model: m.model });
      for (const t of m.toolCalls ?? []) {
        push({ ts: t.timestamp ?? ts, role: "tool_call", tool: t.name, toolId: t.id, input: t.args, text: JSON.stringify(t.args ?? {}) });
        if (t.result != null) push({ ts: t.timestamp ?? ts, role: "tool_result", toolId: t.id, ok: t.status !== "error", text: textOf(t.result) });
      }
    } else push({ ts, role: "system", text: textOf(m.content) });
  }
  return out;
}

function usage(s) {
  const byModel = {};
  for (const m of read(s.file).messages ?? []) {
    if (!m.tokens) continue;
    const u = (byModel[m.model ?? "unknown"] ??= { calls: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0 });
    u.calls++;
    u.input += m.tokens.input ?? 0;
    u.cacheRead += m.tokens.cached ?? 0;
    u.output += m.tokens.output ?? 0;
  }
  return byModel;
}

export const adapter = {
  name: "gemini-cli",
  label: "Gemini CLI",
  where: () => base(),
  available: () => files().length > 0,
  sessions: () => indexed("gemini-cli", files(), meta),
  events,
  usage,
};
