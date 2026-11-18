export const meta = {
  purpose:
    "One session, compactly: every prompt the person typed, the agent's replies (clipped), and the tools it used with counts and failures. Optionally only events from..to, or a focus word.",
  params: { session: "id or prefix", from: "first event, optional", to: "last event, optional", focus: "a word: keep only events holding it, plus every prompt", reply: "chars kept per reply, default 500" },
  returns: "{session:{source,id,project,title,startedAt,updatedAt}, events, prompts:[{i,ts,text}], replies:[{i,text}], tools:{name:{calls,failed}}}",
  example: 'await scripts.run("session-digest", { session: "5ca1ab1e" })',
};

export default async function ({ history }, { session, from, to, focus, reply = 500 }) {
  if (!session) throw new Error("session-digest needs `session`");
  const ev = await history.events(session, { from, to });
  const f = focus?.toLowerCase();
  const keep = (e) => !f || e.text?.toLowerCase().includes(f);
  const prompts = ev.filter((e) => e.role === "user").map((e) => ({ i: e.i, ts: e.ts, text: e.text.slice(0, 800) }));
  const replies = ev.filter((e) => e.role === "assistant" && e.text?.trim() && keep(e)).map((e) => ({ i: e.i, text: e.text.slice(0, reply) }));
  const byId = new Map(ev.filter((e) => e.role === "tool_result").map((e) => [e.toolId, e]));
  const tools = {};
  for (const c of ev.filter((e) => e.role === "tool_call")) {
    const t = (tools[c.tool] ??= { calls: 0, failed: 0 });
    t.calls++;
    if (byId.get(c.toolId)?.ok === false) t.failed++;
  }
  const { source, id, project, title, startedAt, updatedAt } = ev.session;
  return {
    session: { source, id, project, title, startedAt, updatedAt },
    events: ev.total,
    prompts,
    replies: replies.length > 40 ? [...replies.slice(0, 10), { skipped: replies.length - 30 }, ...replies.slice(-20)] : replies,
    tools,
  };
}
