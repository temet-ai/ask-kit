export const meta = {
  purpose:
    "When and why something changed: commits whose diff adds or removes a term (git log -S), or that touched a path, newest first, with date, author and subject.",
  params: { term: "text to find in diffs, optional if path given", path: "file or folder, optional", limit: "commits, default 15", regex: "true: term is a regex (git log -G)" },
  returns: "{commits:[{sha, date, author, subject}], complete}",
  example: 'await scripts.run("history", { term: "EMBED_BATCH" })',
};

export default async function ({ repo }, { term, path, limit = 15, regex = false }) {
  if (!term && !path) throw new Error("history needs `term` or `path`");
  const args = [`--max-count=${limit + 1}`, "--date=short", "--format=%h%x09%ad%x09%an%x09%s"];
  if (term) args.push(regex ? `-G${term}` : `-S${term}`);
  if (path) args.push("--", path);
  const out = await repo.git("log", ...args);
  const commits = out
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [sha, date, author, ...s] = l.split("\t");
      return { sha, date, author, subject: s.join("\t").slice(0, 140) };
    });
  return { commits: commits.slice(0, limit), complete: commits.length <= limit };
}
