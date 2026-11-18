export const meta = {
  purpose:
    "Which files cover a topic: searches the folder for the topic's words (any case), ranks files by how many words they hold and how often, with a heading or file-name match counting extra, and returns each file's best lines.",
  params: {
    topic: "two to five distinctive words, e.g. 'hook timeout'",
    path: "a sub-folder to search, optional",
    glob: "files to search, e.g. '*.md', optional",
    max: "files returned, default 8",
  },
  returns: "{words, files:[{file, score, words, headings:[{line, text}], lines:[{line, text}]}], searched}",
  example: 'await scripts.run("find", { topic: "hook timeout" })',
};

const STOP = new Set("the a an and or of to in on for with what how does do is are was it this that i my be can when where which who why use used using about from into".split(" "));

export default async function ({ folder }, { topic, path, glob, max = 8 }) {
  const words = [...new Set(String(topic ?? "").toLowerCase().split(/[^a-z0-9_.-]+/).filter((w) => w.length > 1 && !STOP.has(w)))].slice(0, 6);
  if (!words.length) throw new Error("find needs `topic` with at least one distinctive word");
  const esc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const hits = await folder.rg(words.map(esc).join("|"), { ignoreCase: true, path, glob, max: 5000 });
  const by = new Map();
  for (const h of hits) {
    const f = by.get(h.file) ?? { file: h.file, hit: new Set(), n: 0, headings: [], lines: [] };
    const low = h.text.toLowerCase();
    const found = words.filter((w) => low.includes(w));
    found.forEach((w) => f.hit.add(w));
    f.n += found.length;
    const heading = /^\s*(#{1,6}\s|\[.+\]$|[A-Z][^.]{0,60}:$)/.test(h.text);
    if (heading && f.headings.length < 4) f.headings.push({ line: h.line, text: h.text.trim().slice(0, 140) });
    else f.lines.push({ line: h.line, text: h.text.trim().slice(0, 200), k: found.length });
    by.set(h.file, f);
  }
  for (const f of by.values()) {
    const name = f.file.toLowerCase();
    f.score = f.hit.size * 10 + Math.min(f.n, 30) + f.headings.length * 4 + words.filter((w) => name.includes(w)).length * 8;
  }
  const files = [...by.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((f) => ({ file: f.file, score: f.score, words: [...f.hit], headings: f.headings, lines: f.lines.sort((a, b) => b.k - a.k).slice(0, 4).map(({ line, text }) => ({ line, text })) }));
  return { words, files, searched: { matches: hits.total, files: by.size, complete: hits.complete } };
}
