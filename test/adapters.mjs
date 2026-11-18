// Reads this machine's own transcripts through every adapter that finds a store: lists sessions,
// reads the newest one's events and usage, and runs one search. Fails if an available store yields
// no sessions or a session yields no user event.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.ASK_KIT_STATE ??= fs.mkdtempSync(path.join(os.tmpdir(), "ask-kit-test-"));
const { ADAPTERS, makeHistory } = await import("../src/transcripts/index.mjs");

let checked = 0;
for (const [name, a] of Object.entries(ADAPTERS)) {
  if (!a.available()) {
    console.log(`${name}: no store at ${a.where()}`);
    continue;
  }
  const t0 = Date.now();
  const list = (await a.sessions()).sort((x, y) => y.updatedAt.localeCompare(x.updatedAt));
  assert.ok(list.length > 0, `${name}: store exists but no sessions read`);
  const withUser = [];
  for (const s of list.slice(0, 5)) {
    const ev = await a.events(s);
    if (ev.some((e) => e.role === "user")) withUser.push([s, ev]);
  }
  assert.ok(withUser.length > 0, `${name}: none of the 5 newest sessions has a user event`);
  const [s, ev] = withUser[0];
  const roles = ev.reduce((m, e) => ((m[e.role] = (m[e.role] ?? 0) + 1), m), {});
  const u = await a.usage(s);
  console.log(`${name}: ${list.length} sessions in ${Date.now() - t0} ms; newest with a prompt ${s.id.slice(0, 8)} (${s.project}) "${s.title?.slice(0, 50)}" roles ${JSON.stringify(roles)} usage models ${Object.keys(u).join(",") || "none"}`);
  checked++;
}
if (checked === 0) {
  console.log("skip: no transcript stores on this machine");
  process.exit(0);
}

const h = makeHistory({ sources: Object.keys(ADAPTERS) });
const t0 = Date.now();
const hits = await h.grep("keyboard layout", { since: 24 * 30, max: 5 });
console.log(`grep "keyboard layout" (30 days): ${hits.total} hits, ${hits.scanned} sessions parsed, ${Date.now() - t0} ms`, hits.slice(0, 2).map((x) => `${x.source} ${x.session.slice(0, 8)} #${x.i}`));
console.log("ok");
