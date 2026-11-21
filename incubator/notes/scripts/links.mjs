import { fit } from "../fit.mjs";

export const meta = {
  purpose:
    "One note's place among the others: the notes that link to it (backlinks) and what it links to, each with the line the link sits on, and its links to notes that do not exist. Reads [[wiki links]], ![[embeds]] and Markdown links. The answer to 'what links to X', 'what mentions X', 'what does X link to', 'which links in X are broken'.",
  params: {
    note: "the note: a title, alias, file name or path, e.g. 'WATCH-12'",
    max: "links returned each way, default 20",
    vault: "another notes folder, optional",
  },
  returns: "{verdict, note, date, matchedBy, linksIn, linksOut, unresolved:[target], fromPrivateNotes?, backlinks:[{path, date, line, embed?, text}], links:[{line, target, resolved, shownAs?, embed?, text}]}",
  example: 'await scripts.run("links", { note: "Sam Vimes" })',
};

export default async function ({ notes }, { note, name, max = 20, vault } = {}) {
  const v = vault ? notes.at(vault) : notes;
  const which = note ?? name;
  if (!which) throw new Error("links needs `note`: a title, alias, file name or path");
  const back = v.backlinks(which, { max });
  if (!back.found) return { verdict: `no note "${which}"${back.near?.length ? `; near: ${back.near.join(", ")}` : ""}`, found: false, near: back.near };
  if (back.private) return { verdict: `"${back.title}" is private: its links are not read`, private: true, title: back.title };
  const out = v.links(back.note.path, { max });
  const from = new Set(back.backlinks.map((b) => b.path)).size;
  const verdict = `${back.note.path} (matched by ${back.matchedBy}): ${back.total} link${back.total === 1 ? "" : "s"} in from ${back.leftOut ? "many" : from} note${from === 1 ? "" : "s"}${back.fromPrivateNotes ? ` and ${back.fromPrivateNotes.length} private` : ""}, ${out.total} out, ${out.unresolved.length} to notes that do not exist${out.unresolved.length ? ` (${out.unresolved.slice(0, 8).join(", ")})` : ""}`;
  const backlinks = back.backlinks.map((b) => ({ path: b.path, date: b.date, line: b.line, ...(b.embed ? { embed: true } : {}), text: b.text.slice(0, 180) }));
  const links = out.links.map((l) => ({ line: l.line, target: l.target, resolved: l.resolved, ...(l.private ? { private: true } : {}), ...(l.shownAs ? { shownAs: l.shownAs } : {}), ...(l.embed ? { embed: true } : {}), text: l.text.slice(0, 180) }));
  return fit(
    {
      verdict,
      note: back.note.path,
      date: back.note.date,
      matchedBy: back.matchedBy,
      linksIn: back.total,
      linksOut: out.total,
      unresolved: out.unresolved.slice(0, 20),
      ...(back.fromPrivateNotes ? { fromPrivateNotes: back.fromPrivateNotes } : {}),
      backlinks,
      links,
    },
    () => [backlinks, links],
    { even: true },
  );
}
