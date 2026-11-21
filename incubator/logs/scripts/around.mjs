export const meta = {
  purpose:
    "What happened around a moment: the entries before and after a time, a line number or the first entry matching a regex; or every entry that holds a request id or another literal text. With several logs (a folder, a list) the entries of all of them are merged in time order. The answer to 'what happened at 21:14', 'show me the lines around line 4120', 'what led up to the crash', 'follow request req-7f3a through the logs'.",
  params: {
    file: "a log file, a folder of logs, part of a name, or a list; default: the logs found in LOGS_DIRS",
    time: 'the moment: an ISO time, a time of day ("21:14", on the day the log ends), "last" or "last-5m" (one of time, line, grep, id is needed)',
    line: "a line number of one file",
    grep: "a regex (any case): the first entry matching it is the moment; nth picks a later match",
    id: "a literal text such as a request id: every entry holding it is returned, no context unless before or after is given",
    nth: "with grep: which match, default 1",
    before: "entries before the moment from each log, default 10 (0 with id), at most 100",
    after: "entries after it from each log, default 10 (0 with id), at most 100",
    limit: "entries returned in all, default 60, at most 200",
    rotated: "false reads only the file named, not the rotated files beside it",
  },
  returns: "{verdict, logs, anchor:{time?, file?, line?}, matches?, entries:[{time, level, message, fields?, line, file, hit?}], leftOut?, notes?} or {error}. hit marks the entry asked for.",
  example: 'await scripts.run("around", { file: "logs", id: "req-7f3a" })',
};

export default async function ({ logs }, { file, time, line, grep, id, nth, before, after, limit, rotated } = {}) {
  const r = await logs.around(file, { time, line, grep, id, nth }, { before, after, limit, rotated });
  if (r.error) return r;
  if (r.verdict) return { verdict: r.verdict, ...r };
  const files = new Set(r.entries.map((e) => e.file));
  const times = r.entries.map((e) => e.time).filter(Boolean);
  const where = files.size === 1 ? [...files][0] : `${files.size} files`;
  const range = times.length > 1 && times[0] !== times.at(-1) ? `, from ${times[0]} to ${times.at(-1)}` : times.length ? `, at ${times[0]}` : "";
  const n = `${r.entries.length} ${r.entries.length === 1 ? "entry" : "entries"}`;
  let verdict;
  if (id != null && id !== "") verdict = `${r.matches} ${r.matches === 1 ? "entry holds" : "entries hold"} "${id}" in ${where}${range}`;
  else if (!r.entries.length) verdict = "no entries there";
  else if (grep != null && grep !== "") verdict = `/${grep}/ matches at ${r.anchor.time ?? "an entry without a time"} (${r.anchor.file}:${r.anchor.line}); ${n} around it in ${where}${range}`;
  else verdict = `${n} around ${r.anchor.time ?? `line ${r.anchor.line}`} in ${where}${range}`;
  return { verdict, ...r };
}
