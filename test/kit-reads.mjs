// A kit's `reads`: the commands it declares as reading what it answers about. The manifest check,
// the classifier gaps and the nudge share (a declared read is a lookup, named for its kit; the
// same command in any kit's `acts` stays an action) and the chains gaps builds from them.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ask-kit-reads-")));
process.env.ASK_KIT_CONFIG = path.join(tmp, "config");
process.env.ASK_KIT_STATE = path.join(tmp, "state");

const kit = (name, body) => {
  const d = path.join(tmp, "config", "kits", name);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, "m.mjs"), "export default () => ({});\n");
  fs.writeFileSync(path.join(d, "ask-kit.toml"), `name = "${name}"\nsays = "${name} of the Watch"\n${body}\n[[sources]]\nkind = "module"\nname = "m"\nmodule = "m.mjs"\n`);
  return d;
};
const { readManifest } = await import("../src/kits.mjs");
const { buildChains, classify, kitRules, lookupsOf, targetOf } = await import("../src/gaps.mjs");

// The manifest check: a list of commands, each a program and its words.
assert.deepEqual(readManifest(kit("rota", 'reads = ["rota show", "rota list --all", "clacks"]\nacts = ["rota swap"]')).reads, ["rota show", "rota list --all", "clacks"]);
for (const [body, why] of [
  ['reads = "rota show"', /reads: a list of the commands/],
  ['reads = ["rota show; rm -rf /"]', /reads\[0\]: a command as the program and its words/],
  ["reads = [3]", /reads\[0\]: a command/],
  ['reads = ["node"]', /reads\[0\]: node runs other programs; name what it runs/],
  ['reads = ["rota swap"]\nacts = ["rota swap"]', /reads\[0\]: rota swap is in acts too/],
])
  assert.throws(() => readManifest(kit("bad", body)), why, body);
fs.rmSync(path.join(tmp, "config", "kits", "bad"), { recursive: true });

// Without a declaration an unknown program is an action; with one it is a lookup named for the kit.
kit("fleet", 'reads = ["mike fleet status", "mike fleet list"]\nacts = ["mike fleet start x"]');
kit("tower", 'reads = ["semaphore"]\nacts = ["semaphore send"]');
kit("kube", 'reads = ["kubectl get"]');
const config = { version: 1, domains: { code: {}, fleet: {}, tower: {}, kube: {}, rota: {} } };
fs.writeFileSync(path.join(tmp, "config", "config.json"), JSON.stringify(config));
const rules = kitRules(config);
const { declared } = rules;
assert.deepEqual(declared.reads.map((r) => `${r.kit}: ${r.phrase}`).sort(), ["fleet: mike fleet list", "fleet: mike fleet status", "kube: kubectl get", "rota: clacks", "rota: rota list --all", "rota: rota show", "tower: semaphore"]);
assert.ok(declared.acts.some((a) => a.words.join(" ") === "semaphore send"));
assert.ok(!declared.acts.some((a) => a.words.length < 2), "a one-word acts entry is a function's name, not a command");

const k = (arg, d = declared) => classify("Bash", arg, d).k;
assert.equal(k("mike fleet status watch", null), "act", "no declaration: an action, as before");
for (const arg of ["mike fleet status watch", "mike fleet status watch | head -20", "mike fleet list", "kubectl -n watch get pods", "semaphore towers --from ankh", "bash -c 'mike fleet status watch'", "rota show night"])
  assert.equal(k(arg), "look", arg);
for (const arg of ["mike fleet start watch", "mike fleet status watch > /srv/watch/out.txt", "semaphore send 'GNU Terry Pratchett'", "kubectl delete pod x", "rota swap Vimes Carrot", "mike fleet status watch && git push"])
  assert.equal(k(arg), "act", arg);
// What the rules here already count is unchanged by a declaration.
assert.equal(classify("Bash", "git log -3", declared).k, "look");

const looks = lookupsOf("Bash", "rg Vimes src; mike fleet status watch; kubectl get pods -A", declared);
assert.deepEqual(looks.map((l) => [l.fam, l.kit ?? null, l.read ?? null]), [["file", null, null], ["kit", "fleet", "mike fleet status"], ["kit", "kube", "kubectl get"]]);

// A disabled kit's reads are not loaded.
assert.ok(!kitRules({ version: 1, domains: { code: {}, fleet: { enabled: false } } }).declared.reads.some((r) => r.kit === "fleet"));

// gaps: a chain of declared reads is a chain, put down to the kit, with the phrase as its shape.
const use = (arg) => ({ turn: 0, prompt: "How is the watch fleet doing?", ts: "2026-11-18T00:00:00Z", tool: "Bash", arg, req: arg, chars: 300 });
const calls = [use("mike fleet status watch"), use("mike fleet list"), use("mike fleet status watch --json")];
assert.equal(buildChains(calls).chains.length, 0, "without the declarations each call is an action");
const [chain] = buildChains(calls, { declared }).chains;
assert.deepEqual(chain.uses.map((u) => u.shape), ["mike fleet status", "mike fleet list", "mike fleet status"]);
assert.deepEqual(chain.uses.map((u) => targetOf(u, rules, null)), ["fleet", "fleet", "fleet"]);

fs.rmSync(tmp, { recursive: true, force: true });
console.log("ok");
process.exit(0);
