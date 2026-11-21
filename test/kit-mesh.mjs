// ask-kit kit mesh with fixture kits and no model: a new kit that runs the same commands as an
// installed one is an overlap put to the person; a pattern that takes an installed kit's bench
// question, and an installed action that takes one of the new kit's, are both named; its own
// redaction is code lib already has; a required setting and a missing `replaces` are readiness
// steps. Nothing is changed by meshing.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(ROOT, "bin", "ask-kit.mjs");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ask-kit-mesh-"));
const config = path.join(tmp, "config");
const env = { ...process.env, ASK_KIT_CONFIG: config, ASK_KIT_STATE: path.join(tmp, "state") };
const write = (dir, files) => {
  for (const [f, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), text);
  }
};

// Installed: "night-watch" runs lsof for ports, and has an action for "who is on duty at <post>".
write(path.join(config, "kits", "night-watch"), {
  "ask-kit.toml": `name = "night-watch"\nsays = "the Night Watch: who is on duty, which post, the watch house's ports"\nreplaces = ["lsof"]\nroute_hint = "duty and posts are night-watch"\n\n[[actions]]\nname = "duty"\ntitle = "Who is on duty"\nscript = "duty"\nmatch = ['who is on duty at (?<post>[\\w ]+)']\n\n[[sources]]\nkind = "module"\nname = "nw"\nmodule = "nw.mjs"\n`,
  "nw.mjs": "export function make() { return {}; }\n",
  "scripts/duty.mjs": 'export const meta = { purpose: "duty" };\nexport default async function () { return {}; }\n',
  "bench/questions.json": JSON.stringify({ questions: [{ id: "p", q: "what holds port 8080 at Pseudopolis Yard?", expect: ["8080"] }] }),
});
fs.writeFileSync(path.join(config, "config.json"), JSON.stringify({ version: 1, sources: [], backends: { default: "x", list: { x: { kind: "api", preset: "custom", baseUrl: "http://127.0.0.1:9/v1", model: "x", noKey: true } } }, domains: { "night-watch": { enabled: true } } }));

// New, not installed: "ports" runs lsof itself, claims "what holds port N", carries its own redaction.
const ports = path.join(tmp, "src", "ports");
write(ports, {
  "ask-kit.toml": `name = "ports"\nsays = "which process holds a port on this machine"\npatterns = ['what holds port \\d+']\n\n[[settings]]\nkey = "PORT_RANGE"\nabout = "the ports to watch"\nrequired = true\n\n[[sources]]\nkind = "module"\nname = "ports"\nmodule = "ports.mjs"\n`,
  "ports.mjs": `import { execFile } from "node:child_process";
const scrub = (text) =>
  String(text)
    .replace(/(password|token|secret|api_key)=\\S+/gi, "$1=<redacted>")
    .replace(/(Authorization:\\s*Bearer\\s+)\\S+/gi, "$1<redacted>")
    .replace(/(:\\/\\/[^:@\\s]+:)[^@\\s]+@/g, "$1<redacted>@");
export function make() {
  return { holders: () => new Promise((r) => execFile("lsof", ["-nP", "-iTCP"], { timeout: 5000 }, (e, out) => r(scrub(out ?? "")))) };
}
`,
  "bench/questions.json": JSON.stringify({ questions: [{ id: "d", q: "who is on duty at Cable Street", expect: ["Angua"] }] }),
});

const before = fs.readFileSync(path.join(config, "config.json"), "utf8");
const r = JSON.parse(execFileSync(process.execPath, [CLI, "kit", "mesh", ports, "--json"], { env, encoding: "utf8" }));
assert.equal(r.kit, "ports");
assert.equal(r.installed, false);
assert.deepEqual(r.against, ["night-watch"]);
// Code: its own redaction is lib's job.
assert.deepEqual(r.code.repeatsLib.map((u) => u.job), ["redact"]);
// Routing: its pattern takes night-watch's port question; night-watch's action takes its duty question.
assert.deepEqual(r.routing.takes, [{ from: "night-watch", question: "what holds port 8080 at Pseudopolis Yard?", by: "pattern" }]);
assert.deepEqual(r.routing.lost, [{ to: "night-watch", question: "who is on duty at Cable Street", by: "action" }]);
// Overlap: both answer for lsof; neither route_hint names the other.
assert.deepEqual(r.overlaps.map((o) => [o.kit, o.commands]), [["night-watch", ["lsof"]]]);
const who = (re) => r.steps.filter((s) => re.test(s.what)).map((s) => s.who);
assert.deepEqual(who(/both answer for lsof/), ["ask"]);
assert.deepEqual(who(/night-watch's route_hint should name/), ["author"]);
assert.deepEqual(who(/kit set ports PORT_RANGE/), ["ask"]);
assert.deepEqual(who(/add replaces/), ["author"]);
assert.deepEqual(r.readiness.missingSettings, [{ key: "PORT_RANGE", about: "the ports to watch" }]);
assert.equal(fs.readFileSync(path.join(config, "config.json"), "utf8"), before, "meshing changes nothing");
assert.ok(!fs.existsSync(path.join(config, "kits", "ports")));
// The text form names the joints and the steps.
const text = execFileSync(process.execPath, [CLI, "kit", "mesh", ports], { env, encoding: "utf8" });
assert.match(text, /^Overlaps\n  night-watch: commands lsof$/m);
assert.match(text, /\[ask\] ports and night-watch both answer for lsof/);

fs.rmSync(tmp, { recursive: true, force: true });
console.log("ok");
