// Writes the fixture logs. Every time is fixed and the random numbers come from a seed, so the
// files are the same on every run: node bench/fixture/build.mjs
// The logs are invented: the clacks relay, the City Watch duty application, a web front and a
// semaphore tower of Ankh-Morpork. Hosts are example.com and private addresses.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
let seed = 1983;
const rnd = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = (a) => a[int(0, a.length - 1)];
const hex = (n) => Array.from({ length: n }, () => "0123456789abcdef"[int(0, 15)]).join("");
const at = (s) => Date.parse(s);
const write = (name, lines) => {
  const file = path.join(here, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const text = lines.join("\n") + "\n";
  fs.writeFileSync(file, name.endsWith(".gz") ? zlib.gzipSync(text, { level: 9 }) : text);
  console.log(`${name}: ${lines.length} lines`);
};

// --- clacks-relay.jsonl: a JSON lines service log. From 21:14:07 a new error starts: the relay
// times out calling 10.0.0.7. An older error (checksum mismatch) occurs now and then all along.
{
  const lines = [];
  const towers = ["tower-1", "tower-2", "tower-3", "tower-5", "tower-7"];
  const start = at("2026-11-08T20:00:00Z");
  const broken = at("2026-11-08T21:14:07Z");
  let t = start;
  let i = 0;
  let sharedDone = false;
  const row = (o) => lines.push(JSON.stringify({ time: new Date(t).toISOString(), ...o }));
  while (t < at("2026-11-08T22:00:00Z")) {
    i++;
    const shared = !sharedDone && t >= at("2026-11-08T21:31:03Z");
    if (shared) sharedDone = true;
    const request_id = shared ? "req-7f3a" : `req-${hex(4)}`;
    const tower = pick(towers);
    if (i === 40 || i === 95 || i === 170 || i === 250 || i === 330) row({ level: "error", msg: "relay failed", err: `checksum mismatch on frame ${int(1000, 9999)} from ${tower}`, tower, request_id });
    else if (i === 120) row({ level: "info", msg: "operator login", user: "adora.dearheart", password: "gnu-terry-pratchett", authorization: "Bearer clacks-operator-token-0042" });
    else if (shared || (t >= broken && i % 3 === 0)) row({ level: "error", msg: "relay failed", err: `timeout after ${int(2990, 3040)}ms calling 10.0.0.7:4000`, tower, request_id });
    else if (i % 23 === 0) row({ level: "warn", msg: "queue depth high", depth: int(120, 480), tower });
    else row({ level: "info", msg: "message relayed", tower, request_id, ms: int(4, 38) });
    t += 18000 + int(0, 4000);
  }
  row({ level: "fatal", msg: "relay stopped", err: "too many failures: 41 in 10m" });
  write("clacks-relay.jsonl", lines);
}

// --- watch-app.log: Python logging with a time and no zone. A traceback (twice, with different
// details), a request id shared with the relay log, and three lines that hold credentials.
{
  const lines = [];
  const stamp = (t) => new Date(t).toISOString().replace("T", " ").replace("Z", "").replace(".", ",");
  let t = at("2026-11-08T21:00:03.120Z");
  const officers = ["Sergeant Colon", "Corporal Nobbs", "Captain Carrot", "Sergeant Angua", "Constable Visit", "Sergeant Detritus"];
  const posts = ["Pseudopolis Yard", "Treacle Mine Road", "the Shades", "the Brass Bridge", "Sator Square"];
  let i = 0;
  while (t < at("2026-11-08T21:45:00Z")) {
    i++;
    const s = stamp(t);
    if (i === 3) lines.push(`${s} INFO watch.db: Connecting to postgres://vimes:sybil-and-young-sam@db.example.com:5432/watch`);
    else if (i === 5) lines.push(`${s} DEBUG watch.auth: login ok user=vimes password=ramkin-1 from 10.0.0.12`);
    else if (i === 8) lines.push(`${s} DEBUG watch.http: POST https://clacks.example.com/v1/send Authorization: Bearer gnu-0123456789abcdef`);
    else if (i === 41 || i === 81) {
      const badge = i === 41 ? 177 : 208;
      lines.push(`${s} ERROR watch.duty: Unhandled exception while saving roster`);
      lines.push("Traceback (most recent call last):");
      lines.push('  File "/srv/watch/app.py", line 212, in handle');
      lines.push("    save_roster(post, badges)");
      lines.push('  File "/srv/watch/duty.py", line 88, in save_roster');
      lines.push("    row = roster[badge]");
      lines.push(`KeyError: 'badge ${badge}'`);
    } else if (i === 63) lines.push(`${s} ERROR watch.clacks: Failed to send report WATCH-12 to tower-3: timeout after 3003ms calling 10.0.0.7:4000 request_id=req-7f3a`);
    else if (i % 11 === 0) lines.push(`${s} WARNING watch.cells: Cell ${int(1, 6)} over capacity: ${int(5, 9)} prisoners`);
    else if (i % 4 === 0) lines.push(`${s} INFO watch.patrol: ${pick(officers)} reported in from ${pick(posts)}, ${int(0, 3)} arrests`);
    else lines.push(`${s} INFO watch.duty: Shift roster saved for ${pick(posts)}: ${int(3, 9)} officers in ${int(8, 40)}ms`);
    t += 29000 + int(0, 2000);
  }
  write("watch-app.log", lines);
}

// --- access.log: nginx combined format with the request time at the end. From 21:14 to 21:17
// POST /clacks/send answers 502 after about three seconds.
{
  const lines = [];
  const month = "Nov";
  const stamp = (t) => {
    const d = new Date(t).toISOString();
    return `${d.slice(8, 10)}/${month}/${d.slice(0, 4)}:${d.slice(11, 19)} +0000`;
  };
  const agent = "Mozilla/5.0 (Discworld; Hex) ImpBrowser/1.0";
  let t = at("2026-11-08T21:00:01Z");
  let i = 0;
  while (t < at("2026-11-08T21:30:00Z")) {
    i++;
    const ip = `10.0.0.${pick([12, 12, 12, 14, 21, 33])}`;
    const burst = t >= at("2026-11-08T21:14:00Z") && t < at("2026-11-08T21:17:00Z");
    let req, status, bytes, rt;
    const k = i % 5;
    if (i === 17) [req, status, bytes, rt] = ["GET /watch/login?user=vimes&token=tok-abcdef123456 HTTP/1.1", 302, 0, 0.021];
    else if (k === 0 || (burst && k === 2)) {
      req = "POST /clacks/send HTTP/1.1";
      if (burst) [status, bytes, rt] = [502, 157, 3 + int(0, 40) / 1000];
      else [status, bytes, rt] = [200, int(80, 200), int(20, 90) / 1000];
    } else if (k === 1) [req, status, bytes, rt] = [`GET /watch/roster/${int(1, 40)} HTTP/1.1`, 200, int(900, 4000), int(8, 60) / 1000];
    else if (k === 2) [req, status, bytes, rt] = ["GET /static/app.js HTTP/1.1", 200, 48211, int(1, 4) / 1000];
    else if (k === 3) [req, status, bytes, rt] = [`GET /watch/incidents?page=${int(1, 9)} HTTP/1.1`, 200, int(2000, 9000), int(100, 420) / 1000];
    else if (i % 20 === 4) [req, status, bytes, rt] = ["GET /favicon.ico HTTP/1.1", 404, 153, 0.001];
    else [req, status, bytes, rt] = ["GET /watch/duty HTTP/1.1", 200, int(1200, 2400), int(10, 45) / 1000];
    lines.push(`${ip} - - [${stamp(t)}] "${req}" ${status} ${bytes} "-" "${agent}" ${rt.toFixed(3)}`);
    t += 5000 + int(0, 2000);
  }
  write("access.log", lines);
}

// --- tower/semaphore.log, .1 and .2.gz: a rotated set in logfmt, one file a day. The shutter jams
// on every day and more on the last; "lamp oil low" appears only on the last day; fog only before it.
{
  const day = (date, jams, extra) => {
    const lines = [];
    let t = at(`${date}T06:00:00Z`);
    let i = 0;
    const jamAt = new Set(Array.from({ length: jams }, (_, j) => 5 + j * Math.floor(50 / jams)));
    while (t < at(`${date}T18:00:00Z`)) {
      i++;
      const time = new Date(t).toISOString().replace(".000Z", "Z");
      const tower = pick(["tower-2", "tower-3", "tower-5"]);
      if (jamAt.has(i)) lines.push(`time=${time} level=error msg="shutter jammed" tower=${tower} shutter=${int(1, 8)} err="motor stalled after ${int(900, 1500)}ms"`);
      else if (extra === "fog" && i % 17 === 0) lines.push(`time=${time} level=warn msg="fog: visibility ${int(20, 80)} yards" tower=${tower}`);
      else if (extra === "oil" && i % 13 === 0) lines.push(`time=${time} level=error msg="lamp oil low" tower=tower-2 remaining=${int(1, 9)}%`);
      else lines.push(`time=${time} level=info msg="shutter cycle complete" tower=${tower} cycles=${int(80, 160)} ms=${int(300, 700)}`);
      t += 11 * 60000 + int(0, 120) * 1000;
    }
    return lines;
  };
  write("tower/semaphore.log.2.gz", day("2026-11-06", 2, "fog"));
  write("tower/semaphore.log.1", day("2026-11-07", 3, "fog"));
  write("tower/semaphore.log", day("2026-11-08", 9, "oil"));
}

// --- gate.log: syslog (RFC 3164). No year in its times and no levels.
{
  const lines = [];
  let t = at("2026-11-08T21:00:03Z");
  const stamp = (x) => {
    const d = new Date(x).toISOString();
    return `Nov ${String(+d.slice(8, 10)).padStart(2, " ")} ${d.slice(11, 19)}`;
  };
  for (let i = 1; i <= 24; i++) {
    const s = stamp(t);
    if (i === 9 || i === 10 || i === 15) lines.push(`${s} pseudopolis-yard sshd[${int(300, 900)}]: Failed password for nobby from 10.0.0.66 port ${int(2000, 60000)} ssh2`);
    else if (i % 6 === 0) lines.push(`${s} pseudopolis-yard gate[211]: closed after ${int(2, 30)}s`);
    else lines.push(`${s} pseudopolis-yard gate[211]: opened for ${pick(["Sergeant Colon", "Corporal Nobbs", "Captain Carrot"])}`);
    t += 60000 + int(0, 30000);
  }
  write("gate.log", lines);
}
