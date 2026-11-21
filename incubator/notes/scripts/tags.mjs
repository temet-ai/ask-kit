import { fit } from "../fit.mjs";

export const meta = {
  purpose:
    "The tags of the vault with the number of notes carrying each (front matter tags and #tags in the text; a nested tag a/b also counts for a), or, with `tag`, the notes that carry that tag, newest first. The answer to 'which tags do I use', 'which notes are tagged X', 'which cases are open' when a tag says so.",
  params: {
    tag: "a tag, with or without #, e.g. 'case/open'; all tags when omitted",
    max: "tags or notes returned, default 50",
    vault: "another notes folder, optional",
  },
  returns: "all tags: {verdict, total, leftOut?, tags:[{tag, notes}]}; one tag: {verdict, tag, total, leftOut?, privateNotes?, near?, notes:[{path, date, tags}]}",
  example: 'await scripts.run("tags", { tag: "case/open" })',
};

export default async function ({ notes }, { tag, max = 50, vault } = {}) {
  const v = vault ? notes.at(vault) : notes;
  if (!tag) {
    const r = v.tags({ max });
    const verdict = r.total ? `${r.total} tags; most used: ${r.tags.slice(0, 5).map((t) => `${t.tag} (${t.notes})`).join(", ")}` : "the notes carry no tags";
    return fit({ verdict, total: r.total, ...(r.leftOut ? { leftOut: r.leftOut } : {}), tags: r.tags }, () => [r.tags]);
  }
  const r = v.tagged(tag, { max });
  const verdict = r.total
    ? `${r.total} note${r.total === 1 ? "" : "s"} tagged ${r.tag}${r.privateNotes ? `, and ${r.privateNotes} private` : ""}; newest: ${r.notes[0].path} (${r.notes[0].date})`
    : `no note is tagged ${r.tag}${r.near?.length ? `; near: ${r.near.join(", ")}` : ""}`;
  const rows = r.notes.map((n) => ({ path: n.path, date: n.date, ...(n.dateFrom ? { dateFrom: n.dateFrom } : {}), tags: n.tags.join(" ") }));
  return fit({ verdict, tag: r.tag, total: r.total, ...(r.leftOut ? { leftOut: r.leftOut } : {}), ...(r.privateNotes ? { privateNotes: r.privateNotes } : {}), ...(r.near ? { near: r.near } : {}), notes: rows }, () => [rows]);
}
