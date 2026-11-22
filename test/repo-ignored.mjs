// repo.rg and repo.files skip what git ignores, except when `path` points into it: that reaches a
// dependency's source under node_modules. No network, no model.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeRepo } from "../domains/code/repo.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "ask-kit-ignored-"));
execFileSync("git", ["init", "-q"], { cwd: root });
fs.writeFileSync(path.join(root, ".gitignore"), "node_modules\n");
fs.mkdirSync(path.join(root, "node_modules", "clacks"), { recursive: true });
fs.writeFileSync(path.join(root, "node_modules", "clacks", "index.js"), "export const overhead = 'GNU Terry Pratchett';\n");
fs.writeFileSync(path.join(root, "watch.js"), "import { overhead } from 'clacks';\n");

const repo = makeRepo({ root, push() {} });
const plain = await repo.rg("overhead");
assert.deepEqual(plain.map((h) => h.file), ["watch.js"]);
const deep = await repo.rg("overhead", { path: "node_modules/clacks" });
assert.deepEqual(deep.map((h) => h.file), ["node_modules/clacks/index.js"]);
assert.deepEqual([...(await repo.files("*.js"))], ["watch.js"]);
assert.deepEqual([...(await repo.files("*.js", { path: "node_modules" }))], ["node_modules/clacks/index.js"]);

fs.rmSync(root, { recursive: true, force: true });
console.log("ok");
