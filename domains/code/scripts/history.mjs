import fs from "node:fs";
import path from "node:path";

export const meta = {
  purpose:
    "When and why something changed or was removed: commits whose diff adds or removes a term (git log -S), or that touched a path, newest first, with date, author and subject. Several terms at once; a path in another repository is searched there.",
  params: {
    term: "text to find in diffs, or an array of them searched together; optional if path given",
    path: "file or folder, optional; one outside this repository searches its own repository, the top folder of it means all of it",
    limit: "commits per term, default 15",
    regex: "true: term is a regex (git log -G)",
    all: "true: every branch, not only the checked-out one",
  },
  returns: "{commits:[{sha, date, author, subject, term? (with several terms: the ones that found it)}], complete, root? (the other repository searched), none? (terms no commit has)}",
  example: 'await scripts.run("history", { term: ["EMBED_BATCH", "embed_batch"] })',
};

export default async function ({ repo }, { term, path: at, limit = 15, regex = false, all = false }) {
  const terms = [...new Set([].concat(term ?? []).filter(Boolean))];
  if (!terms.length && !at) throw new Error("history needs `term` or `path`");
  let from = repo, where = at;
  if (at && repo.at) {
    const full = path.resolve(repo.root, at);
    const real = fs.existsSync(full) ? fs.realpathSync(full) : full;
    const outside = path.relative(repo.root, real).startsWith("..");
    // A checkout inside the root (a folder of repositories) is searched as itself too.
    const other = fs.existsSync(real) ? (() => { try { return repo.at(real); } catch { return null; } })() : null;
    if (outside && !other) throw new Error(`history: ${at} is not in a git repository on this machine`);
    if (other && other.root !== repo.root) {
      from = other;
      where = path.relative(other.root, real) || null;
    }
  }
  const run = async (t) => {
    const args = [`--max-count=${limit + 1}`, "--date=short", "--format=%h%x09%ad%x09%an%x09%s"];
    if (all) args.push("--all");
    if (t) args.push(regex ? `-G${t}` : `-S${t}`);
    if (where) args.push("--", where);
    const out = await from.git("log", ...args);
    return out
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        const [sha, date, author, ...s] = l.split("\t");
        return { sha, date, author, subject: s.join("\t").slice(0, 140) };
      });
  };
  const found = await Promise.all((terms.length ? terms : [null]).map(run));
  const rows = new Map();
  found.forEach((list, i) => {
    for (const c of list.slice(0, limit)) {
      const row = rows.get(c.sha) ?? rows.set(c.sha, { ...c, ...(terms.length > 1 ? { term: [] } : {}) }).get(c.sha);
      row.term?.push(terms[i]);
    }
  });
  const commits = [...rows.values()];
  if (terms.length > 1) commits.sort((a, b) => b.date.localeCompare(a.date));
  const none = terms.filter((_, i) => !found[i].length);
  return {
    ...(from !== repo ? { root: from.root } : {}),
    commits,
    complete: found.every((l) => l.length <= limit),
    ...(none.length ? { none } : {}),
  };
}
