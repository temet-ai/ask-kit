import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ask-domain-tuning-"));
process.env.ASK_KIT_CONFIG = path.join(tmp, "config");
process.env.ASK_KIT_STATE = path.join(tmp, "state");
const { makeRepo } = await import("../domains/code/repo.mjs");
const { default: overview } = await import("../domains/code/scripts/overview.mjs");
const { default: digest } = await import("../domains/sessions/scripts/session-digest.mjs");

try {
  const folder = path.join(tmp, "watch");
  fs.mkdirSync(path.join(folder, "src"), { recursive: true });
  fs.mkdirSync(path.join(folder, "node_modules", "lantern"), { recursive: true });
  fs.writeFileSync(path.join(folder, "README.md"), "# The Watch\n");
  fs.writeFileSync(path.join(folder, "src", "lantern.mjs"), "export const lantern = 'brass';\n");
  fs.writeFileSync(path.join(folder, "node_modules", "lantern", "package.json"), "{}");
  const repo = makeRepo({ root: folder, push() {} });
  const listed = await repo.files(["**/*.mjs", "!**/node_modules/**"]);
  assert.deepEqual([...listed], ["src/lantern.mjs"]);
  const plain = await overview({ repo }, {});
  assert.equal(plain.files, 2);
  assert.equal(plain.complete, true);
  assert.equal(plain.docs[0].file, "README.md");
  assert.deepEqual(plain.recent, []);
  assert.match(plain.recentError, /not a git repository/);
  assert.deepEqual(plain.manifests, []);

  const git = (...args) => execFileSync("git", args, { cwd: folder, stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-b", "main");
  git("-c", "user.name=Sam Vimes", "-c", "user.email=vimes@example.com", "commit", "--allow-empty", "-m", "Start the watch");
  const tracked = await overview({ repo }, {});
  assert.match(tracked.recent[0], /Start the watch/);
  assert.equal(tracked.recentError, undefined);

  const session = { source: "codex", id: "watch-session", project: "watch", title: "Lanterns" };
  const replies = Array.from({ length: 45 }, (_, i) => ({ i, role: "assistant", text: `Lantern ${i}` }));
  const history = { events: async () => Object.assign([...replies], { total: replies.length, session }) };
  const long = await digest({ history }, { session: session.id });
  assert.equal(long.events, 45);
  assert.equal(long.repliesSkipped, 15);
  assert.equal(long.replies.length, 30);
  assert.ok(long.replies.every((r) => typeof r.text === "string"));
  assert.equal(long.replies[0].text, "Lantern 0");
  assert.equal(long.replies.at(-1).text, "Lantern 44");
  assert.doesNotThrow(() => long.replies.map((r) => r.text.slice(0, 8)));
  const short = await digest({ history: { events: async () => Object.assign(replies.slice(0, 3), { total: 3, session }) } }, { session: session.id });
  assert.equal(short.replies.length, 3);
  assert.equal(short.repliesSkipped, undefined);
  console.log("ok");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
