import { NOISE } from "../lib.mjs";

export const meta = {
  purpose:
    "What a file or folder holds: its top-level definitions (fn, struct, enum, trait, impl, class, function, const, def, export, SQL create) with line numbers, and for a folder the same per file.",
  params: { path: "file or folder", max: "definitions returned, default 120" },
  returns: "{path, files:number (count), definitions:[{file,line,text}], complete}",
  example: 'await scripts.run("outline", { path: "src/billing" })',
};

const DEF =
  "^\\s*(pub(\\([a-z]+\\))?\\s+)?(async\\s+)?(fn|struct|enum|trait|impl|mod|type|const|static)\\b" +
  "|^\\s*(export\\s+)?(default\\s+)?(async\\s+)?(function|class|interface|type|const|let)\\s+[A-Za-z_$]" +
  "|^\\s*(def|class|async def)\\s+\\w" +
  "|^func\\s" +
  "|^\\s*create\\s+(table|view|function|index)" +
  "|^#{1,3}\\s";

export default async function ({ repo }, { path, max = 120 }) {
  if (!path) throw new Error("outline needs `path`");
  const hits = await repo.rg(DEF, { path, glob: NOISE, max, ignoreCase: true });
  const files = [...new Set(hits.map((h) => h.file))];
  return {
    path,
    files: files.length,
    definitions: hits.map(({ file, line, text }) => ({ file, line, text: text.trim().slice(0, 140) })),
    complete: hits.complete,
  };
}
