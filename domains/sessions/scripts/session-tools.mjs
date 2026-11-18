export const meta = {
  purpose: "What a session ran: each tool call with its input clipped, whether it failed and the start of the failure; plus token use by model.",
  params: { session: "id or prefix", tool: "only this tool (substring), optional", failedOnly: "only failed calls, default false", max: "rows, default 60" },
  returns: "{session, counts:{tool:{calls,failed}}, usage, calls:[{i,tool,input,ok,error}]}",
  example: 'await scripts.run("session-tools", { session: "d15c0de1", failedOnly: true })',
};

export default async function ({ history }, { session, tool, failedOnly = false, max = 60 }) {
  if (!session) throw new Error("session-tools needs `session`");
  const ev = await history.events(session);
  const results = new Map(ev.filter((e) => e.role === "tool_result").map((e) => [e.toolId, e]));
  const counts = {};
  const calls = [];
  for (const c of ev.filter((e) => e.role === "tool_call")) {
    const r = results.get(c.toolId);
    const ok = r ? r.ok !== false : null;
    const t = (counts[c.tool] ??= { calls: 0, failed: 0 });
    t.calls++;
    if (ok === false) t.failed++;
    if (tool && !String(c.tool).toLowerCase().includes(tool.toLowerCase())) continue;
    if (failedOnly && ok !== false) continue;
    calls.push({ i: c.i, tool: c.tool, input: c.text.slice(0, 200), ok, ...(ok === false ? { error: r.text.slice(0, 240) } : {}) });
  }
  return { session: ev.session.id, source: ev.session.source, counts, usage: await history.usage(session), calls: calls.slice(0, max), more: Math.max(0, calls.length - max) };
}
