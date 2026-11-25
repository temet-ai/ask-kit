import { NOISE, definitionPattern, escape, spellings } from "../lib.mjs";

export const meta = {
  purpose:
    "Where a name is defined and where it is used, across every spelling (fooBar, foo_bar, FOO_BAR, foo-bar), generated and vendored files left out.",
  params: { name: "identifier or words, e.g. 'embed worker' or 'EmbedWorker'", path: "folder to search, optional", uses: "usage lines returned, default 25" },
  returns: "{spellings, definitions:[{file,line,text}], usesTotal, usesByFile:[{file,count}] (top 20), uses:[{file,line,text}]}",
  example: 'await scripts.run("where", { name: "invoice worker" })',
};

export default async function ({ repo }, { name, path, uses = 25 }) {
  const names = spellings(name);
  if (!names.length) throw new Error("where needs `name`");
  const definitions = await repo.rg(definitionPattern(names), { glob: NOISE, path, max: 40, ignoreCase: false });
  const all = await repo.rg(`\\b(${names.map(escape).join("|")})\\b`, { glob: NOISE, path, max: 2000 });
  if (all.missing) return { spellings: names, missing: all.missing };
  const defKeys = new Set(definitions.map((d) => `${d.file}:${d.line}`));
  const rest = all.filter((h) => !defKeys.has(`${h.file}:${h.line}`));
  const byFile = Object.entries(
    rest.reduce((m, h) => ((m[h.file] = (m[h.file] ?? 0) + 1), m), {}),
  )
    .map(([file, count]) => ({ file, count }))
    .sort((a, b) => b.count - a.count);
  return {
    spellings: names,
    definitions: definitions.map(({ file, line, text }) => ({ file, line, text: text.trim().slice(0, 160) })),
    usesTotal: all.total - definitions.length,
    usesComplete: all.complete,
    usesByFile: byFile.slice(0, 20),
    uses: rest.slice(0, uses).map(({ file, line, text }) => ({ file, line, text: text.trim().slice(0, 140) })),
  };
}
