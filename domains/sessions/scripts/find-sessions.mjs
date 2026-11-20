export const meta = {
  purpose:
    "Which sessions did or discussed a topic: searches what people typed and what agents said (and, with tools: true, tool calls) for the topic's words, ranks sessions by hits (prompts weighing most) and by a digest of each session: title or first prompt, project, top terms.",
  params: {
    topic: "a few distinctive words, e.g. 'flaky retry test'",
    hours: "window, default 24*30",
    project: "optional",
    source: "optional",
    tools: "also search tool calls and results, default false",
    any: "match sessions holding any one word (default: each event must hold all words; retried with fewer words when nothing matches)",
  },
  returns: "{query, total, complete, sessions:[{source,id,project,title,startedAt,hits,userHits,score,digest:{terms,firstPrompt,startedAt,updatedAt},first:{i,role,snippet}}]}",
  example: 'await scripts.run("find-sessions", { topic: "keyboard layout" })',
};

const STOP = new Set(["the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "what", "which", "did", "we", "was", "is", "how", "why", "when", "about"]);

export default async function ({ history }, { topic, hours = 24 * 30, project, source, tools = false, any = false }) {
  if (!topic) throw new Error("find-sessions needs `topic`");
  const words = String(topic).toLowerCase().split(/\s+/).filter((w) => w && !STOP.has(w));
  const roles = tools ? ["user", "assistant", "tool_call", "tool_result"] : ["user", "assistant"];
  const opts = { since: hours, project, source, roles, max: 400 };
  let query = words.join(" ");
  let hits = [];
  if (any) {
    // Any one word: search each word alone (grep wants every word in one event), then merge.
    for (const w of words) hits.push(...(await history.grep(w, { ...opts, max: 150 })));
    query = words.join(" | ");
  } else hits = await history.grep(query, opts);
  // Nothing with every word in one event: drop to the two longest words, then to each word alone.
  if (!any && !hits.length && words.length > 2) {
    query = [...words].sort((a, b) => b.length - a.length).slice(0, 2).join(" ");
    hits = await history.grep(query, opts);
  }
  if (!any && !hits.length && words.length > 1) {
    const all = [];
    for (const w of words) all.push(...(await history.grep(w, { ...opts, max: 150 })));
    hits = all;
    query = words.join(" | ");
  }
  const by = new Map();
  for (const h of hits) {
    const k = `${h.source}:${h.session}`;
    const s = by.get(k) ?? { source: h.source, id: h.session, project: h.project, title: h.title, startedAt: h.ts, hits: 0, userHits: 0, first: { i: h.i, role: h.role, snippet: h.snippet.slice(0, 200) } };
    s.hits++;
    if (h.role === "user") s.userHits++;
    by.set(k, s);
  }
  // Rank on hits and on the session's digest (title or first prompt, project, top terms). Hits count
  // up to 20 so one chatty session cannot bury a session whose title or prompts are about the topic.
  const found = [...by.values()];
  const digests = history.digests ? await history.digests(found) : [];
  const has = (text, w) => String(text ?? "").toLowerCase().includes(w);
  found.forEach((s, n) => {
    const d = digests[n];
    let bonus = 0;
    if (d) for (const w of words) bonus += (has(d.title, w) || has(d.firstPrompt, w) ? 6 : 0) + (d.terms.includes(w) ? 3 : 0) + (has(d.project, w) ? 2 : 0);
    s.score = Math.min(s.userHits * 3 + s.hits, 20) + bonus;
    if (d) s.digest = { terms: d.terms.slice(0, 6), firstPrompt: d.firstPrompt?.slice(0, 120) ?? null, startedAt: d.startedAt, updatedAt: d.updatedAt };
  });
  const sessions = found.sort((a, b) => b.score - a.score || b.hits - a.hits).slice(0, 15);
  return { query, total: by.size, complete: hits.complete !== false, sessions };
}
