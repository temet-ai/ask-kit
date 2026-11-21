import { fit } from "../fit.mjs";

export const meta = {
  purpose:
    "The tasks in the notes: open ones by default, overdue first, then by due date, then undated; grouped by due date or by note. Reads `- [ ]` and `- [x]` with due dates (📅 2026-11-08, due:: 2026-11-08) and Logseq TODO and DONE. The answer to 'what are my open tasks', 'what is overdue', 'what is due this week', 'what is left on WATCH-12', 'what did I finish'.",
  params: {
    state: "'open' (default), 'done' or 'all'",
    due: "'overdue', 'today', 'week' (due within 7 days, overdue included), 'none' (undated), or a date: due on or before it; optional",
    tag: "only tasks with this tag, or in a note with it, optional",
    note: "only one note's tasks: a title, alias, file name or path, optional",
    by: "'due' (default) or 'note': how the tasks are grouped",
    max: "tasks returned, default 40",
    today: "the date overdue is counted from, default the machine's date",
    vault: "another notes folder, optional",
  },
  returns: "{verdict, today, total, open, overdue, done, leftOut?, note?, matchedBy?, groups:[{group, tasks:[{path, line, text, due?, doneOn?, tags?}]}]}",
  example: 'await scripts.run("tasks", { due: "week" })',
};

export default async function ({ notes }, { state = "open", due, tag, note, by = "due", max = 40, today, vault } = {}) {
  const v = vault ? notes.at(vault) : notes;
  if (!["open", "done", "all"].includes(state)) throw new Error(`tasks: state is 'open', 'done' or 'all', not '${state}'`);
  if (!["due", "note"].includes(by)) throw new Error(`tasks: by is 'due' or 'note', not '${by}'`);
  const r = v.tasks({ open: state === "all" ? undefined : state === "open", due, tag, note, max, today });
  if (r.found === false) return { verdict: `no note "${note}"${r.near?.length ? `; near: ${r.near.join(", ")}` : ""}`, found: false, near: r.near };
  if (r.private) return { verdict: `"${r.title}" is private: its tasks are not read`, private: true, title: r.title };
  const week = new Date(`${r.today}T00:00:00Z`);
  week.setUTCDate(week.getUTCDate() + 7);
  const soon = week.toISOString().slice(0, 10);
  const groups = new Map();
  for (const t of r.tasks) {
    const g = by === "note" ? t.path : t.done ? "done" : t.cancelled ? "cancelled" : t.overdue ? "overdue" : !t.due ? "no due date" : t.due === r.today ? "due today" : t.due <= soon ? "due within 7 days" : "due later";
    const row = {
      ...(by === "note" ? {} : { path: t.path }),
      line: t.line,
      text: t.text,
      ...(t.due ? { due: t.due } : {}),
      ...(by === "note" && t.overdue ? { overdue: true } : {}),
      ...(by === "note" && t.done ? { done: true } : {}),
      ...(t.doneOn ? { doneOn: t.doneOn } : {}),
    };
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(row);
  }
  const where = note ? ` in ${r.note.path}` : "";
  const undated = r.tasks.filter((t) => !t.done && !t.cancelled && !t.due).length;
  const verdict =
    state === "done"
      ? `${r.done} done task${r.done === 1 ? "" : "s"}${where}`
      : !r.open
        ? `no open task${where}${due ? ` with due ${typeof due === "string" ? due : "in that range"}` : ""}${tag ? ` tagged ${tag}` : ""}`
        : `${r.open} open task${r.open === 1 ? "" : "s"}${where}: ${r.overdue} overdue${r.overdue ? ` (oldest due ${r.tasks.find((t) => t.overdue).due})` : ""}${r.leftOut ? "" : `, ${undated} with no due date`}`;
  const out = [...groups].map(([group, tasks]) => ({ group, tasks }));
  const result = { verdict, today: r.today, ...(r.note ? { note: r.note.path, matchedBy: r.matchedBy } : {}), total: r.total, open: r.open, overdue: r.overdue, done: r.done, ...(r.leftOut ? { leftOut: r.leftOut } : {}), groups: out };
  fit(result, () => out.map((g) => g.tasks));
  result.groups = out.filter((g) => g.tasks.length);
  return result;
}
