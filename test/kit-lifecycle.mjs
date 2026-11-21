// Installing, updating and removing kits with no restart: a pack installs with --only, a running
// router picks up a kit installed after it started (and tells the client its tool list changed),
// `kit update` shows the files and the consent fields that changed, `kit remove` unlinks a linked
// kit and leaves its folder, deletes a copied one, refuses a built-in one, and --purge deletes the
// kit's state. Kits get ${CALLER_DIR} and ${STATE_DIR}. No model, no network.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { parseRef } from "../src/gallery.mjs";

// A failed assertion must not leave the test waiting on the router it started.
process.on("uncaughtException", (e) => {
  console.error(e);
  process.exit(1);
});
process.on("unhandledRejection", (e) => {
  console.error(e);
  process.exit(1);
});

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(ROOT, "bin", "ask-kit.mjs");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ask-kit-lifecycle-"));
const config = path.join(tmp, "config");
const state = path.join(tmp, "state");
const caller = path.join(tmp, "pseudopolis-yard");
fs.mkdirSync(caller, { recursive: true });
fs.mkdirSync(config, { recursive: true });
fs.writeFileSync(path.join(config, "config.json"), JSON.stringify({ version: 1, sources: [], backends: { default: "none", list: { none: { kind: "api", preset: "custom", baseUrl: "http://127.0.0.1:9/v1", model: "none", noKey: true } } }, domains: {} }));
const env = { ...process.env, ASK_KIT_CONFIG: config, ASK_KIT_STATE: state, ASK_KIT_SESSION: "lifecycle-test" };
delete env.ASK_KIT_DOMAIN;
delete env.ASK_KIT_CALLER_DIR;
const cli = (...args) => JSON.parse(execFileSync(process.execPath, [CLI, ...args], { env, cwd: caller, encoding: "utf8" }));
const cliFails = (...args) => {
  try {
    execFileSync(process.execPath, [CLI, ...args], { env, cwd: caller, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    return String(e.stderr);
  }
  throw new Error(`expected ${args.join(" ")} to fail`);
};
const readConfig = () => JSON.parse(fs.readFileSync(path.join(config, "config.json"), "utf8"));

// A pack: two kits in kits/<name>/. "watch" is the shot fixture; "clacks" has a script that reports
// the built-in settings it was given.
const pack = path.join(tmp, "pack");
fs.cpSync(path.join(ROOT, "test", "fixtures", "shot-kit"), path.join(pack, "kits", "watch"), { recursive: true });
const clacks = path.join(pack, "kits", "clacks");
fs.mkdirSync(path.join(clacks, "scripts"), { recursive: true });
fs.writeFileSync(
  path.join(clacks, "ask-kit.toml"),
  'name = "clacks"\nversion = "0.1.0"\nsays = "the clacks towers between Ankh-Morpork and Genua"\npatterns = [\'^which clacks tower\']\n\n[[settings]]\nkey = "TOWERS"\nabout = "the folder of tower logs"\ndefault = "${CALLER_DIR}/towers"\n\n[[sources]]\nkind = "module"\nname = "clacks"\nmodule = "clacks.mjs"\n',
);
fs.writeFileSync(path.join(clacks, "clacks.mjs"), "export function make(ctx) { return { where: () => ({ callerDir: ctx.callerDir, stateDir: ctx.stateDir, towers: ctx.settings.TOWERS }) }; }\n");
fs.writeFileSync(path.join(clacks, "scripts", "where.mjs"), 'export const meta = { purpose: "where", params: {}, returns: "dirs" };\nexport default async function ({ clacks }) { return clacks.where(); }\n');
// The watch kit's bench has a question clacks's pattern takes: the install preview must say so.
fs.mkdirSync(path.join(pack, "kits", "watch", "bench"), { recursive: true });
fs.writeFileSync(path.join(pack, "kits", "watch", "bench", "questions.json"), JSON.stringify({ questions: [{ id: "t", q: "which clacks tower is down?", expect: ["tower"] }] }));

// parseRef: a folder in a repository, a tree link with its branch, a pinned ref, and no "..".
assert.deepEqual(parseRef("ankh-morpork/watch/kits/clacks"), { owner: "ankh-morpork", repo: "watch", url: "https://github.com/ankh-morpork/watch", name: "clacks", subdir: "kits/clacks" });
assert.equal(parseRef("https://github.com/ankh-morpork/watch/tree/nights/kits/clacks").ref, "nights");
assert.equal(parseRef("ankh-morpork/watch", { ref: "v1.2.0" }).ref, "v1.2.0");
assert.throws(() => parseRef("ankh-morpork/watch/../secrets"), /cannot hold/);

// Install watch only. The preview lists both kits and says nothing is installed.
const preview = cli("kit", "install", pack);
assert.deepEqual(preview.kits.map((k) => k.name).sort(), ["clacks", "watch"]);
assert.equal(preview.installed.length, 0);
assert.match(preview.next, /--only/);
assert.match(cliFails("kit", "install", pack, "--only", "nobby", "--yes"), /has no kit nobby; it has: (watch, clacks|clacks, watch)/);
const one = cli("kit", "install", pack, "--only", "watch", "--yes");
assert.deepEqual(one.installed.map((k) => k.name), ["watch"]);
assert.equal(readConfig().domains.watch.from, path.join(pack, "kits", "watch"), "the source is recorded for kit update");
assert.ok(!fs.existsSync(path.join(config, "kits", "clacks")));

// A router started now, with watch only.
const client = new Client({ name: "lifecycle", version: "0" });
let listChanged = 0;
client.setNotificationHandler(ToolListChangedNotificationSchema, () => void listChanged++);
await client.connect(new StdioClientTransport({ command: process.execPath, args: [CLI, "serve"], env, cwd: caller, stderr: "inherit" }));
const descOf = async () => (await client.listTools()).tools.find((t) => t.name === "ask").description;
assert.doesNotMatch(await descOf(), /clacks/);
const text = (r) => r.content.map((c) => c.text).join("\n");
const duty = await client.callTool({ name: "ask", arguments: { do: "watch.duty", params: { post: "Cable Street" } } });
assert.ok(!duty.isError, text(duty));

// Installing clacks while the router runs: the preview says which of watch's questions it would take.
const preview2 = cli("kit", "install", pack, "--only", "clacks");
assert.deepEqual(preview2.claims, [{ kit: "clacks", from: "watch", question: "which clacks tower is down?", by: "pattern" }]);
cli("kit", "install", pack, "--only", "clacks", "--yes");
// The next ask sees it: no restart, and the client hears that the tool changed.
const where = await client.callTool({ name: "ask", arguments: { do: "clacks.where" } });
assert.ok(!where.isError, text(where));
const dirs = JSON.parse(text(where).replace(/\n\[[^\]]*\]\s*$/, ""));
assert.equal(fs.realpathSync(dirs.callerDir), fs.realpathSync(caller), "CALLER_DIR is the folder the agent runs in, inside the REPL too");
assert.equal(dirs.towers, path.join(dirs.callerDir, "towers"), "${CALLER_DIR} fills a setting");
assert.equal(dirs.stateDir, path.join(state, "kit-data", "clacks"), "stateDir is the kit's own data folder");
assert.match(await descOf(), /clacks \(the clacks towers/);
assert.ok(listChanged >= 1, "the client was told the tool list changed");
// `about` takes the new kit's name though the client's copy of the schema predates it.
const about = await client.callTool({ name: "ask", arguments: { do: "where", about: "clacks" } });
assert.ok(!about.isError, text(about));

// The preview is short: what a kit reaches, changes and needs, whether it can run here, what to read.
const short = cli("kit", "install", pack, "--only", "clacks").kits[0];
assert.equal(short.runsHere, "yes");
assert.deepEqual(short.reaches, ["module clacks: clacks.mjs"]);
assert.ok(short.readFirst[0].endsWith(path.join("clacks", "clacks.mjs")));
assert.equal(short.modules, undefined, "module source only with --full");
assert.ok(cli("kit", "install", pack, "--only", "clacks", "--full").kits[0].modules["clacks.mjs"].includes("export function make"));

// A different kit under a name already taken is refused; the same kit under another name is a copy.
const other = path.join(tmp, "other-clacks");
fs.mkdirSync(other, { recursive: true });
fs.writeFileSync(path.join(other, "ask-kit.toml"), 'id = "uu.clacks"\nname = "clacks"\nsays = "the University\'s own clacks"\n\n[[sources]]\nkind = "folder"\nname = "uu"\npath = "."\n');
fs.writeFileSync(path.join(pack, "kits", "clacks", "ask-kit.toml"), 'id = "watch.clacks"\n' + fs.readFileSync(path.join(pack, "kits", "clacks", "ask-kit.toml"), "utf8"));
cli("kit", "install", pack, "--only", "clacks", "--yes");
assert.match(cli("kit", "install", other).kits[0].clash, /a different kit \(watch\.clacks/);
assert.match(cliFails("kit", "install", other, "--yes"), /not installed: clacks: a different kit/);
cli("kit", "install", pack, "--only", "clacks", "--as", "semaphore", "--yes");
assert.equal(readConfig().domains.semaphore.copyOf, "clacks");
assert.match(fs.readFileSync(path.join(config, "kits", "semaphore", "ask-kit.toml"), "utf8"), /^name = "semaphore"$/m);

// kit set: each copy has its own settings; the router sees them on the next ask.
assert.match(cliFails("kit", "set", "semaphore", "NOBBY=1"), /has no setting NOBBY; its settings: TOWERS/);
execFileSync(process.execPath, [CLI, "kit", "set", "semaphore", "TOWERS=/genua/towers"], { env, cwd: caller });
const shown = JSON.parse(execFileSync(process.execPath, [CLI, "kit", "set", "semaphore", "--json"], { env, cwd: caller, encoding: "utf8" }));
assert.deepEqual(shown.map((r) => [r.key, r.value, r.from]), [["TOWERS", "/genua/towers", "the config"]]);
const sem = JSON.parse(text(await client.callTool({ name: "ask", arguments: { do: "semaphore.where" } })).replace(/\n\[[^\]]*\]\s*$/, ""));
const cl = JSON.parse(text(await client.callTool({ name: "ask", arguments: { do: "clacks.where" } })).replace(/\n\[[^\]]*\]\s*$/, ""));
assert.equal(sem.towers, "/genua/towers");
assert.equal(cl.towers, path.join(cl.callerDir, "towers"), "the original keeps its own");
assert.equal(sem.stateDir, path.join(state, "kit-data", "semaphore"), "and its own data folder");
// Updating the copy fetches it by its original name and keeps its name; unchanged, it is up to date.
assert.equal(cli("kit", "update", "semaphore").kits[0].upToDate, true);
execFileSync(process.execPath, [CLI, "kit", "set", "semaphore", "--unset", "TOWERS"], { env, cwd: caller });
assert.equal(readConfig().domains.semaphore.settings.TOWERS, undefined);

// Update: the source changes a script and adds an act; the preview names both, --yes applies them.
fs.writeFileSync(path.join(pack, "kits", "watch", "scripts", "duty.mjs"), fs.readFileSync(path.join(pack, "kits", "watch", "scripts", "duty.mjs"), "utf8") + "\n// a new line\n");
// (at the top: a key after [[sources]] would belong to that table)
const watchToml = path.join(pack, "kits", "watch", "ask-kit.toml");
fs.writeFileSync(watchToml, fs.readFileSync(watchToml, "utf8").replace(/^says = .*$/m, (l) => `${l}\nacts = ["watch.dismiss"]`));
const up = cli("kit", "update", "watch");
const row = up.kits[0];
assert.equal(row.upToDate, false);
assert.deepEqual(row.changed.sort(), ["ask-kit.toml", "scripts/duty.mjs"]);
assert.deepEqual(row.consent, { acts: { added: ["watch.dismiss"] } });
assert.ok(!fs.readFileSync(path.join(config, "kits", "watch", "scripts", "duty.mjs"), "utf8").includes("a new line"), "a preview changes nothing");
assert.equal(cli("kit", "update", "watch", "--yes").kits[0].updated, true);
assert.ok(fs.readFileSync(path.join(config, "kits", "watch", "scripts", "duty.mjs"), "utf8").includes("a new line"));
assert.equal(cli("kit", "update", "watch").kits[0].upToDate, true);

// Remove watch: the preview deletes nothing; --yes deletes the copy and the config entry.
const rmPreview = cli("kit", "remove", "watch");
assert.equal(rmPreview.removed, false);
assert.equal(rmPreview.delete, path.join(config, "kits", "watch"));
assert.ok(rmPreview.keepsState.some((p) => p.endsWith(path.join("state", "watch"))), "journals are kept without --purge");
assert.ok(fs.existsSync(path.join(config, "kits", "watch")));
assert.equal(cli("kit", "remove", "watch", "--purge", "--yes").removed, true);
assert.ok(!fs.existsSync(path.join(config, "kits", "watch")));
assert.ok(!fs.existsSync(path.join(state, "watch")), "--purge deletes its journals");
assert.equal(readConfig().domains.watch, undefined);
// The router stops offering it on the next ask.
const gone = await client.callTool({ name: "ask", arguments: { do: "watch.duty" } });
assert.ok(gone.isError);
assert.match(text(gone), /no single kit|not a kit that can run here/);
assert.doesNotMatch(await descOf(), /watch \(the Night Watch/);
await client.close();

// A linked kit is unlinked and its folder left alone; a built-in cannot be removed.
const linked = path.join(tmp, "linked-clacks");
fs.cpSync(clacks, linked, { recursive: true });
cli("kit", "remove", "clacks", "--yes");
cli("kit", "link", linked);
assert.ok(fs.lstatSync(path.join(config, "kits", "clacks")).isSymbolicLink());
const unlink = cli("kit", "remove", "clacks", "--yes");
assert.equal(unlink.unlink, path.join(config, "kits", "clacks"));
assert.ok(!fs.existsSync(path.join(config, "kits", "clacks")));
assert.ok(fs.existsSync(path.join(linked, "ask-kit.toml")), "the linked folder itself is kept");
assert.match(cliFails("kit", "remove", "code", "--yes"), /built into ask-kit/);
assert.match(cliFails("kit", "remove", "nobby", "--yes"), /no installed kit nobby/);
assert.match(cli("kit", "update", "nobby").kits[0].skipped, /not an installed kit/);

fs.rmSync(tmp, { recursive: true, force: true });
console.log("ok");
process.exit(0);
