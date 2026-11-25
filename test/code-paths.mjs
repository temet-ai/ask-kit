// The code domain's answers about a path that does not exist, and about another repository than the
// one the ask runs in. No network, no model.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeRepo, readOnly, withAt } from "../domains/code/repo.mjs";
import history from "../domains/code/scripts/history.mjs";
import knobs from "../domains/code/scripts/knobs.mjs";
import lookup from "../domains/code/scripts/lookup.mjs";
import outline from "../domains/code/scripts/outline.mjs";
import where from "../domains/code/scripts/where.mjs";

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ask-kit-code-paths-")));
const gitIn = (dir) => (...a) => execFileSync("git", ["-c", "user.name=Sam Vimes", "-c", "user.email=vimes@example.com", "-c", "commit.gpgsign=false", ...a], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
const put = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
try {
  const watch = path.join(tmp, "watch"), post = path.join(tmp, "post");
  put(path.join(watch, "crates/night/src/lantern.rs"), "pub fn light_lantern() {}\n");
  put(path.join(watch, "crates/day/src/api/lantern.rs"), "pub fn douse_lantern() {}\n");
  put(path.join(post, "clacks.mjs"), "export const overhead = 'GNU';\n");
  for (const d of [watch, post]) {
    gitIn(d)("init", "-q", "-b", "main");
    gitIn(d)("add", ".");
    gitIn(d)("commit", "-qm", d === watch ? "Light the lanterns" : "Raise the clacks");
  }
  const push = () => {};
  const global = (root) => withAt(readOnly(makeRepo({ root, push, noteMissing: true })), { push, act: false });
  const repo = global(watch);

  // One wrong guess keeps the cell's other results, and names the path that was meant.
  const [hits, read, gone, dir] = await Promise.all([
    repo.rg("light_lantern"),
    repo.read("crates/day/src/lantern.rs"),
    repo.rg("lantern", { path: "crates/night/src/api" }),
    repo.read("crates/night"),
  ]);
  assert.equal(hits[0].file, "crates/night/src/lantern.rs");
  assert.match(read.text, /^NO SUCH PATH crates\/day\/src\/lantern\.rs .*of that name: crates\/day\/src\/api\/lantern\.rs, crates\/night\/src\/lantern\.rs/);
  assert.equal(read.lines, 0);
  assert.equal(gone.total, 0);
  assert.equal(gone.complete, false);
  assert.match(gone.map((h) => h.text).join("\n"), /^NO SUCH PATH crates\/night\/src\/api .*of that name: crates\/day\/src\/api/);
  assert.match(dir.text, /IS A FOLDER, it holds src/);
  const list = await repo.files("*.rs", { path: "crates/noon" });
  assert.equal(list.total, 0);
  assert.match(list[0], /NO SUCH PATH crates\/noon .*crates holds day, night/);
  // A place outside the repository is not searched for a name.
  assert.match(repo.read(path.join(tmp, "palace/vetinari.rs")).text, /NO SUCH PATH .* holds post, watch/);

  // The scripts say so too, and never count the row as a hit.
  for (const r of [await where({ repo }, { name: "lantern", path: "crates/noon" }), await outline({ repo }, { path: "crates/noon" }), await knobs({ repo }, { topic: "lantern", path: "crates/noon" })]) assert.match(r.missing, /NO SUCH PATH crates\/noon/);
  assert.match(await lookup({ repo }, { names: ["light_lantern"], path: "crates/noon" }), /^NO SUCH PATH crates\/noon/);
  assert.match(await lookup({ repo }, { question: "what does `light_lantern` do, and /palace/vetinari?" }), /light_lantern defined: crates\/night/);
  assert.equal(await lookup({ repo }, { question: "what is in /palace/vetinari.rs?" }), null);

  // A kit's folder source keeps its own errors.
  assert.throws(() => makeRepo({ root: watch, push }).read("crates/noon.rs"), /ENOENT/);

  // Another repository: its git, read-only as here, and its history.
  assert.match(await repo.at(post).git("log", "--format=%s"), /Raise the clacks/);
  await assert.rejects(repo.at(post).git("commit", "-m", "x"), /off in this ask/);
  assert.equal(repo.at(post).write, undefined);
  const raised = await history({ repo }, { term: "overhead", path: post });
  assert.equal(raised.root, post);
  assert.deepEqual(raised.commits.map((c) => c.subject), ["Raise the clacks"]);
  assert.equal((await history({ repo }, { term: "overhead", path: path.join(post, "clacks.mjs") })).commits.length, 1);
  await assert.rejects(history({ repo }, { term: "overhead", path: path.join(tmp, "palace") }), /not in a git repository/);

  // Several terms in one search: which found what, and which no commit has.
  gitIn(watch)("mv", "crates/day/src/api/lantern.rs", "crates/day/src/api/moon.rs");
  put(path.join(watch, "crates/day/src/api/moon.rs"), "pub fn moonlight() {}\n");
  gitIn(watch)("add", ".");
  gitIn(watch)("commit", "-qm", "Douse the lanterns");
  const both = await history({ repo }, { term: ["douse_lantern", "moonlight", "vampire"] });
  assert.deepEqual(both.commits.find((c) => c.subject === "Douse the lanterns").term, ["douse_lantern", "moonlight"]);
  assert.deepEqual(both.none, ["vampire"]);
  assert.equal(both.root, undefined);
  // A deleted file is a path git knows.
  assert.equal((await history({ repo }, { path: "crates/day/src/api/lantern.rs" })).commits.length, 2);
  // Another branch only with `all`.
  gitIn(watch)("switch", "-qc", "cable-street");
  put(path.join(watch, "swing.rs"), "fn carcer() {}\n");
  gitIn(watch)("add", ".");
  gitIn(watch)("commit", "-qm", "Watch Carcer");
  gitIn(watch)("switch", "-q", "main");
  assert.equal((await history({ repo }, { term: "carcer" })).commits.length, 0);
  assert.equal((await history({ repo }, { term: "carcer", all: true })).commits.length, 1);

  // A root that is a folder of repositories.
  const city = global(tmp);
  await assert.rejects(city.git("log"), /is not a git repository; it holds these: post, watch\. Use repo\.at\("post"\)/);
  assert.equal((await history({ repo: city }, { term: "overhead", path: "post" })).commits.length, 1);
  console.log("ok");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
