// The router's cheap index, with no model and no network: building the router runs no kit's
// `detect` (it runs at the kit's first use), a kit that turns out unable to run says why at first
// use; the calling agent sees the kit list once; the router prompt ends with the working
// directory; past 15 kits keywords shortlist what the router model sees; `kit profile` sums the
// journals per kit.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ask-kit-index-"));
const config = path.join(tmp, "config");
const state = path.join(tmp, "state");
process.env.ASK_KIT_CONFIG = config;
process.env.ASK_KIT_STATE = state;
const marker = path.join(tmp, "detect-ran");

const kit = (name, extra = "") => {
  const dir = path.join(config, "kits", name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "ask-kit.toml"), `name = "${name}"\nsays = "the ${name} of Ankh-Morpork"\n${extra}\n[[sources]]\nkind = "module"\nname = "${name.replace(/-/g, "_")}"\nmodule = "m.mjs"\n`);
  fs.writeFileSync(path.join(dir, "m.mjs"), "export const make = () => ({ roster: () => ['Sam Vimes'] });\n");
};
// detect writes a marker file: it ran. "never" needs a setting only detect could give, and detect prints nothing.
const detect = (code) => JSON.stringify([process.execPath, "-e", code]);
kit("sentry", `keywords = ["gate"]\n[[settings]]\nkey = "SENTRY_POST"\nrequired = true\ndetect = ${detect(`require("fs").writeFileSync(${JSON.stringify(marker)}, "x"); console.log("Treacle Mine Road")`)}`);
kit("never", `[[settings]]\nkey = "NEVER_POST"\nrequired = true\nabout = "the post it guards"\ndetect = ${detect("")}`);
const cfg = { version: 1, sources: [], backends: { default: "x", list: { x: { kind: "api", preset: "ollama", model: "none" } } }, domains: { sessions: {}, sentry: {}, never: {} } };
fs.writeFileSync(path.join(config, "config.json"), JSON.stringify(cfg));
delete process.env.SENTRY_POST;
delete process.env.NEVER_POST;

const { makeRouter } = await import("../src/router.mjs");
const { loadDomain } = await import("../src/domains.mjs");

// Building the router reads manifests only: no detect ran, and a setting only detect can give is
// not yet a reason to leave a kit out.
const r = await makeRouter(cfg);
assert.ok(!fs.existsSync(marker), "makeRouter ran no detect command");
assert.deepEqual(r.enabled, ["sessions", "sentry", "never"]);
assert.equal(r.DOMAINS.sentry.index, true);
assert.equal(typeof r.loadMs.sentry, "number");
// First use builds the kit, and detect runs then.
const full = await loadDomain("sentry");
assert.ok(fs.existsSync(marker), "detect ran at first use");
assert.equal(full.childEnv().SENTRY_POST, "Treacle Mine Road");
assert.match((await loadDomain("never")).unavailable, /needs NEVER_POST \(the post it guards\)/);

// The router prompt: the same prefix in every folder, the working directory near the end.
const here = process.cwd();
const a = r.systemPrompt("who guards the gate?");
process.chdir(tmp);
const b = r.systemPrompt("who guards the gate?");
process.chdir(here);
const cut = (s) => s.slice(0, s.indexOf("\nThe coding agent is working in"));
assert.equal(cut(a), cut(b), "the prefix does not depend on the folder");
assert.ok(cut(a).length > 100 && !cut(a).includes(here), "no working directory before the end");
assert.match(a, new RegExp(`The coding agent is working in ${here.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.$`));
assert.ok(r.promptTokens.sentry > 5 && r.promptTokens.sentry < 30, `router tokens per kit: ${r.promptTokens.sentry}`);

// Through `ask-kit serve`: the kit list once (the `about` parameter), not in the server's
// instructions; a kit that cannot run at first use says why.
const env = { ...process.env, ASK_KIT_CONFIG: config, ASK_KIT_STATE: state, ASK_KIT_SESSION: "index-test" };
delete env.ASK_KIT_DOMAIN;
const client = new Client({ name: "test", version: "0" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, "bin", "ask-kit.mjs"), "serve"], env, stderr: "ignore" }));
const instructions = client.getInstructions();
const tool = (await client.listTools()).tools.find((t) => t.name === "ask");
assert.doesNotMatch(instructions, /Ankh-Morpork/, "the server instructions do not list the kits");
assert.equal(JSON.stringify(tool).match(/the sentry of Ankh-Morpork/g).length, 1, "the tool describes each kit once");
assert.match(tool.inputSchema.properties.about.description, /^sentry: the sentry of Ankh-Morpork$/m);
assert.match(tool.description, /sentry, never/);
const nv = await client.callTool({ name: "ask", arguments: { question: "who guards it?", about: "never" } });
assert.ok(nv.isError);
assert.match(nv.content[0].text, /never cannot run here: needs NEVER_POST/);
await client.close();

// Past 15 kits, the router model sees the kits the question's words point at (with the built-in
// domains and the past-work domain), or all of them when none match.
const many = {};
for (let i = 1; i <= 16; i++) {
  const n = `guild${String(i).padStart(2, "0")}`;
  kit(n, `keywords = ["${n}-hall"]`);
  many[n] = {};
}
const big = await makeRouter({ ...cfg, domains: { sessions: {}, ...many } });
assert.equal(big.enabled.length, 17);
assert.deepEqual(big.offered("who runs the guild03-hall?"), ["sessions", "guild03"]);
const sp = big.systemPrompt("who runs the guild03-hall?");
assert.match(sp, /Reply with one word: sessions, guild03\./);
assert.doesNotMatch(sp, /guild04/);
assert.equal(big.offered("what is the weather?").length, 17, "no keyword matched: every kit");
const small = await makeRouter(cfg);
assert.equal(small.offered("who guards the gate?").length, 3, "15 or fewer: no shortlist");

// kit profile: per kit from the journals; kit-test sessions are left out.
const w = (rel, rows) => {
  fs.mkdirSync(path.dirname(path.join(state, rel)), { recursive: true });
  fs.appendFileSync(path.join(state, rel), rows.map((x) => JSON.stringify(x)).join("\n") + "\n");
};
const now = new Date().toISOString();
w("router/vimes.jsonl", [
  { at: now, question: "q1", domain: "sentry", how: "model" },
  { at: now, question: "q2", domain: "sentry", how: "rules" },
  { at: now, type: "misroute", question: "q2", routed: "sentry", how: "rules", correct: "sessions", why: "re-asked" },
  { at: now, question: "q3", domain: "sessions", how: "fallback", from: "sentry" },
]);
w("router/kittest-sentry-1.jsonl", [{ at: now, question: "bench", domain: "sentry", how: "caller" }]);
w("sentry/vimes.jsonl", [
  { ts: now, session: "vimes", type: "ask", ms: 4000, cells: 2, costUsd: 0.001 },
  { ts: now, session: "vimes", type: "ask", ms: 10000, cells: 6, costUsd: 0.003, noData: true },
  { ts: now, session: "vimes", type: "ask", ms: 6000, cells: 4, costUsd: 0.002 },
]);
w("sentry/kittest-sentry-1.jsonl", [{ ts: now, session: "kittest-sentry-1", type: "ask", ms: 99000, cells: 40, costUsd: 1 }]);
const { kitProfile } = await import("../src/report.mjs");
const prof = kitProfile({ since: "1d", router: r });
const s = prof.kits.find((k) => k.name === "sentry");
assert.deepEqual({ ...s, loadMs: typeof s.loadMs }, { name: "sentry", chosen: 2, asks: 3, medianSeconds: 6, costUsd: 0.006, medianCells: 4, misroutes: 1, fallbacks: 1, noData: 1, routerTokens: r.promptTokens.sentry, loadMs: "number" });
assert.equal(prof.kits.find((k) => k.name === "sessions").chosen, 1);
const cli = JSON.parse(execFileSync(process.execPath, [path.join(ROOT, "bin", "ask-kit.mjs"), "kit", "profile", "--since", "1d", "--json"], { env, encoding: "utf8" }));
assert.equal(cli.kits.find((k) => k.name === "sentry").asks, 3);

fs.rmSync(tmp, { recursive: true, force: true });
console.log("ok");
process.exit(0);
