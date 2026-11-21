export const meta = {
  purpose:
    "Which log files there are and what each holds: size, detected format, first and last time, number of lines and entries, errors and warnings and the share of errors. A rotated set counts as one log. The answer to 'what logs are here', 'which log has the errors', 'how far back does this log go', 'what format is this file'. Start here when no file was named.",
  params: {
    dir: "a folder or a file, or a list; default: the folders in LOGS_DIRS (logs and log under the working folder, and /var/log)",
    max: "logs listed, default 40, at most 100, most recently written first",
    budgetMB: "how much to read for counting lines and errors, default 512; logs beyond it are listed without counts",
  },
  returns: "{verdict, dirs?, count, logs:['log | size | format | first to last | n lines, n entries, n errors (share), n warnings'], leftOut?, notes?} or {error}. logs.overview(dir) gives the same as objects.",
  example: 'await scripts.run("overview", { dir: "logs" })',
};

export default async function ({ logs }, { dir, max, budgetMB } = {}) {
  const r = await logs.overview(dir, { max, budgetMB });
  if (r.error) return r;
  const where = dir ? String(dir) : r.dirs.join(", ");
  if (!r.count) return { verdict: `no log files under ${where}`, ...r };
  const worst = r.logs.filter((l) => l.errors).sort((a, b) => b.errors - a.errors)[0];
  const verdict = `${r.count} ${r.count === 1 ? "log" : "logs"} under ${where}; ${worst ? `most errors: ${worst.log} (${worst.errors}, ${worst.errorShare} of its entries)` : `no errors in the ${r.logs.length} read`}${r.leftOut ? `; ${r.leftOut} more not listed (raise max)` : ""}`;
  // One line per log keeps forty logs readable.
  const line = (l) =>
    [
      l.log + (l.parts ? ` (${l.parts} files)` : ""),
      l.size,
      l.format,
      l.error ? `unreadable: ${l.error}` : l.first ? `${l.first} to ${l.last}` : "no times",
      l.error ? null : l.counted === false ? "not counted" : `${l.lines} lines, ${l.entries} entries, ${l.errors} ${l.errors === 1 ? "error" : "errors"} (${l.errorShare}), ${l.warnings} ${l.warnings === 1 ? "warning" : "warnings"}`,
      l.notes ? l.notes.join("; ") : null,
    ]
      .filter(Boolean)
      .join(" | ");
  return { verdict, ...r, logs: r.logs.map(line) };
}
