// ask-kit kit commons with fixture kits: a kit's own copy of a job lib does (redaction) is a "use",
// the same helper written in two kits with other names is found as shared code, and a job two kits
// do that lib has no function for is a "promote". No model, no network.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { evaluate, unitsOf } from "../src/commons.mjs";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ask-kit-commons-"));
const kit = (name, files) => {
  for (const [f, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(tmp, name, f)), { recursive: true });
    fs.writeFileSync(path.join(tmp, name, f), text);
  }
  return { name, dir: path.join(tmp, name) };
};

// The same "post of an officer" helper in two kits, with different names for everything local.
const helperA = `export function postOf(officer, roster) {
  const rows = roster.filter((r) => r.name === officer || r.name.toLowerCase().includes(officer.toLowerCase()));
  if (!rows.length) throw new Error("no officer " + officer + "; have: " + roster.map((r) => r.name).join(", "));
  const latest = rows.sort((a, b) => b.since.localeCompare(a.since))[0];
  return { officer: latest.name, post: latest.post, since: latest.since, matched: rows.length > 1 ? "substring" : "exact" };
}`;
const helperB = helperA.replace(/officer/g, "guard").replace(/roster/g, "duty").replace(/rows/g, "found").replace(/latest/g, "newest").replace("postOf", "whereIs");

const watch = kit("watch", {
  "watch.mjs": `${helperA}
const scrub = (text) =>
  String(text)
    .replace(/(password|token|secret|api_key)=\\S+/gi, "$1=<redacted>")
    .replace(/(Authorization:\\s*Bearer\\s+)\\S+/gi, "$1<redacted>")
    .replace(/(:\\/\\/[^:@\\s]+:)[^@\\s]+@/g, "$1<redacted>@");
export function make() { return { postOf, scrub }; }
`,
});
const clacks = kit("clacks", { "clacks.mjs": `${helperB}\nexport function make() { return { whereIs }; }\n` });
const quiet = kit("quiet", { "quiet.mjs": "export function make() { return { hello: () => 'hi' }; }\n" });

assert.ok(unitsOf(path.join(watch.dir, "watch.mjs")).some((u) => u.name === "postOf"), "a named function is a unit");

const e = evaluate([watch, clacks, quiet]);
// watch's scrub is its own copy of lib.redact.
assert.deepEqual(e.byKit.watch.use.map((u) => u.job), ["redact"]);
assert.match(e.byKit.watch.use[0].lib, /lib\.redact/);
// postOf and whereIs are the same code under other names: found as shared, and lib has no job for it.
const shared = e.sharedNotInLib.find((s) => s.kits.includes("watch") && s.kits.includes("clacks"));
assert.ok(shared, JSON.stringify(e.sharedNotInLib));
assert.ok(shared.similarity >= 0.8, `similarity ${shared.similarity}`);
assert.ok(shared.units.some((u) => /postOf/.test(u)) && shared.units.some((u) => /whereIs/.test(u)));
assert.equal(e.byKit.quiet, undefined, "a kit that repeats nothing has no row");

fs.rmSync(tmp, { recursive: true, force: true });
console.log("ok");
