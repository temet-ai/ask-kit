export const meta = {
  purpose:
    "Files a session created or edited, from its edit tool calls (Claude Code Edit/Write/MultiEdit/NotebookEdit, Codex apply_patch, Copilot edit/create, and others with a file path), with how many times each.",
  params: { session: "id or prefix" },
  returns: "{session, files:[{path,edits,tools,firstI,lastI}], shellWrites:[{i,text}] (shell commands that look like writes)}",
  example: 'await scripts.run("session-changes", { session: "5ca1ab1e" })',
};

const EDIT = /^(edit|write|multiedit|notebookedit|apply_patch|create|str_replace|insert|write_file|replace|patch)/i;

function pathsOf(c) {
  const out = new Set();
  const inp = c.input ?? (() => { try { return JSON.parse(c.text); } catch { return null; } })();
  for (const k of ["file_path", "path", "filePath", "notebook_path", "file", "target_file"]) if (inp && typeof inp[k] === "string") out.add(inp[k]);
  // apply_patch bodies name files on "*** Update File:" / "*** Add File:" lines.
  for (const m of String(c.text).matchAll(/\*\*\* (?:Update|Add|Delete) File: ([^\n\\"]+)/g)) out.add(m[1].trim());
  return [...out];
}

export default async function ({ history }, { session }) {
  if (!session) throw new Error("session-changes needs `session`");
  const ev = await history.events(session);
  const files = new Map();
  const shellWrites = [];
  for (const c of ev.filter((e) => e.role === "tool_call")) {
    const name = String(c.tool ?? "");
    const isEdit = EDIT.test(name) || /apply_patch|\*\*\* (Update|Add) File:/.test(c.text);
    if (isEdit) {
      for (const p of pathsOf(c)) {
        const f = files.get(p) ?? { path: p, edits: 0, tools: new Set(), firstI: c.i, lastI: c.i };
        f.edits++;
        f.tools.add(name);
        f.lastI = c.i;
        files.set(p, f);
      }
    } else if (/(^|\s)(sed -i|tee |cat >|> ?[\w./~-]+\.\w+|mv |cp |rm )/.test(c.text)) shellWrites.push({ i: c.i, text: c.text.slice(0, 160) });
  }
  return {
    session: ev.session.id,
    source: ev.session.source,
    files: [...files.values()].map((f) => ({ ...f, tools: [...f.tools] })).sort((a, b) => b.edits - a.edits),
    shellWrites: shellWrites.slice(0, 20),
  };
}
