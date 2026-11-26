// The code map (domains/code/scan.mjs, map.mjs, scripts/map.mjs) on a made-up repository in six
// languages: what the scanner reads, that every use ripgrep finds is in the map or in the rows it
// searches with ripgrep, that a second session and a second worktree in the same tree reuse the map,
// that an edit is read again alone and a commit rereads only what it changed, that the map says when
// it is stale or partial, and that lookup uses the map when there is one and ripgrep when not.
// No model, no network.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ask-kit-code-map-")));
process.env.ASK_KIT_CONFIG = path.join(tmp, "config");
process.env.ASK_KIT_STATE = path.join(tmp, "state");
const { DEF_KINDS, KINDS, decodeUses, lex, scanFile } = await import("../domains/code/scan.mjs");
const maps = await import("../domains/code/map.mjs");
const { NOISE, noisy } = await import("../domains/code/lib.mjs");
const { makeRepo } = await import("../domains/code/repo.mjs");
const { default: mapScript } = await import("../domains/code/scripts/map.mjs");
const { default: lookup } = await import("../domains/code/scripts/lookup.mjs");

const git = (cwd, ...args) =>
  execFileSync("git", ["-c", "user.email=vimes@example.com", "-c", "user.name=Sam Vimes", "-c", "commit.gpgsign=false", ...args], { cwd, stdio: ["ignore", "pipe", "pipe"] }).toString();
const defs = (r) => r.d.map((d) => `${d[4] ? `${d[4]}.` : ""}${d[0]} ${DEF_KINDS[d[3]]} ${d[1]}-${d[2]}`);
const usesIn = (r, name) => (decodeUses(r, name) ?? []).map((c) => `${c >> 3}:${KINDS[c & 7]}`);

try {
  // ---- the scanner ----

  // Comments and strings are blanked, with every line kept; what follows a tricky literal is still code.
  const js = 'const q = /\'"/; ring(q); // ring("no")\nconst t = `a ${bell(1)} b`;\n';
  const { mask } = lex(js, "js");
  assert.equal(mask.length, js.length);
  assert.equal(mask.split("\n").length, js.split("\n").length);
  assert.match(mask, /ring\(q\);/);
  assert.doesNotMatch(mask, /"no"/);
  assert.match(mask, /bell\(1\)/, "code inside a template's ${} stays code");
  const jsScan = scanFile(js, "js");
  assert.deepEqual(usesIn(jsScan, "ring"), ["1:call", "1:comment"]);
  assert.deepEqual(usesIn(jsScan, "bell"), ["2:call"]);

  const rs = scanFile(
    [
      "impl<'a> Job for Worker<'a> {",
      "    fn run(&mut self) -> Result<(), String> {",
      "        let c = '\"';",
      '        let raw = r#"a " b"#;',
      "        self.retries += 1;",
      "        charge(c)",
      "    }",
      "}",
    ].join("\n"),
    "rust",
  );
  assert.deepEqual(defs(rs), ["Worker impl 1-8", "Worker.run method 2-7"]);
  assert.deepEqual(rs.r, [[0, "Worker", "Job", 1]], "impl Job for Worker: Worker implements Job");
  assert.deepEqual(usesIn(rs, "charge"), ["6:call"], "a char holding a quote and a raw string do not hide the call");
  assert.deepEqual(usesIn(rs, "retries"), ["5:write"]);

  const py = scanFile(['"""Watch."""', "class Watch(Guild):", "    rank: str = 'x'", "    def patrol(self,", "               street):", '        """def fake():"""', "        return relieve(street)", "", "def relieve(s):", "    return s"].join("\n"), "python");
  assert.deepEqual(defs(py), ["Watch class 2-7", "Watch.rank field 3-3", "Watch.patrol method 4-7", "relieve function 9-10"]);
  assert.deepEqual(py.r, [[1, "Watch", "Guild", 2]]);
  assert.ok(!py.d.some((d) => d[0] === "fake"), "a def inside a docstring is not a definition");

  const go = scanFile(["type Patroller interface {", "\tPatrol(street string) error", "}", "type Constable struct {", "\tName, Rank string", "}", "func (c *Constable) Patrol(s string) error {", "\treturn nil", "}"].join("\n"), "go");
  assert.deepEqual(defs(go), ["Patroller interface 1-3", "Patroller.Patrol method 2-2", "Constable struct 4-6", "Constable.Name field 5-5", "Constable.Rank field 5-5", "Constable.Patrol method 7-9"]);

  const sql = scanFile("create table if not exists messages (\n  id integer primary key,\n  body text\n);\nupdate messages set body = 'it''s';\n", "sql");
  assert.deepEqual(defs(sql), ["messages table 1-4", "messages.id column 2-2", "messages.body column 3-3"]);
  assert.deepEqual(usesIn(sql, "messages"), ["1:call", "5:write"]);

  // Braces that do not balance: the file is marked, and its definitions end where their indentation does.
  const broken = scanFile("function a() {\n  if (x) {\n  return 1;\n}\nfunction b() {\n  return 2;\n}\n", "js");
  assert.equal(broken.u, 1);
  assert.deepEqual(defs(broken).filter((d) => d.startsWith("b ")), ["b function 5-7"]);

  // noisy() leaves out what NOISE leaves out of every search.
  for (const p of ["node_modules/x/a.js", "a/target/b.rs", "web/dist/app.js", "x.min.js", "Cargo.lock", "a/package-lock.json", "a/__snapshots__/b.js"]) assert.ok(noisy(p), p);
  for (const p of ["src/build.rs", "src/vendors.js", "lib/target.py"]) assert.ok(!noisy(p), p);
  assert.ok(NOISE.includes("!**/node_modules/**"));

  // ---- the map of a repository ----

  const root = path.join(tmp, "watch");
  fs.cpSync(path.join(HERE, "fixtures", "code-map"), root, { recursive: true });
  // A generated file over 1 MB: the map does not read it, and its use of ringBell must still be found.
  fs.writeFileSync(path.join(root, "src", "huge.mjs"), `export const rows = [\n${'  "x",\n'.repeat(200_000)}];\nringBell("huge");\n`);
  git(root, "init", "-q");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "The Watch");
  const repo = makeRepo({ root, push() {} });

  // Before any map, lookup searches with ripgrep, whose definition pattern misses a class method.
  const before = await lookup({ repo }, { names: ["patrol"] });
  assert.doesNotMatch(before, /code map/);
  assert.match(before, /patrol used: .*no definition line found/);

  const first = await maps.ensureMap(root);
  assert.equal(first.built, "now");
  assert.equal(first.files.size, 8);
  assert.deepEqual(first.skipped, { "src/huge.mjs": "over 1 MB" });
  assert.match(maps.statusLine(first), /PARTIAL: 1 file\(s\) not mapped \(src\/huge\.mjs: over 1 MB\); they were searched with ripgrep/);
  const treeFile = path.join(process.env.ASK_KIT_STATE, "code-map", `${first.tree}.json.gz`);
  assert.ok(fs.existsSync(treeFile), "stored under ASK_KIT_STATE by the git tree");

  // Every line ripgrep finds holding ringBell is a definition, a use, or a row from the files the map does not cover.
  const rows = await mapScript({ repo }, { names: ["ringBell"], rows: true });
  const ring = rows.names.ringBell;
  const listed = [...ring.definitions, ...ring.uses, ...ring.elsewhere].map((x) => `${x.file}:${x.line}`).sort();
  const searched = [...(await repo.rg("\\bringBell\\b", { max: 1000 }))].map((h) => `${h.file}:${h.line}`).sort();
  assert.deepEqual(listed, searched);
  assert.deepEqual(listed, ["README.md:3", "config/watch.yaml:1", "src/huge.mjs:200003", "src/watch.mjs:21", "src/watch.mjs:28"]);
  // The entry the map must not miss: the call after a regular expression with a quote in it, with its caller.
  assert.deepEqual(ring.uses.find((u) => u.line === 21), { file: "src/watch.mjs", line: 21, kind: "call", caller: "Watch.patrol", callerAt: "src/watch.mjs:18-25", text: "ringBell(quote);" });

  // Callers through two levels, implementations, writers, a range of lines, a glob of names.
  const text = await mapScript({ repo }, { names: ["ringBell", "Tower", "Patroller", "Patrol", "Guild", "retries", "messages"], callers: 2, budget: 20000 });
  assert.match(text, /^Code map: tree [0-9a-f]{10}, 8 files \(js 2, go 1, python 1, rust 1, sql 1, ts 1\), built \d{4}-\d\d-\d\d \d\d:\d\d UTC\./);
  assert.match(text, /## ringBell callers, 2 level\(s\)[^\n]*\nsrc\/watch\.mjs:21 \[in Watch\.patrol 18-25\] ringBell\(quote\);\n {2}src\/watch\.mjs:33 \[in nightShift 32-34\] return watch\.patrol\("Treacle Mine Road"\);/);
  assert.match(text, /crates\/clacks\/src\/lib\.rs:11 SemaphoreTower implements Tower/);
  assert.match(text, /ops\/rota\.go:12 Constable implements Patroller \(method set\)/);
  assert.match(text, /src\/patrol\.ts:6 NightWatch implements Patrol[\s\S]*src\/patrol\.ts:13 DayWatch implements Patrol/);
  assert.match(text, /guild\/assassins\.py:10 Assassins extends Guild[\s\S]*src\/watch\.mjs:10 Watch extends Guild/);
  assert.match(text, /## retries written[^\n]*\ncrates\/clacks\/src\/lib\.rs:14 \[in SemaphoreTower\.send 12-17\] self\.retries \+= 1;\ncrates\/clacks\/src\/lib\.rs:28 \[in new_tower 27-29\]/);
  assert.match(text, /## messages written[^\n]*\ncrates\/clacks\/src\/lib\.rs:15 [^\n]*INSERT INTO messages[^\n]*\ndb\/schema\.sql:7 insert into messages/);
  const range = await mapScript({ repo }, { at: "src/watch.mjs:18-25", rows: true });
  assert.deepEqual(range.ranges[0].calls.map((c) => `${c.name} -> ${c.defined}`), ["ringBell -> src/watch.mjs:28-30", "relieve -> src/watch.mjs:6-8", "push -> null"]);
  const glob = await mapScript({ repo }, { names: ["*Watch"], callers: 0, rows: true });
  assert.deepEqual(Object.keys(glob.names), ["DayWatch", "NightWatch", "Watch"]);
  assert.match(await mapScript({ repo }, { names: ["Rincewind"] }), /Not found \(no definition or use in the map, and none in other files\): Rincewind/);

  // A second session in the same tree (a new process: a fresh module) reuses the stored map.
  const fresh = await import("../domains/code/map.mjs?second-session");
  const second = await fresh.ensureMap(root);
  assert.equal(second.built, "reused");
  assert.equal(second.rescanned, 0);
  // So does a second worktree at the same commit.
  git(root, "worktree", "add", "-q", path.join(tmp, "watch-2"));
  const other = await fresh.ensureMap(path.join(tmp, "watch-2"));
  assert.equal(other.built, "reused");
  assert.equal(other.rescanned, 0);
  assert.equal(other.key, first.key);

  // An edit after the build: that file alone is read again; the tree's map is left as it was.
  const storedBefore = fs.readFileSync(treeFile);
  fs.appendFileSync(path.join(root, "src", "watch.mjs"), "\nexport function endShift(post) {\n  return relieve(post);\n}\n");
  const edited = await maps.ensureMap(root);
  assert.equal(edited.built, "reused");
  assert.equal(edited.rescanned, 1);
  assert.equal(edited.changed, 1);
  assert.ok(fs.readFileSync(treeFile).equals(storedBefore));
  const callers = await mapScript({ repo }, { names: ["relieve"], callers: 1, rows: true });
  assert.deepEqual(callers.names.relieve.callers.map((c) => `${c.file}:${c.line} ${c.caller}`), ["src/watch.mjs:22 Watch.patrol", "src/watch.mjs:37 endShift"]);
  // The next session finds the edit in the checkout's record and reads nothing.
  const third = await (await import("../domains/code/map.mjs?third-session")).ensureMap(root);
  assert.equal(third.rescanned, 0);
  assert.equal(third.changed, 1);

  // A commit that changes another file too: a new tree, built from the last map by reading that file only.
  fs.appendFileSync(path.join(root, "ops", "rota.go"), "\nfunc Relieve() {}\n");
  git(root, "commit", "-qam", "Relieve the watch");
  const committed = await maps.ensureMap(root);
  assert.notEqual(committed.key, first.key);
  assert.equal(committed.built, "updated");
  assert.equal(committed.rescanned, 1);
  assert.ok(fs.existsSync(path.join(process.env.ASK_KIT_STATE, "code-map", `${committed.tree}.json.gz`)));

  // Lookup with the map: the class method's definition and its whole body, and the caller of each use.
  const after = await lookup({ repo }, { names: ["patrol"] });
  assert.match(after, /Names from the code map \(8 files/);
  assert.match(after, /## patrol defined: src\/watch\.mjs:18-25\n18\t {2}async patrol\(street, o = \{\}\) \{[\s\S]*\n25\t {2}\}/);
  assert.match(after, /src\/watch\.mjs:33 \[in function nightShift\] return watch\.patrol/);

  // Stale: a change not read again in the time allowed is named, its old rows kept, and its lines searched with ripgrep.
  fs.appendFileSync(path.join(root, "guild", "assassins.py"), "\n\ndef sergeant_colon():\n    return enrol()\n");
  const stale = await (await import("../domains/code/map.mjs?stale")).ensureMap(root, { budgetMs: -1 });
  assert.deepEqual(stale.stale, ["guild/assassins.py"]);
  assert.match(maps.statusLine(stale), /STALE: 1 changed file\(s\) not read again yet \(guild\/assassins\.py\)/);
  const hits = await maps.textHits(repo, stale, ["sergeant_colon"]);
  assert.deepEqual(hits.get("sergeant_colon").map((h) => `${h.file}:${h.line}`), ["guild/assassins.py:25"]);
  assert.equal(await maps.ensureMap(root, { build: false }).then((m) => m.stale.length), 0, "with time, the change is read");

  // Several functions share a name: a caller that names another module through `path::` is not a
  // caller of the one that holds the use; one that names its module, or no module, is.
  const guilds = path.join(tmp, "guilds");
  fs.mkdirSync(path.join(guilds, "src", "tools"), { recursive: true });
  fs.writeFileSync(path.join(guilds, "src", "tools", "thieves.rs"), "pub fn call_tool() {\n    pay_dues();\n}\n");
  fs.writeFileSync(path.join(guilds, "src", "tools", "seamstresses.rs"), "pub fn call_tool() {}\n");
  fs.writeFileSync(path.join(guilds, "src", "tools", "mod.rs"), "pub fn call_tool() {}\n");
  fs.writeFileSync(path.join(guilds, "src", "lib.rs"), "fn pay_dues() {}\n");
  fs.writeFileSync(
    path.join(guilds, "src", "dispatch.rs"),
    "fn by_guild(g: u8) {\n    if g == 1 {\n        thieves::call_tool();\n    }\n    seamstresses::call_tool();\n}\nfn any() {\n    crate::tools::call_tool();\n}\n",
  );
  git(guilds, "init", "-q");
  const guildRepo = makeRepo({ root: guilds, push() {} });
  await maps.ensureMap(guilds);
  const dues = await mapScript({ repo: guildRepo }, { names: ["pay_dues"], callers: 2, rows: true });
  const level2 = dues.names.pay_dues.callers.flatMap((c) => c.callers.map((x) => `${x.file}:${x.line}`));
  assert.deepEqual(level2, ["src/dispatch.rs:3"], "thieves::call_tool reaches thieves.rs; seamstresses:: and crate::tools:: (mod.rs) do not");
  const { reaches } = await import("../domains/code/scripts/map.mjs");
  assert.equal(reaches("crate::tools::call_tool();", "call_tool", { file: "src/tools/mod.rs" }), true);
  assert.equal(reaches("self::call_tool();", "call_tool", { file: "src/x.rs" }), true);
  assert.equal(reaches("Store::open(p)", "open", { file: "src/a.rs", container: "Store" }), true);
  assert.equal(reaches("Other::open(p)", "open", { file: "src/a.rs", container: "Store" }), false);

  // A repository with no map yet: lookup does not build one.
  const bare = path.join(tmp, "bare");
  fs.mkdirSync(path.join(bare, "src"), { recursive: true });
  fs.writeFileSync(path.join(bare, "src", "a.mjs"), "export function lantern() {}\nlantern();\n");
  git(bare, "init", "-q");
  assert.equal(await maps.ensureMap(bare, { build: false }), null);
  assert.doesNotMatch(await lookup({ repo: makeRepo({ root: bare, push() {} }) }, { names: ["lantern"] }), /code map/);
  assert.ok(!fs.existsSync(path.join(process.env.ASK_KIT_STATE, "code-map", `checkout-${bare.replace(/^\/+/, "").replace(/[^A-Za-z0-9._-]+/g, "-")}.json.gz`)));
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log("ok");
