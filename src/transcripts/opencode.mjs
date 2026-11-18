// opencode: one SQLite database, ~/.local/share/opencode/opencode.db. Sessions are rows of
// session_v2 (directory, title, times in ms, token totals); messages are rows of session_message
// (type "user" | "assistant" | ..., seq, data as JSON). Read with node:sqlite, read-only.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { textOf, titleOf } from "./common.mjs";

const dbFile = () =>
  process.env.OPENCODE_DB || path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local/share"), "opencode", "opencode.db");

async function open() {
  const { DatabaseSync } = await import("node:sqlite");
  return new DatabaseSync(dbFile(), { readOnly: true });
}

async function sessions() {
  const db = await open();
  try {
    return db
      .prepare("select id, directory, title, time_created, time_updated, model from session_v2 where time_archived is null")
      .all()
      .map((r) => ({
        source: "opencode",
        id: r.id,
        file: dbFile(),
        cwd: r.directory,
        project: r.directory ? path.basename(r.directory) : null,
        startedAt: new Date(r.time_created).toISOString(),
        updatedAt: new Date(r.time_updated).toISOString(),
        title: titleOf(r.title),
        model: safe(r.model)?.id ?? null,
      }));
  } finally {
    db.close();
  }
}

const safe = (s) => {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

async function events(s) {
  const db = await open();
  const out = [];
  const push = (e) => out.push({ i: out.length, ...e });
  try {
    for (const r of db.prepare("select type, time_created, data from session_message where session_id = ? order by seq").all(s.id)) {
      const d = safe(r.data) ?? {};
      const ts = new Date(r.time_created).toISOString();
      if (r.type === "user") push({ ts, role: "user", text: textOf(d.text ?? d.content) });
      else if (r.type === "assistant") {
        for (const c of Array.isArray(d.content) ? d.content : [d]) {
          if (c.type === "reasoning") continue;
          if (c.type === "tool" || c.tool || c.callID) {
            push({ ts, role: "tool_call", tool: c.tool ?? c.name, toolId: c.callID ?? c.id, text: JSON.stringify(c.input ?? c.state?.input ?? {}) });
            const result = c.output ?? c.state?.output;
            if (result != null) push({ ts, role: "tool_result", toolId: c.callID ?? c.id, ok: c.state?.status !== "error", text: textOf(result) });
          } else if (c.text) push({ ts, role: "assistant", text: c.text, model: d.model?.id });
        }
      }
    }
  } finally {
    db.close();
  }
  return out;
}

async function usage(s) {
  const db = await open();
  try {
    const r = db.prepare("select model, tokens_input, tokens_output, tokens_cache_read, tokens_cache_write, cost from session_v2 where id = ?").get(s.id);
    if (!r) return {};
    return {
      [safe(r.model)?.id ?? "unknown"]: { input: r.tokens_input, output: r.tokens_output, cacheRead: r.tokens_cache_read, cacheWrite: r.tokens_cache_write, costUsd: r.cost },
    };
  } finally {
    db.close();
  }
}

export const adapter = {
  name: "opencode",
  label: "opencode",
  where: dbFile,
  available: () => fs.existsSync(dbFile()),
  sessions,
  events,
  usage,
  // No files to pre-filter: a search reads every session's messages.
  noPrefilter: true,
};
