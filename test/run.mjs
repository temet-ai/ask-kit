// Runs every test/*.mjs, one after another, and stops at the first that fails. A new test file is
// picked up by being there: no list to edit, so parallel branches don't conflict over one, and CI
// runs the same set as `npm test`. adapters.mjs reads this machine's real transcripts and stays
// behind `npm run test:machine`.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKIP = new Set(["run.mjs", "adapters.mjs"]);
const only = process.argv.slice(2);
const files = fs
  .readdirSync(HERE)
  .filter((f) => f.endsWith(".mjs") && !SKIP.has(f) && (!only.length || only.some((o) => f.includes(o))))
  .sort();

for (const f of files) {
  const started = Date.now();
  const r = spawnSync(process.execPath, [path.join(HERE, f)], { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  if (r.status !== 0) {
    process.stdout.write(r.stdout);
    process.stderr.write(r.stderr);
    console.error(`FAIL ${f} (${secs}s, exit ${r.status ?? r.signal})`);
    process.exit(1);
  }
  console.log(`ok   ${f.padEnd(22)} ${secs}s`);
}
console.log(`${files.length} test files passed`);
