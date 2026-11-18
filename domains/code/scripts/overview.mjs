export const meta = {
  purpose:
    "The repository at a glance: top-level folders with file counts, the docs an agent should read first (README, AGENTS.md, CLAUDE.md, docs/ARCHITECTURE*), their headings, manifests (Cargo.toml, package.json, pyproject.toml), and recent commits.",
  params: { depth: "folder depth counted, default 2" },
  returns: "{root, files, dirs:[{dir, files}], docs:[{file, headings}], manifests:[string], recent:[string]}",
  example: 'await scripts.run("overview")',
};

export default async function ({ repo }, { depth = 2 }) {
  const files = await repo.files(undefined, { max: 200000 });
  const counts = {};
  for (const f of files) {
    const parts = f.split("/");
    if (parts.length < 2) continue;
    const dir = parts.slice(0, Math.min(depth, parts.length - 1)).join("/");
    counts[dir] = (counts[dir] ?? 0) + 1;
  }
  const dirs = Object.entries(counts)
    .map(([dir, n]) => ({ dir, files: n }))
    .sort((a, b) => b.files - a.files)
    .slice(0, 40);
  const docNames = files.filter((f) => /^(README|AGENTS|CLAUDE)\.md$|^docs\/(ARCHITECTURE|README|GUIDE)[^/]*\.md$/i.test(f)).slice(0, 8);
  const docs = docNames.map((file) => {
    const { text } = repo.read(file, { from: 1, to: 400 });
    const headings = text
      .split("\n")
      .map((l) => l.replace(/^\d+\t/, ""))
      .filter((l) => /^#{1,3}\s/.test(l))
      .slice(0, 25);
    return { file, headings };
  });
  const manifests = files.filter((f) => /(^|\/)(Cargo\.toml|package\.json|pyproject\.toml|go\.mod)$/.test(f) && f.split("/").length <= 3).slice(0, 30);
  const recent = (await repo.git("log", "--max-count=8", "--date=short", "--format=%h %ad %s")).split("\n").filter(Boolean);
  return { root: repo.root, files: files.total, dirs, docs, manifests, recent };
}
