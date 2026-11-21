import { fit } from "../fit.mjs";

export const meta = {
  purpose:
    "What the notes say about something: the notes that hold the words, best first (a title or alias match, then a heading, then the text; rare words weigh more; newest first within equal rank), each with its date and the lines that hold them. The answer to 'what did I write about X', 'where are my notes on X', 'when did I write about X'.",
  params: {
    words: "two to five distinctive words, e.g. 'clacks ledger'",
    tag: "only notes with this tag, optional",
    in: "only notes in this folder of the vault, optional",
    since: "only notes dated on or after this: a date, 'week', 'month', '30d', optional",
    until: "only notes dated on or before this, optional",
    max: "notes returned, default 6",
    today: "the date to count from, default the machine's date",
    vault: "another notes folder, optional",
  },
  returns: "{verdict, words, total, withEveryWord, searched, leftOut?, notes:[{path, title?, date, dateFrom?, matched, missing?, passages:[{line, heading?, text}]}], privateNotesWithTheWordInTheirTitle?}",
  example: 'await scripts.run("find", { words: "clacks ledger" })',
};

export default async function ({ notes }, { words, topic, tag, in: folder, since, until, max = 6, today, vault } = {}) {
  const v = vault ? notes.at(vault) : notes;
  const text = words ?? topic;
  if (!text) throw new Error("find needs `words`: what to look for, e.g. { words: 'clacks ledger' }");
  const r = v.find(text, { tag, in: folder, since, until, max, today, passages: max <= 3 ? 3 : 2 });
  const top = r.notes[0];
  const verdict = !r.total
    ? `no note holds ${r.words.join(" or ")} (${r.searched} notes searched)`
    : r.words.length === 1
      ? `${r.total} of ${r.searched} notes hold ${r.words[0]}; best: ${top.path} (${top.date})`
      : `${r.withEveryWord} of ${r.searched} notes hold all of ${r.words.join(", ")}, ${r.total - r.withEveryWord} more hold some; best: ${top.path} (${top.date})${top.missing ? `, which lacks ${top.missing.join(", ")}` : ""}`;
  const rows = r.notes.map((n) => ({
    path: n.path,
    ...(n.path.endsWith(`${n.title}.md`) ? {} : { title: n.title }),
    date: n.date,
    ...(n.dateFrom ? { dateFrom: n.dateFrom } : {}),
    matched: n.matched.join(", "),
    ...(n.missing ? { missing: n.missing.join(", ") } : {}),
    passages: n.passages.map((p) => ({ line: p.line, ...(p.heading && p.heading !== n.title ? { heading: p.heading } : {}), text: p.text })),
  }));
  return fit(
    { verdict, words: r.words, total: r.total, withEveryWord: r.withEveryWord, searched: r.searched, ...(r.leftOut ? { leftOut: r.leftOut } : {}), ...(r.privateNotesWithTheWordInTheirTitle ? { privateNotesWithTheWordInTheirTitle: r.privateNotesWithTheWordInTheirTitle } : {}), notes: rows },
    () => [rows],
  );
}
