// Warm-ups (src/warm.mjs): a kit's [warm] in ask-kit.toml is checked and its prime used; the
// enabled domains and kits that declare a warm-up script are listed; `ask-kit warm` runs them with
// no model and builds the code map; the plugin's async SessionStart hook runs them detached and
// prints one line of hook JSON naming what is ready, and nothing when there is nothing to warm.
// No model, no network.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ask-kit-warm-")));
const CONFIG = path.join(tmp, "config");
const STATE = path.join(tmp, "state");
process.env.ASK_KIT_CONFIG = CONFIG;
process.env.ASK_KIT_STATE = STATE;

const repo = path.join(tmp, "pseudopolis-yard");
fs.mkdirSync(path.join(repo, "src"), { recursive: true });
fs.writeFileSync(path.join(repo, "src", "yard.mjs"), "export function muster(watch) {\n  return watch.length;\n}\nmuster([]);\n");
const git = (...args) => execFileSync("git", ["-c", "user.email=vimes@example.com", "-c", "user.name=Sam Vimes", "-c", "commit.gpgsign=false", ...args], { cwd: repo, stdio: ["ignore", "pipe", "pipe"] });
git("init", "-q");
git("add", "-A");
git("commit", "-qm", "Pseudopolis Yard");

const kit = (name, manifest, scripts = {}) => {
  const dir = path.join(CONFIG, "kits", name);
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(dir, "ask-kit.toml"), manifest);
  for (const [f, t] of Object.entries(scripts)) fs.writeFileSync(path.join(dir, "scripts", f), t);
  return dir;
};
const marker = path.join(tmp, "rota-ran.json");
kit(
  "rota",
  `name = "rota"\nsays = "the Watch's duty rota"\n[[sources]]\nkind = "folder"\nname = "rota"\npath = "${repo}"\n[warm]\nscript = "build-rota"\nparams = { marker = "${marker}" }\nnotice = "the rota is read"\nprime = "Read the rota, then reply: ready"\n`,
  {
    "build-rota.mjs":
      'import fs from "node:fs";\nexport const meta = { purpose: "read the rota ahead of the first question" };\n' +
      "export default async function ({ rota }, { marker }) {\n  fs.writeFileSync(marker, JSON.stringify({ files: (await rota.files()).length }));\n  return { files: 1 };\n}\n",
  },
);
kit("bells", `name = "bells"\nsays = "the bells"\n[[sources]]\nkind = "folder"\nname = "bells"\npath = "${repo}"\n[warm]\nprime = "Ring once, then reply: ready"\n`);
const off = kit("off-duty", `name = "off-duty"\nsays = "nobody"\n[[sources]]\nkind = "folder"\nname = "off"\npath = "${repo}"\n[warm]\nscript = "nap"\n`);
const config = { version: 1, sources: [], backends: { default: "x", list: { x: { kind: "api", preset: "ollama", model: "none" } } }, domains: { code: { enabled: true }, rota: {}, bells: {}, "off-duty": { enabled: false } } };
fs.mkdirSync(CONFIG, { recursive: true });
fs.writeFileSync(path.join(CONFIG, "config.json"), JSON.stringify(config));

const { readManifest, kitDomain } = await import("../src/kits.mjs");
const { warmups } = await import("../src/warm.mjs");

try {
  // [warm] is checked when the manifest loads.
  assert.equal(readManifest(off).warm.script, "nap");
  const bad = kit("bad", `name = "bad"\nsays = "x"\n[[sources]]\nkind = "folder"\nname = "bad"\npath = "${repo}"\n[warm]\nscript = "../escape"\nnotice = 3\n`);
  assert.throws(() => readManifest(bad), /warm\.script: the name of one of the kit's scripts[\s\S]*warm\.notice: text/);
  fs.writeFileSync(path.join(bad, "ask-kit.toml"), `name = "bad"\nsays = "x"\nwarm = "yes"\n[[sources]]\nkind = "folder"\nname = "bad"\npath = "${repo}"\n`);
  assert.throws(() => readManifest(bad), /\[warm\]: a table/);
  fs.rmSync(bad, { recursive: true });

  // A kit's prime comes from [warm] when it sets one; otherwise the generated one stays.
  assert.equal((await kitDomain(path.join(CONFIG, "kits", "bells"), { config })).prime, "Ring once, then reply: ready");
  assert.match((await kitDomain(off, { config })).prime, /^Get ready to answer questions about nobody/);

  // The warm-ups: the code domain's (the map) and each enabled kit's script; not a disabled kit, not a prime alone.
  assert.deepEqual(
    (await warmups(config)).map((w) => `${w.name}.${w.script}`),
    ["code.map", "rota.build-rota"],
  );

  const env = { ...process.env, ASK_KIT_CONFIG: CONFIG, ASK_KIT_STATE: STATE, ASK_KIT_SESSION: "caller-session" };
  const cli = (args, input) => spawnSync(process.execPath, [path.join(ROOT, "bin", "ask-kit.mjs"), ...args], { cwd: tmp, env, input, encoding: "utf8", timeout: 60_000 });

  // `ask-kit warm` in the foreground: both run with no model; the code map is built under the state folder.
  const run = cli(["warm", path.join(repo, "src"), "--json"]);
  assert.equal(run.status, 0, run.stderr);
  const results = JSON.parse(run.stdout);
  assert.deepEqual(results.map((r) => [r.name, r.ok]), [["code", true], ["rota", true]]);
  assert.match(results[0].notice, /^the code map of pseudopolis-yard is ready \(1 files\): `ask` with about: "code" answers/);
  assert.equal(results[1].notice, "the rota is read");
  assert.deepEqual(JSON.parse(fs.readFileSync(marker, "utf8")), { files: 1 });
  assert.ok(fs.readdirSync(path.join(STATE, "code-map")).some((f) => /^[0-9a-f]{40}\.json\.gz$/.test(f)));
  assert.ok(fs.existsSync(path.join(STATE, "warmups", `code-${repo.replace(/^\/+/, "").replace(/[^A-Za-z0-9._-]+/g, "-")}.json`)));

  // The plugin's hook: one line of hook JSON on stdout, the notices joined, and nothing else.
  fs.rmSync(marker);
  const hook = cli(["plugin", "warm"], JSON.stringify({ session_id: "s-1", hook_event_name: "SessionStart", source: "startup", cwd: path.join(repo, "src") }));
  assert.equal(hook.status, 0, hook.stderr);
  const lines = hook.stdout.split("\n").filter(Boolean);
  assert.equal(lines.length, 1);
  const out = JSON.parse(lines[0]);
  assert.equal(out.hookSpecificOutput.hookEventName, "SessionStart");
  assert.match(out.hookSpecificOutput.additionalContext, /^ask-kit: the code map of pseudopolis-yard is ready \(1 files\)[^;]*; the rota is read\.$/);
  assert.ok(fs.existsSync(marker), "the kit's warm-up ran again for the new session");
  assert.deepEqual(fs.readdirSync(path.join(STATE, "warmups")).filter((f) => f.startsWith("run-")), [], "the hook's result file is removed");

  // Nothing to say: a folder outside git, or ask-kit not set up.
  const loose = fs.mkdtempSync(path.join(tmp, "loose-"));
  assert.equal(cli(["plugin", "warm"], JSON.stringify({ cwd: loose })).stdout, "");
  fs.renameSync(path.join(CONFIG, "config.json"), path.join(CONFIG, "config.off"));
  assert.equal(cli(["plugin", "warm"], JSON.stringify({ cwd: repo })).stdout, "");

  // The plugin runs the hook in the background, so a session never waits for it.
  const plugin = JSON.parse(fs.readFileSync(path.join(ROOT, ".claude-plugin", "plugin.json"), "utf8"));
  const warm = plugin.hooks.SessionStart.flatMap((e) => e.hooks).find((h) => h.args?.includes("warm"));
  assert.deepEqual(warm.args.slice(-2), ["plugin", "warm"]);
  assert.equal(warm.async, true);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log("ok");
