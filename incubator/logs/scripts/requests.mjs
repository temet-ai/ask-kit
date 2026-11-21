export const meta = {
  purpose:
    "For a web access log (nginx or Apache, common or combined format; or a JSON or logfmt log whose entries have a status field): requests by status class, the paths that fail most, the slowest paths and requests when the log has a request time, the busiest clients, and the 5xx rate over time with the failing stretches marked. The answer to 'are we serving errors', 'which endpoint returns 502', 'what is slow', 'when did the 5xx start'.",
  params: {
    file: "an access log, a folder, part of a name, or a list; default: the logs found in LOGS_DIRS",
    since: 'start of the window: an ISO time, "21:14", "2h", "last-30m". Default: the whole log',
    until: "end of the window, same forms",
    path: "only requests whose path holds this text, optional",
    grep: "only lines matching this regex (any case), optional",
    top: "rows per list, default 5, at most 30",
    rotated: "false reads only the file named, not the rotated files beside it",
  },
  returns: "{verdict, logs, window, requests, byClass:{2xx,3xx,4xx,5xx}, statuses, errorRate, failing:[{path, 5xx, of, share}], notFound:[{path, 4xx, of}], busiest, slowestPaths?:[{path, meanSeconds, maxSeconds, requests}], slowestRequests?:[{seconds, status, request, time, line, file}], clients, bucket, failingBuckets, overTime:['time  n requests  n 5xx (share)  << failing'], notes?} or {error}. Paths are patterns: no query, and a segment with digits is <*>.",
  example: 'await scripts.run("requests", { file: "logs/access.log", since: "last-1h" })',
};

export default async function ({ logs }, { file, since, until, path, grep, top, rotated } = {}) {
  const r = await logs.requests(file, { since, until, path, grep, top, rotated });
  if (r.error) return r;
  if (r.verdict) return { verdict: r.verdict, ...r };
  const n5 = r.byClass["5xx"];
  const parts = [`${r.requests} requests from ${r.window.since} to ${r.window.until}: ${r.errorRate}`];
  if (n5) {
    const f = r.failing[0];
    parts.push(`${f["5xx"]} of the ${n5} 5xx are on ${f.path} (${f.share} of its requests)`);
    if (r.failingBuckets.length) parts.push(`failing from ${r.failingBuckets[0]} to ${r.failingBuckets.at(-1)} (buckets of ${r.bucket})`);
  } else parts.push("no 5xx");
  if (r.slowestPaths?.length) parts.push(`slowest path ${r.slowestPaths[0].path} (mean ${r.slowestPaths[0].meanSeconds} s, max ${r.slowestPaths[0].maxSeconds} s)`);
  return { verdict: parts.join("; "), ...r };
}
