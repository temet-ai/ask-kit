export const meta = {
  purpose: "Sessions in a time window, newest first, across every enabled agent; optionally one project or source.",
  params: { hours: "window, default 24", project: "project or cwd substring, optional", source: "claude-code | codex | copilot-cli | gemini-cli | opencode, optional", limit: "rows, default 30" },
  returns: "{total, bySource:{source:n}, sessions:[{source,id,project,title,startedAt,updatedAt}]}",
  example: 'await scripts.run("recent", { hours: 48, project: "shop-api" })',
};

export default async function ({ history }, { hours = 24, project, source, limit = 30 }) {
  const list = await history.sessions({ since: hours, project, source, limit: 10_000 });
  const bySource = {};
  for (const s of list) bySource[s.source] = (bySource[s.source] ?? 0) + 1;
  return {
    total: list.total,
    bySource,
    sessions: list.slice(0, limit).map(({ source, id, project, title, startedAt, updatedAt }) => ({ source, id, project, title, startedAt, updatedAt })),
  };
}
