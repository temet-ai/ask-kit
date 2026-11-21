import { fit } from "../fit.mjs";

export const meta = {
  purpose:
    "The vault at a glance: how many notes and words, the date range, the most used tags, tasks open, overdue and done, the most linked notes, notes nothing links to, links to notes that do not exist, where daily notes live, and what is left out (private notes by title, attachments, credential-named files). The answer to 'what is in my notes', 'how big is the vault', 'which notes are orphans', 'which links are broken'.",
  params: {
    max: "entries per list, default 8",
    today: "the date overdue is counted from, default the machine's date",
    vault: "another notes folder, optional",
  },
  returns: "{verdict, root, notes, words, oldest, newest, tasks:{open, overdue, done, cancelled}, links, dailyNotes, private:{count, titles}, leftOut, index:{read, reused, ms}, tags:{total, top}, mostLinked:[{path, linkedFrom}], orphans:{total, notes:[{path, date}]}, unresolved:{total, links:[{target, count, from}]}}",
  example: 'await scripts.run("overview")',
};

export default async function ({ notes }, { max = 8, today, vault } = {}) {
  const v = vault ? notes.at(vault) : notes;
  const i = v.index();
  const tags = v.tags({ max });
  const orphans = v.orphans({ max });
  const unresolved = v.unresolved({ max });
  const t = v.tasks({ open: true, today, max: 1 });
  const verdict = `${i.notes} notes, ${i.words} words, ${i.oldest ?? "?"} to ${i.newest ?? "?"}; ${t.open} open tasks (${t.overdue} overdue), ${i.tasks.done} done; ${orphans.total} with nothing linking to them, ${unresolved.total} missing notes linked to; ${i.private.count} private, named by title only`;
  const top = tags.tags.map((x) => `${x.tag} (${x.notes})`);
  const hubs = v.hubs({ max }).map((h) => ({ path: h.path, linkedFrom: h.linkedFrom }));
  const lonely = orphans.orphans.map((n) => ({ path: n.path, date: n.date }));
  const missing = unresolved.unresolved.map((u) => ({ target: u.target, count: u.count, from: u.from.slice(0, 2).map((f) => `${f.path}:${f.line}`).join(", ") }));
  const titles = i.private.titles.slice(0, 12);
  return fit(
    {
      verdict,
      root: i.root,
      notes: i.notes,
      words: i.words,
      oldest: i.oldest,
      newest: i.newest,
      tasks: { open: t.open, overdue: t.overdue, done: i.tasks.done, cancelled: i.tasks.cancelled },
      links: i.links,
      dailyNotes: `${i.dailyNotes.count} at ${i.dailyNotes.pattern} (from ${i.dailyNotes.from})`,
      private: { count: i.private.count, titles },
      leftOut: { attachments: i.leftOut.attachments, credentialNamed: i.leftOut.credentialNamed, hiddenFolders: i.leftOut.hiddenFolders.join(", "), ...(i.leftOut.tooBig.length ? { tooBig: i.leftOut.tooBig.length } : {}), ...(i.leftOut.beyondLimit ? { beyondLimit: i.leftOut.beyondLimit } : {}) },
      index: { read: i.index.read, reused: i.index.reused, ms: i.index.ms },
      tags: { total: tags.total, top },
      mostLinked: hubs,
      orphans: { total: orphans.total, notes: lonely },
      unresolved: { total: unresolved.total, links: missing },
    },
    () => [titles, top, hubs, lonely, missing],
    { even: true },
  );
}
