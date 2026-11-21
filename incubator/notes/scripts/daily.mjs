import { fit } from "../fit.mjs";

export const meta = {
  purpose:
    "A day's daily note with its text and open tasks, or, with `since`, the daily notes of a range (each day's size, headings and open tasks, without the text). The answer to 'what is in today's daily note', 'what did I note yesterday', 'what did I do on 6 November', 'which days did I journal last week'.",
  params: {
    date: "the day: a date (2026-11-08), 'today' (default) or 'yesterday'",
    since: "for a range instead of one day: a date, 'week', 'month', '14d'",
    until: "end of the range, default today",
    today: "the date to count from, default the machine's date",
    vault: "another notes folder, optional",
  },
  returns: "one day: {verdict, date, weekday, exists, path, words, tasks:{open, done}, openTasks:[{line, text, due?}], links, lines, more?, text} or {exists:false, expectedAt, nearest:{before, after}}; a range: {verdict, since, until, pattern, total, days:[{date, weekday, path, words, tasksOpen, headings}]}",
  example: 'await scripts.run("daily", { date: "yesterday" })',
};

export default async function ({ notes }, { date, since, until, today, vault } = {}) {
  const v = vault ? notes.at(vault) : notes;
  if (since) {
    const r = v.dailies({ since, until, today });
    const days = r.days.map((d) => (d.private ? d : { date: d.date, weekday: d.weekday.slice(0, 3), path: d.path, words: d.words, tasksOpen: d.tasksOpen, headings: d.headings.slice(0, 4).join("; ").slice(0, 120) })).reverse();
    const verdict = r.total ? `${r.total} daily note${r.total === 1 ? "" : "s"} from ${r.since} to ${r.until} (${r.days[0].date} to ${r.days.at(-1).date}), newest first` : `no daily note from ${r.since} to ${r.until}; daily notes are expected at ${r.pattern}`;
    return fit({ verdict, since: r.since, until: r.until, pattern: r.pattern, total: r.total, ...(r.leftOut ? { leftOut: r.leftOut } : {}), days }, () => [days]);
  }
  const r = v.daily(date ?? "today", { today });
  const verdict = r.private
    ? `the daily note of ${r.date} is private: it is not read`
    : r.exists
      ? `${r.path} (${r.weekday}): ${r.words} words, ${r.tasks.open + r.tasks.done} task${r.tasks.open + r.tasks.done === 1 ? "" : "s"}, ${r.tasks.open} open`
      : `no daily note for ${r.date} (${r.weekday}); it would be ${r.expectedAt}${r.nearest.before ? `; the last one before it is ${r.nearest.before}` : ""}`;
  const result = { verdict, ...r };
  return r.openTasks ? fit(result, () => [r.links, r.openTasks]) : result;
}
