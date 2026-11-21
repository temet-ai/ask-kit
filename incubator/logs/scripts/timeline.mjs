export const meta = {
  purpose:
    "How the rate changed: entries per bucket of time, with warnings and errors counted apart, and the stretches that stand out marked. The bucket size is chosen from the window. The answer to 'when did the errors start', 'was there a spike', 'how busy was it around 21:00', and with grep 'how often does X happen over time'.",
  params: {
    file: "a log file, a folder of logs, part of a name, or a list; default: the logs found in LOGS_DIRS",
    since: 'start of the window: an ISO time, "21:14", "2h", "yesterday", "last-1h". Default: the first entry',
    until: "end of the window, same forms. Default: the last entry",
    bucket: 'bucket length such as "10s", "1m", "5m", "1h", "1d"; default: chosen so the window has at most 48 buckets',
    grep: "count only entries matching this regex (any case), optional",
    level: 'count only entries at this level or above, optional ("warn", "error")',
    rotated: "false reads only the file named, not the rotated files beside it",
  },
  returns: "{verdict, logs, window, bucket, entries, errors, warnings, usual:{entries, errors} (per bucket, the lower quartile), high:[{from, to, buckets, of, entries, errors}], buckets:['time  entries  warn n  error n  << high in ...'], notes?} or {error}",
  example: 'await scripts.run("timeline", { file: "logs/app.log", since: "last-2h" })',
};

export default async function ({ logs }, { file, since, until, bucket, grep, level, rotated } = {}) {
  const r = await logs.timeline(file, { since, until, bucket, grep, level, rotated });
  if (r.error) return r;
  const highs = r.high.map((h) => `${h.of} high from ${h.from} to ${h.to} (${h.of === "entries" ? `${h.entries} entries` : `${h.errors} errors`} in ${h.buckets} ${h.buckets === 1 ? "bucket" : "buckets"} of ${r.bucket})`);
  const verdict = `${r.entries} entries, ${r.errors} ${r.errors === 1 ? "error" : "errors"} and ${r.warnings} ${r.warnings === 1 ? "warning" : "warnings"} from ${r.window.since} to ${r.window.until} in buckets of ${r.bucket}; ${highs.length ? `${highs.slice(0, 3).join("; ")}${highs.length > 3 ? `; and ${highs.length - 3} more stretches` : ""}; usual per bucket: ${r.usual.entries} entries, ${r.usual.errors} errors` : "no bucket stands out"}`;
  return { verdict, ...r };
}
