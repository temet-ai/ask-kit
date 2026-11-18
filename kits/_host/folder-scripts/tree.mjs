export const meta = {
  purpose:
    "The folder at a glance: sub-folders with file counts, file types, the most recently changed files, and the README or index files to read first.",
  params: { path: "a sub-folder, optional", depth: "folder depth counted, default 2" },
  returns: "{root, files, dirs:[{dir, files}], types:{ext: n}, recent:[{file, modified}], readFirst:[file]}",
  example: 'await scripts.run("tree")',
};

import fs from "node:fs";
import nodePath from "node:path";

export default async function ({ folder }, { path, depth = 2 }) {
  const files = await folder.files(undefined, { path, max: 100000 });
  const counts = {};
  const types = {};
  for (const f of files) {
    const parts = f.split("/");
    if (parts.length > 1) {
      const dir = parts.slice(0, Math.min(depth, parts.length - 1)).join("/");
      counts[dir] = (counts[dir] ?? 0) + 1;
    }
    const ext = nodePath.extname(f) || "(none)";
    types[ext] = (types[ext] ?? 0) + 1;
  }
  const withTime = files.slice(0, 20000).map((f) => {
    try {
      return { file: f, t: fs.statSync(nodePath.join(folder.root, f)).mtimeMs };
    } catch {
      return { file: f, t: 0 };
    }
  });
  const recent = withTime.sort((a, b) => b.t - a.t).slice(0, 12).map((x) => ({ file: x.file, modified: new Date(x.t).toISOString().slice(0, 16) }));
  return {
    root: folder.root,
    files: files.total,
    dirs: Object.entries(counts).map(([dir, n]) => ({ dir, files: n })).sort((a, b) => b.files - a.files).slice(0, 40),
    types: Object.fromEntries(Object.entries(types).sort((a, b) => b[1] - a[1]).slice(0, 12)),
    recent,
    readFirst: files.filter((f) => /(^|\/)(README|INDEX|index|AGENTS|SUMMARY|overview)\.(md|mdx|txt|rst)$/i.test(f)).slice(0, 10),
  };
}
