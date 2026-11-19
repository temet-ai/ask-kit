// Shots: one kit script run with no model. `ask` with `do: "<kit>.<script>"` (or `ask-kit run <kit>
// <script> key=value`) runs the script as one cell of the kit's REPL, `shots[name] = await
// scripts.run(name, params)`, and hands its result straight back. The value stays in that REPL's
// snapshot, so a later `continue: true` question finds it as `shots.<script>` without running it
// again. Nothing here calls a backend; the cell is journaled like any other.

const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/** "status" or "github.status" → { kit, script }; kit is null when not given. */
export function parseDo(value) {
  const s = String(value ?? "").trim();
  const i = s.lastIndexOf(".");
  const kit = i > 0 ? s.slice(0, i) : null;
  const script = i > 0 ? s.slice(i + 1) : s;
  if (!NAME.test(script) || (kit !== null && !NAME.test(kit))) throw new Error(`do: "<script>" or "<kit>.<script>" (got ${JSON.stringify(s)})`);
  return { kit, script };
}

/** `key=value` words from a shell into params; a value that parses as JSON (numbers, true, [..]) is taken as JSON. */
export function parseParams(words) {
  const params = {};
  for (const w of words) {
    const i = w.indexOf("=");
    if (i < 1) throw new Error(`params are key=value (got ${JSON.stringify(w)})`);
    const raw = w.slice(i + 1);
    let v = raw;
    try {
      v = JSON.parse(raw);
    } catch {}
    params[w.slice(0, i)] = v;
  }
  return params;
}

/** The cell a shot runs: refuses an unknown script with the kit's list, keeps the value in `shots`. */
export function shotCell(script, params = {}) {
  const n = JSON.stringify(script);
  return [
    `// shot: ${script}`,
    `if (!scripts.list().some((s) => s.name === ${n})) throw new Error("no script " + ${JSON.stringify(JSON.stringify(script))} + " in this kit. Its scripts: " + (scripts.list().map((s) => s.name).join(", ") || "none"));`,
    "globalThis.shots ??= {};",
    `shots[${n}] = await scripts.run(${n}, ${JSON.stringify(params ?? {})});`,
    `shots[${n}]`,
  ].join("\n");
}

// The REPL wraps a cell's result in notes meant for an investigator: a restore line first, a
// timing line last. A shot's caller wants the result only.
function bareResult(text) {
  const parts = String(text).split("\n\n");
  while (parts.length > 1 && /^\[(restored|did not restore|could not restore) /.test(parts[0])) parts.shift();
  while (parts.length > 1 && /^\[(\d+ ms, \d+ calls?|not kept across restarts: .*)\]$/.test(parts.at(-1))) parts.pop();
  return parts.join("\n\n").replace(/^Error: /, "");
}

/**
 * Run one shot in a REPL. `repl` is an MCP client of src/server.mjs in inner mode (the kit's REPL);
 * the caller opens and closes it. Returns { text, ok, ms }.
 */
export async function runShot(repl, { script, params = {}, maxChars = 4000, timeoutSeconds = 120 }) {
  const started = Date.now();
  const out = await repl.callTool({ name: "repl", arguments: { code: shotCell(script, params), maxChars, timeoutSeconds } }, undefined, { timeout: timeoutSeconds * 1000 + 5000 });
  const text = bareResult((out.content ?? []).map((c) => c.text ?? "").join("\n"));
  // A failed script's stack and shape notes are for an investigator; the caller gets the message.
  return { text: out.isError ? text.split("\n")[0] : text, ok: !out.isError, ms: Date.now() - started };
}

export const shotFooter = (kit, script, ms) => `\n\n[${kit} · shot ${script} · ${Math.round(ms / 1000)}s]`;
