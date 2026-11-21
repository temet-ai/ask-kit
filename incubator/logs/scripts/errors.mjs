export const meta = {
  purpose:
    "What went wrong in a log, and which errors happen most: the kinds of error in a window, most frequent first. Entries that are the same error with different details (numbers, ids, addresses, durations) count as one kind. For each kind: how often, first and last time, one full example with its file and line, and whether it is new in the window. The answer to 'any errors in app.log', 'what is failing since 21:00', 'which error is the most common', 'is this error new'.",
  params: {
    file: "a log file, a folder of logs, part of a name, or a list; default: the logs found in LOGS_DIRS. A rotated set (app.log, app.log.1, app.log.2.gz) is read as one log",
    since: 'start of the window: an ISO time, "21:14", "2h", "yesterday", or counted from the end of the log: "last-1h". Default: the whole log',
    until: "end of the window, same forms",
    level: 'lowest level counted, default "error" (error and fatal, and lines without a level that hold an error word); "warn" adds warnings',
    grep: "only errors matching this regex (any case), optional",
    top: "kinds returned, default 10, at most 50",
    new: "false skips the part of the log before the window, so no kind is marked new; much faster for a short window at the end of a log of several GB",
    rotated: "false reads only the file named, not the rotated files beside it",
  },
  returns: "{verdict, logs, window:{since, until}, entries, errors, kinds, new?, newSignatures?, top:[{signature, count, first, last, levels, new?, example:{time, level, message, fields?, line, file}}], leftOut?, notes?} or {error}",
  example: 'await scripts.run("errors", { file: "logs/app.log", since: "last-1h" })',
};

export default async function ({ logs }, { file, since, until, level, grep, top, rotated, new: isNew } = {}) {
  const r = await logs.errors(file, { since, until, level, grep, top, rotated, new: isNew });
  if (r.error) return r;
  delete r.bytes;
  delete r.lines;
  const where = `${r.logs.length === 1 ? r.logs[0].replace(/ \(.*$/, "") : `${r.logs.length} logs`}${r.window.since ? ` since ${r.window.since}` : ""}${r.window.until ? ` until ${r.window.until}` : ""}`;
  const what = level && !/^(err|error)$/i.test(level) ? `entry at ${level} or above` : "error";
  const name = (g) => `"${g.signature.length > 90 ? g.signature.slice(0, 90) + "…" : g.signature}" (${g.count})`;
  let verdict;
  const hint = r.notes?.find((n) => n.startsWith("the window"));
  if (!r.errors) verdict = `no ${what} in ${where} (${r.entries} entries in the window)${hint ? `: ${hint}` : ""}`;
  else {
    verdict = `${r.kinds} ${r.kinds === 1 ? "kind" : "kinds"} of ${what} in ${where}, ${r.errors} in ${r.entries} entries`;
    if (r.new != null) verdict += r.new ? `; ${r.new} new in the window: ${r.newSignatures.slice(0, 3).map((s) => `"${s.length > 90 ? s.slice(0, 90) + "…" : s}"`).join(", ")}` : "; none is new in the window";
    verdict += `; most frequent: ${name(r.top[0])}`;
  }
  return { verdict, ...r };
}
