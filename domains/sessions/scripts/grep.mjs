export const meta = {
  purpose:
    "Exact text anywhere in the transcripts, tool output included: error messages, versions, ids, file names, commands. Words must all appear in one event; pass regex for a pattern.",
  params: { query: "words", regex: "a RegExp source instead of words, optional", hours: "window, default 24*30 (the same as find-sessions; a count needs the whole period asked about)", session: "one session, optional", project: "optional", source: "optional", roles: "e.g. ['tool_result'], optional", max: "default 40" },
  returns: "{window:{since}, total, complete, scanned, hits:[{source,session,project,i,ts,role,tool,snippet}]}",
  example: 'await scripts.run("grep", { query: "EADDRINUSE", hours: 72 })',
};

export default async function ({ history }, { query, regex, hours = 24 * 30, session, project, source, roles, max = 40 }) {
  if (!query && !regex) throw new Error("grep needs `query` or `regex`");
  const hits = await history.grep(regex ? new RegExp(regex, "i") : query, { since: session ? undefined : hours, session, project, source, roles, max });
  return {
    // Said in every result, so an answer that counts things knows which period it counted.
    window: session ? { session } : { since: new Date(Date.now() - hours * 3600_000).toISOString().slice(0, 10) },
    total: hits.total,
    complete: hits.complete,
    scanned: hits.scanned,
    ...(hits.stoppedEarly ? { stoppedEarly: hits.stoppedEarly } : {}),
    hits: hits.map(({ title, ...h }) => ({ ...h, snippet: h.snippet.slice(0, 240) })),
  };
}
