// ask-kit kit update: fast-forwards clean checkouts, leaves the rest alone and names them. Local git only.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ask-kit-update-")));
process.env.ASK_KIT_CONFIG = path.join(tmp, "config");
process.env.ASK_KIT_STATE = path.join(tmp, "state");
const git = (cwd, ...a) => execFileSync("git", ["-c", "user.name=Sam Vimes", "-c", "user.email=vimes@example.com", "-c", "commit.gpgsign=false", ...a], { cwd, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
const toml = (n, v) => `name = "${n}"\nversion = "${v}"\nsays = "x"\n[[sources]]\nkind = "folder"\nname = "f"\npath = "."\n`;
const up = path.join(tmp, "up"), kits = path.join(tmp, "config", "kits");
fs.mkdirSync(kits, { recursive: true });
for (const n of ["watch", "guild", "clacks", "dirty"]) {
  const u = path.join(up, n);
  fs.mkdirSync(u, { recursive: true });
  git(u, "init", "-q", "-b", "main");
  fs.writeFileSync(path.join(u, "ask-kit.toml"), toml(n, "0.1.0"));
  git(u, "add", ".");
  git(u, "commit", "-qm", "one");
  git(kits, "clone", "-q", u, n);
}
fs.mkdirSync(path.join(kits, "plain"));
fs.writeFileSync(path.join(kits, "plain", "ask-kit.toml"), toml("plain", "0.1.0"));
for (const n of ["watch", "guild", "dirty"]) {
  fs.writeFileSync(path.join(up, n, "ask-kit.toml"), toml(n, "0.2.0"));
  git(path.join(up, n), "commit", "-qam", "two");
}
fs.writeFileSync(path.join(kits, "guild", "own.md"), "x");
git(path.join(kits, "guild"), "add", ".");
git(path.join(kits, "guild"), "commit", "-qm", "own");
fs.appendFileSync(path.join(kits, "dirty", "ask-kit.toml"), "# mine\n");
const { updateKits } = await import("../src/update.mjs");
const got = Object.fromEntries((await updateKits()).map((r) => [r.kit, r]));
assert.deepEqual([got.watch.state, got.watch.from, got.watch.version], ["updated", "0.1.0", "0.2.0"]);
assert.deepEqual([got.guild.state, got.clacks.state, got.dirty.state, got.plain.state], ["diverged", "current", "has changes", "not a checkout"]);
assert.match(fs.readFileSync(path.join(kits, "dirty", "ask-kit.toml"), "utf8"), /# mine/);
fs.rmSync(tmp, { recursive: true, force: true });
console.log("ok");
