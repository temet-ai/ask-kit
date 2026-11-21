export const meta = {
  purpose:
    "When something first appeared in a log and how often since: the first entry holding a text (or matching a regex, or having an error signature), the entries just before it, the count, the last time, and the count per hour or day. The answer to 'when did this error start', 'has this happened before', 'what happened right before the first timeout'.",
  params: {
    file: "a log file, a folder of logs, part of a name, or a list; default: the logs found in LOGS_DIRS. A rotated set is read whole, oldest first",
    text: "the literal text to look for, any case (one of text, regex, signature is needed)",
    regex: "a regular expression instead of text",
    signature: "an error signature as the errors script prints it, or a part of one",
    before: "entries shown before the first one, default 5, at most 30",
    since: "look only from this time on, optional",
    until: "look only up to this time, optional",
    rotated: "false reads only the file named, not the rotated files beside it",
  },
  returns: "{verdict, logs, window, what, count, first:{time, level, message, fields?, line, file}, signature, last:{time, file, line}, before:[entries], over, counts:['hour or day  count'], perLog?, notes?} or {error}",
  example: 'await scripts.run("first-seen", { file: "logs/app.log", text: "timeout after" })',
};

export default async function ({ logs }, { file, text, regex, signature, before, since, until, rotated } = {}) {
  const r = await logs.firstSeen(file, { text, regex, signature, before, since, until, rotated });
  if (r.error) return r;
  if (r.verdict) return { verdict: r.verdict, ...r };
  const f = r.first;
  const verdict = `${r.what} first appeared at ${f.time ?? "an entry without a time"} (${f.file}:${f.line})${r.count > 1 ? `, ${r.count} times in all, last at ${r.last.time ?? "?"} (${r.last.file}:${r.last.line})` : ", and only that once"}`;
  return { verdict, ...r };
}
