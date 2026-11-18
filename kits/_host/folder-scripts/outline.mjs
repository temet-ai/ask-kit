export const meta = {
  purpose:
    "What a file or sub-folder holds: Markdown headings, TOML/INI sections, YAML top-level keys and code definitions, with line numbers; for a folder, the same per file.",
  params: { path: "a file or sub-folder", max: "lines returned, default 150" },
  returns: "{path, files, items:[{file, line, text}], complete}",
  example: 'await scripts.run("outline", { path: "README.md" })',
};

const SHAPE =
  "^#{1,4}\\s|^\\[[^\\]]+\\]\\s*$|^[A-Za-z_][\\w.-]*:\\s*$|^[A-Za-z_][\\w.-]*:\\s+\\S" +
  "|^\\s*(export\\s+)?(async\\s+)?(function|class|interface|type|const)\\s+[A-Za-z_$]|^\\s*(def|class)\\s+\\w|^\\s*(pub\\s+)?(fn|struct|enum|trait|impl)\\b";

export default async function ({ folder }, { path, max = 150 }) {
  if (!path) throw new Error("outline needs `path`");
  const hits = await folder.rg(SHAPE, { path, max });
  return {
    path,
    files: new Set(hits.map((h) => h.file)).size,
    items: hits.map(({ file, line, text }) => ({ file, line, text: text.trimEnd().slice(0, 140) })),
    complete: hits.complete,
  };
}
