// The library kits get as make({ lib }) (src/kitlib), with no network: redaction keeps commands
// readable and counts intact, credential paths are told from code about them, the runner never
// throws for a failing program and holds back the kit's acts without act, the pool keeps order,
// walking stops at its caps, and HTTP follows redirects, sends bodies, gives up at one deadline for
// the whole exchange, refuses private addresses when asked to, and goes through HTTP_PROXY.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { makeLib, notInThisAsk } from "../src/kitlib/index.mjs";

const lib = makeLib({ kit: "watch" });

// ---- redaction ----
const cases = [
  ["psql --password hunter2-not-real -h db.example.com", "psql --password <redacted> -h db.example.com"],
  ["curl -u vimes:hunter2 https://example.com/roster", "curl -u vimes:<redacted> https://example.com/roster"],
  ["API_KEY=abcdef123456 node server.js --port 3000", "API_KEY=<redacted> node server.js --port 3000"],
  ["mysql -h db -phunter2 watch", "mysql -h db -p<redacted> watch"],
  ['curl -H "Authorization: Bearer abc.def.ghi.jkl" https://example.com', 'curl -H "Authorization: Bearer <redacted>" https://example.com'],
  ['level=info msg="login" password=hunter22 user=vimes', 'level=info msg="login" password=<redacted> user=vimes'],
  ["postgres://watch:hunter2@db.example.com/watch", "postgres://watch:<redacted>@db.example.com/watch"],
  ["https://example.com/cb?client_secret=s3cr3tvalue&page=2", "https://example.com/cb?client_secret=<redacted>&page=2"],
];
for (const [inp, out] of cases) assert.equal(lib.redact(inp), out, inp);
// What must stay: references, files that hold a secret, counts, commit messages, hashes.
for (const keep of ["node x.js --token-file=/etc/watch/token --token $WATCH_TOKEN", 'git commit -m "fix token refresh for Sam Vimes"', "max_tokens=4000 input_tokens: 400", "sha 9f2c1e0d3b4a5c6d7e8f9a0b1c2d3e4f5a6b7c8d"])
  assert.equal(lib.redact(keep), keep, keep);
assert.match(lib.redact("export GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789AB"), /GITHUB_TOKEN=<redacted>$/);
assert.match(lib.redact("-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXk\n-----END OPENSSH PRIVATE KEY-----"), /PRIVATE KEY----- \[redacted\]|<redacted>/);
assert.equal(lib.redact("ticket=WATCH-12 rank=sergeant", { names: ["ticket"] }), "ticket=<redacted> rank=sergeant", "a kit adds its own names");
assert.deepEqual(lib.redactDeep({ user: "vimes", password: "x1", nested: { apiKey: "k", note: "Bearer abcdefghijklmnop1234" }, input_tokens: 400, ok: true }), { user: "vimes", password: "<redacted>", nested: { apiKey: "<redacted>", note: "Bearer <redacted>" }, input_tokens: 400, ok: true });

// ---- credential paths ----
for (const p of ["home/.ssh/config", "api-token.txt", "client_secret.json", "config/secrets.yml", ".env.local", "id_ed25519", "keys/server.pem", ".zsh_history"]) assert.ok(lib.isSecretPath(p), p);
for (const p of ["src/token.js", "docs/tokenizer.md", "notes/Secret Santa.md", "package.json", "watch/roster.csv"]) assert.ok(!lib.isSecretPath(p), p);

// ---- sizes, ages, paths ----
assert.equal(lib.size(1536), "1.5 KB");
assert.equal(lib.size(1.4e9), "1.3 GB");
assert.equal(lib.age(Date.parse("2026-11-18T12:00:00Z"), Date.parse("2026-11-21T12:00:00Z")), "3 days ago");
assert.equal(lib.age(Date.parse("2026-11-21T12:00:40Z"), Date.parse("2026-11-21T12:00:00Z")), "in 40s");
assert.equal(makeLib({ callerDir: path.join(os.tmpdir(), "yard") }).path("roster.csv"), path.join(os.tmpdir(), "yard", "roster.csv"));

// ---- running programs ----
const calls = [];
const guarded = makeLib({ push: (c) => calls.push(c), held: (argv) => (argv.includes("dismiss") ? "watch dismiss" : null) });
const ok = await guarded.run(process.execPath, ["-e", "process.stdout.write('on duty')"]);
assert.equal(ok.code, 0);
assert.equal(ok.out, "on duty");
assert.equal((await guarded.run(process.execPath, ["-e", "process.exit(3)"])).code, 3, "a failing program is data, not a throw");
assert.equal((await guarded.run("nobby-not-installed", [])).code, 127);
const slow = await guarded.run(process.execPath, ["-e", "setTimeout(() => {}, 5000)"], { timeoutMs: 300 });
assert.ok(slow.timedOut, "a timeout ends it");
await assert.rejects(guarded.run("watch", ["dismiss", "Nobby"]), /not in this ask: watch: watch dismiss changes things/);
const acting = makeLib({ act: true, held: () => "watch dismiss" });
assert.equal((await acting.run(process.execPath, ["-e", "1", "dismiss"])).code, 0, "with act nothing is held back");
assert.ok(calls.every((c) => c.kind === "run" && typeof c.ms === "number"), "every call is journaled");
assert.equal(notInThisAsk("x").startsWith("not in this ask: x changes things"), true);
assert.throws(() => lib.deny("reading .env prints secrets; use the settings instead"), /^Error: not allowed: reading \.env/);

// ---- pool ----
let running = 0;
let most = 0;
const order = await lib.pool([5, 1, 4, 2, 3], 2, async (x) => {
  most = Math.max(most, ++running);
  await new Promise((r) => setTimeout(r, x * 5));
  running--;
  return x * 10;
});
assert.deepEqual(order, [50, 10, 40, 20, 30]);
assert.equal(most, 2);

// ---- walking ----
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ask-kit-kitlib-"));
for (const f of ["roster.csv", "posts/cable-street.md", "posts/pseudopolis.md", "node_modules/x/index.js", ".env", "keys/id_ed25519", ".hidden/x.md"]) {
  fs.mkdirSync(path.dirname(path.join(tmp, f)), { recursive: true });
  fs.writeFileSync(path.join(tmp, f), "x");
}
const w = lib.walk(tmp);
assert.deepEqual(w.files.map((f) => f.rel).sort(), ["posts/cable-street.md", "posts/pseudopolis.md", "roster.csv"]);
assert.equal(w.secretsSkipped, 2, ".env and keys/id_ed25519 are counted, never listed");
assert.equal(lib.walk(tmp, { max: 2 }).cut, "stopped at 2 files");
assert.deepEqual(lib.walk(tmp, { match: /\.md$/ }).files.map((f) => f.rel).sort(), ["posts/cable-street.md", "posts/pseudopolis.md"]);

// ---- HTTP ----
const server = http.createServer((req, res) => {
  if (req.url === "/roster") return res.end(JSON.stringify({ post: "Cable Street", officers: ["Angua"] }));
  if (req.url === "/old") return res.writeHead(302, { location: "/roster" }).end();
  if (req.url === "/report" && req.method === "POST") {
    let b = "";
    req.on("data", (c) => (b += c));
    return req.on("end", () => res.end(`got ${b}`));
  }
  if (req.url === "/dribble") {
    // A byte now and then: a per-read timeout would never fire; the whole-exchange deadline must.
    res.writeHead(200);
    const t = setInterval(() => res.write("."), 100);
    return req.on("close", () => clearInterval(t));
  }
  res.writeHead(404).end("no such post");
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const roster = await lib.http.request(`${base}/old`);
assert.equal(roster.status, 200);
assert.equal(roster.hops.length, 2, "the redirect was followed");
assert.match(roster.body.toString(), /Cable Street/);
assert.equal((await lib.http.request(`${base}/report`, { method: "POST", body: "WATCH-12", headers: { "content-type": "text/plain" } })).body.toString(), "got WATCH-12");
assert.equal((await lib.http.request(`${base}/missing`)).status, 404);
const t0 = Date.now();
const dribble = await lib.http.request(`${base}/dribble`, { timeoutMs: 500 });
assert.equal(dribble.ok, false);
assert.equal(dribble.code, "ETIMEDOUT");
assert.ok(Date.now() - t0 < 2500, "one deadline for the whole exchange");
await assert.rejects(lib.http.request(`${base}/roster`, { publicOnly: true }), /not allowed: 127\.0\.0\.1 is on this machine or a private network/);
await assert.rejects(lib.http.request("http://169.254.169.254/latest/meta-data/", { publicOnly: true }), /not allowed/);
assert.equal((await lib.http.request("http://nobby.invalid/", { timeoutMs: 2000 })).ok, false, "a name that does not resolve is data");

// Through a proxy: HTTP_PROXY for a name that is not this machine; NO_PROXY passes one by.
const seen = [];
const proxy = http.createServer((req, res) => {
  seen.push(req.url);
  res.end("from the proxy");
});
await new Promise((r) => proxy.listen(0, "127.0.0.1", r));
process.env.HTTP_PROXY = `http://127.0.0.1:${proxy.address().port}`;
process.env.NO_PROXY = "uu.invalid";
delete process.env.http_proxy;
delete process.env.no_proxy;
const viaProxy = await lib.http.request("http://watch.invalid/roster");
assert.equal(viaProxy.body.toString(), "from the proxy");
assert.equal(viaProxy.viaProxy, true);
assert.deepEqual(seen, ["http://watch.invalid/roster"], "the proxy got the whole address");
assert.equal(lib.http.proxyFor("http://library.uu.invalid/"), null, "NO_PROXY covers subdomains");
assert.equal(lib.http.proxyFor(`${base}/roster`), null, "this machine is never sent through a proxy");

server.close();
proxy.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log("ok");
process.exit(0);
