// Log files, read as a stream. Nothing here writes or runs a program.
//
// A `file` argument is: a path (relative to the working folder, or absolute); a folder (every log in it); a name or part
// of one ("relay" finds logs/clacks-relay.jsonl; the notes say what matched); a list or a comma-separated string of
// these; or nothing, which means the logs found in the LOGS_DIRS folders. A rotated set (app.log, app.log.1,
// app.log.2.gz) named by its base file is read as one log, oldest part first; {rotated: false} reads only the file named.
// Gzip files are read as they are. A missing file is not thrown: the result is {error: "no log file x; have: ..."}.
// Check `error` before using a result.
//
// Formats, detected per file from its first lines and said in every result: JSON lines, logfmt, syslog (RFC 3164 and
// 5424), web access logs (common and combined, with nginx's request time), text that starts with a time (Python logging,
// Java and log4j, Go, Rust tracing, nginx and Apache error logs, PostgreSQL), text with a time near the start, npm debug
// logs, and plain lines. A line without a time (a stack trace, a wrapped line) belongs to the entry above it.
// Times without a zone are read as UTC (setting LOGS_UTC_OFFSET changes that); syslog's "Nov  8 21:00:03" takes its
// year from the file's modified time. Every time in a result is ISO 8601 in UTC.
//
// A time argument (since, until, time, split) is: an ISO time or a date ("2026-11-08T21:00", "2026-11-08"); a time of
// day ("21:14", on the day the log ends); a length back from now ("2h", "30m", "3d"); "today", "yesterday"; or counted
// from the log itself: "last" (its last entry), "last-1h", "first", "first+10m". For a saved log that is not being
// written now, use the "last-..." forms: "2h" is two hours before the wall clock.
//
// Credentials are replaced with <redacted> before anything is parsed, so no result, signature or grep can show them:
// the values of password=, token=, secret=, api_key= and similar keys (in text, in URLs' queries and in JSON fields),
// Authorization, Cookie and Set-Cookie headers, Bearer tokens, the password in a URL (scheme://user:<redacted>@host),
// private key blocks, and tokens of well-known shapes. Files named like credentials (.env, .npmrc, key files,
// credentials.*, shell histories, anything under .ssh or .aws) are refused: the call throws. You do not need them.

type Level = "trace" | "debug" | "info" | "warn" | "error" | "fatal";
interface Entry {
  time: string | null; // ISO, UTC; null when the line has no time
  level: Level | null; // null when the line names none
  message: string; // clipped at 400 chars; a stack trace follows it on new lines, its middle left out when long
  fields?: Record<string, any>; // the other fields of a JSON, logfmt or syslog entry, at most 10; an access log's only when asked by name
  line: number; // the line number in `file`
  file: string;
}
// Conditions on the fields of JSON, logfmt, syslog and access entries. All must hold. A bare value means equal (any case).
// {status: 502}  {status: {gte: 500}}  {path: {contains: "/clacks"}}  {tower: {ne: "tower-3"}}  {msg: {re: "time.?out"}}
// Access log fields: client, method, path, status, bytes, referer, agent, request_time, user. Syslog: host, app, pid.
type Where = Record<string, string | number | boolean | { eq?: any; ne?: any; gt?: number; gte?: number; lt?: number; lte?: number; contains?: string; re?: string }>;
interface Filter {
  since?: string | number;
  until?: string | number;
  level?: Level; // this level and above; a line without a level counts as an error when it holds an error word (failed, exception, refused, ...)
  grep?: string; // a regex, any case, tested on the whole line and its stack trace (after redaction)
  where?: Where;
  rotated?: boolean; // false: only the file named
  timeoutMs?: number; // reading stops after this; default 100000. A result cut short says so in notes
}
type File = string | string[] | null | undefined;

declare const logs: {
  // The log files in a folder (default: the LOGS_DIRS folders), most recently written first, a rotated set as one log.
  // Found by name: *.log, *.log.*, *.out, *.err, *.jsonl, *.ndjson and names with "log" in them; three folders deep.
  files(dir?: string, o?: { max?: number }): Promise<{ dirs: string[]; count: number; logs: { log: string; parts?: string[]; size: string; bytes: number; modified: string; format: string; first: string | null; last: string | null; error?: string }[]; leftOut?: number } | { error: string }>;

  // The same list with each log read once: lines, entries, errors, warnings and the share of errors.
  overview(dir?: File, o?: { max?: number; budgetMB?: number }): Promise<{ dirs?: string[]; count: number; logs: { log: string; parts?: number; size: string; format: string; first: string | null; last: string | null; lines: number | null; entries?: number; errors?: number; warnings?: number; errorShare?: string; counted?: false; error?: string }[]; leftOut?: number; notes?: string[] } | { error: string }>;

  // The entries that pass the filters. limit: default 50, at most 500; the earliest are kept, or the latest with last: true.
  // matched is the count of all matches; count: false stops reading once limit is reached (then matched is not the total).
  // fields: the names of the fields to show ("status,path"), or false for none. With several logs the entries are in time order.
  scan(file: File, o?: Filter & { limit?: number; last?: boolean; count?: boolean; fields?: string | string[] | false }): Promise<{ logs: string[]; window: { since: string | null; until: string | null }; scanned: number; matched: number; entries: Entry[]; leftOut?: number; kept?: string; notes?: string[] } | { error: string }>;

  // A count or a sum of your own over a whole log, without holding it: fn is called for every entry that passes the filters.
  // The entry has t (epoch ms, or null), fields (every field, {} for plain text) and trace (the lines below it, or null).
  //   const by = {}; await logs.each("app.jsonl", {level: "error"}, (e) => { by[e.fields.tower] = (by[e.fields.tower] ?? 0) + 1 });
  each(file: File, o: Filter, fn: (e: { t: number | null; time: string | null; level: Level | null; message: string; fields: Record<string, any>; line: number; file: string; trace: string[] | null }) => void | false): Promise<{ scanned: number; matched: number; notes?: string[] } | { error: string }>;

  // The last n entries of one log (default 20, at most 200), read from the end of the file.
  tail(file: string, n?: number): Promise<{ log: string; format: string; entries: Entry[]; notes?: string[] } | { error: string }>;

  // The entries around a point. Exactly one of: time, line (one file), grep (the first entry matching a regex; nth for a
  // later one), id (a literal text such as a request id: every entry holding it). before and after are counted per log
  // (default 10 each; 0 with id). With several logs the entries are merged in time order, and with grep the logs that
  // do not hold the text give their entries around the same moment. `hit: true` marks the entry asked for.
  around(file: File, at: { time?: string; line?: number; grep?: string; nth?: number; id?: string }, o?: { before?: number; after?: number; limit?: number; rotated?: boolean }): Promise<{ logs: string[]; anchor: { time?: string; file?: string; line?: number }; matches?: number; entries: (Entry & { hit?: true })[]; leftOut?: number; notes?: string[]; verdict?: string } | { error: string }>;

  // The kinds of error in a window, most frequent first. A kind is a signature: the message with its details replaced
  // (see signature below); a stack trace adds the line that names the exception. `new` is given when since is set and
  // the log holds entries before it: true when the kind does not occur before the window. new: false in the options
  // skips reading before the window. level: default "error"; "warn" counts warnings too.
  errors(file: File, o?: Filter & { top?: number; new?: boolean }): Promise<{ logs: string[]; window: { since: string | null; until: string | null }; entries: number; errors: number; kinds: number; new?: number; newSignatures?: string[]; top: { signature: string; count: number; first: string | null; last: string | null; levels: string; new?: boolean; example: Entry }[]; leftOut?: number; notes?: string[] } | { error: string }>;

  // Entries per bucket of time. bucket: "10s", "1m", "5m", "1h", "1d"; default: at most 48 buckets over the window.
  // usual is the lower quartile per bucket; high lists the stretches at three times that or more. With grep or level
  // only the matching entries are counted.
  timeline(file: File, o?: Filter & { bucket?: string }): Promise<{ logs: string[]; window: { since: string; until: string }; bucket: string; entries: number; errors: number; warnings: number; usual: { entries: number; errors: number }; high: { from: string; to: string; buckets: number; of: string; entries: number; errors: number }[]; buckets: string[]; notes?: string[] } | { error: string }>;

  // When a text (literal, any case), a regex or a signature (or part of one) first appeared, how often since, and the
  // entries just before the first one (before: default 5). counts are per hour, or per day over a long span.
  firstSeen(file: File, o: { text?: string; regex?: string; signature?: string; before?: number; since?: string; until?: string; rotated?: boolean }): Promise<{ logs: string[]; what: string; count: number; first?: Entry; signature?: string; last?: { time: string | null; file: string; line: number } | null; before?: Entry[]; over?: string; counts?: string[]; perLog?: { log: string; count: number; first: string | null }[]; verdict?: string; notes?: string[] } | { error: string }>;

  // A web access log, or any log whose entries have a status field (status, status_code) and a path (path, url, uri):
  // requests by status class, failing paths, slow paths (when there is request_time or a duration), clients, the 5xx
  // rate over time. Paths are patterns: no query, and a segment with digits is <*>.
  requests(file: File, o?: { since?: string; until?: string; path?: string; grep?: string; top?: number; rotated?: boolean }): Promise<any>;

  // Two logs or two windows compared by signature. a and b are each a file, or {file?, since?, until?, rotated?};
  // o.file is the log for a side that names none. By default entries at warn and above; all: true compares every entry.
  //   logs.compare({until: "21:14"}, {since: "21:14"}, {file: "app.log"})    logs.compare("good-run.log", "bad-run.log")
  compare(a: string | { file?: File; since?: string; until?: string; rotated?: boolean }, b: string | { file?: File; since?: string; until?: string; rotated?: boolean }, o?: { file?: File; all?: boolean; level?: Level; top?: number; rotated?: boolean }): Promise<{ what: string; a: any; b: any; onlyInA: { signature: string; count: number; example: any }[]; onlyInB: { signature: string; count: number; example: any }[]; changed: { signature: string; a: number; b: number; change: number }[]; unchanged: number; counts: { onlyInA: number; onlyInB: number; changed: number }; leftOut?: any; notes?: string[] } | { error: string }>;

  // The signature of a text: timestamps, UUIDs, IP addresses, quoted values, hex ids, long ids, durations, sizes, email
  // addresses, the variable parts of paths and URLs, values of id-like keys (user=, request_id=, host=) and numbers
  // become <time>, <uuid>, <ip>, <str>, <hex>, <id>, <dur>, <size>, <email>, <*>, <n>. Kept, because they name the
  // error: a number after status, code, errno, exit, signal ("status 502", "exit code 137") and codes such as E404,
  // TS2345, ORA-00942. Names in plain words (a person, a table outside quotes) are not replaced.
  //   logs.signature("timeout after 3021ms calling 10.0.0.7") === "timeout after <dur> calling <ip>"
  signature(text: string): string;

  // The settings in use.
  config(): { workdir: string; dirs: string[]; utcOffsetMinutes: number };
};
