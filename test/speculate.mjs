// Lookups started ahead: a script's `speculate` names the lookups likely to follow it; the REPL
// starts them as the cell ends, the next cell's matching call gets that result, and runs nobody
// asked for are thrown away. Never in an ask that may act, never a draft or an acting action's
// script, and off with `speculate: false`. The investigator's REPL over MCP; no model, no network.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ask-kit-speculate-"));
const config = path.join(tmp, "config");
const state = path.join(tmp, "state");
const kit = path.join(config, "kits", "watch");
fs.mkdirSync(path.join(kit, "scripts"), { recursive: true });

// A made-up duty book whose reads are slow, and which counts them.
const READ_MS = 600;
fs.writeFileSync(
  path.join(kit, "book.mjs"),
  `const ROSTER = { "Pseudopolis Yard": ["Sam Vimes", "Carrot Ironfoundersson"], "Cable Street": ["Angua"] };
const reads = [];
export const make = () => ({
  find: (post) => ROSTER[post] ?? [],
  read: async (officer) => { reads.push(officer); await new Promise((r) => setTimeout(r, ${READ_MS})); return { officer, entry: officer + " signed the duty book" }; },
  reads: () => [...reads],
});
`,
);
fs.writeFileSync(
  path.join(kit, "ask-kit.toml"),
  `name = "watch"\nsays = "the Night Watch duty book"\n\n[[sources]]\nkind = "module"\nname = "book"\nmodule = "book.mjs"\n\n[[actions]]\nname = "strike"\nscript = "strike"\nacts = true\nmatch = ["^strike (?<officer>.+) from the book$"]\n`,
);
const meta = (purpose) => `export const meta = { purpose: ${JSON.stringify(purpose)}, params: {}, returns: "rows", example: "" };\n`;
fs.writeFileSync(
  path.join(kit, "scripts", "find.mjs"),
  meta("who is on duty at a post") +
    `export default async ({ book }, { post }) => ({ post, officers: book.find(post) });
export const speculate = (result) => [
  ...result.officers.map((officer) => ({ script: "read", params: { officer } })),
  { script: "strike", params: { officer: result.officers[0] } },
  { script: "no-such-script", params: {} },
  { script: "mine", params: {} },
];
`,
);
fs.writeFileSync(path.join(kit, "scripts", "read.mjs"), meta("an officer's duty book entry") + "export default async ({ book }, { officer }) => book.read(officer);\n");
fs.writeFileSync(path.join(kit, "scripts", "strike.mjs"), meta("strike an officer from the book") + "export default async ({ book }, { officer }) => book.read('strike ' + officer);\n");
fs.writeFileSync(path.join(kit, "scripts", "reads.mjs"), meta("the reads so far") + "export default async ({ book }) => book.reads();\n");
const writeConfig = (extra = {}) =>
  fs.writeFileSync(path.join(config, "config.json"), JSON.stringify({ version: 1, sources: [], backends: { default: "x", list: { x: { kind: "api", preset: "ollama", model: "none" } } }, domains: { watch: {} }, ...extra }));
writeConfig();

const textOf = (r) => r.content.map((c) => c.text).join("\n");
async function open(session, extra = {}) {
  const c = new Client({ name: "test", version: "0" });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, "src", "server.mjs")], env: { ...process.env, ASK_KIT_CONFIG: config, ASK_KIT_STATE: state, ASK_KIT_DOMAIN: "watch", ASK_KIT_INNER: "1", ASK_KIT_SESSION: session, ...extra }, stderr: "inherit" }));
  const cell = async (code) => {
    const r = await c.callTool({ name: "repl", arguments: { code } });
    assert.ok(!r.isError, textOf(r));
    return textOf(r);
  };
  return { c, cell };
}
const cells = (session) => fs.readFileSync(path.join(state, "watch", `${session}.jsonl`), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// The time the model takes to write its next call.
const MODEL_MS = READ_MS + 300;

const { c, cell } = await open("speculate-test");
// A draft named in a prediction is never run ahead.
await cell('scripts.draft("mine", "export default async ({ book }) => book.read(\\"draft\\");")');
await cell('await scripts.run("find", { post: "Cable Street" })');
await sleep(MODEL_MS);
const t0 = Date.now();
const hit = await cell('await scripts.run("read", { officer: "Angua" })');
const hitMs = Date.now() - t0;
assert.match(hit, /Angua signed the duty book/);
assert.ok(hitMs < READ_MS, `the read had already run while the model wrote (${hitMs} ms)`);
assert.match(await cell('JSON.stringify(await scripts.run("reads"))'), /^\["Angua"\]/, "one read: the one started ahead, handed over");

// A call that does not match: it runs for real, and the runs started ahead are thrown away.
await cell('await scripts.run("find", { post: "Pseudopolis Yard" })');
await sleep(MODEL_MS);
assert.match(await cell('await scripts.run("read", { officer: "Nobby Nobbs" })'), /Nobby Nobbs signed/);
const reads = JSON.parse((await cell('JSON.stringify(await scripts.run("reads"))')).split("\n")[0]);
assert.deepEqual(reads.slice(1).sort(), ["Carrot Ironfoundersson", "Nobby Nobbs", "Sam Vimes"]);
assert.ok(!reads.some((r) => r.startsWith("strike") || r === "draft"), "no acting action's script and no draft ran ahead");

const rows = cells("speculate-test").filter((r) => r.code);
const hitRow = rows.find((r) => r.code.includes('officer: "Angua"'));
assert.deepEqual(hitRow.speculated, [{ script: "read", params: { officer: "Angua" }, used: true, ms: hitRow.speculated[0].ms }]);
assert.ok(hitRow.speculated[0].ms >= READ_MS - 50);
assert.equal(hitRow.scripts[0].speculative, true);
const missRow = rows.find((r) => r.code.includes("Nobby"));
assert.deepEqual(missRow.speculated.map((s) => [s.params.officer, s.used]), [["Sam Vimes", false], ["Carrot Ironfoundersson", false]]);
assert.ok(!missRow.scripts[0].speculative);
// The read after a hit is not handed the earlier result again: results live for one cell.
await cell('await scripts.run("find", { post: "Cable Street" })');
await cell("1");
await cell('await scripts.run("read", { officer: "Angua" })');
assert.ok(!cells("speculate-test").at(-1).scripts[0].speculative, "a result started ahead is thrown away after the next cell");
await c.close();

// An ask that may act starts nothing ahead.
const acting = await open("speculate-act", { ASK_KIT_ACT: "1", ASK_KIT_CALLER: "vimes" });
await acting.cell('await scripts.run("find", { post: "Cable Street" })');
await sleep(MODEL_MS);
assert.match(await acting.cell('JSON.stringify(await scripts.run("reads"))'), /^\[\]/, "nothing ran ahead");
await acting.c.close();

// speculate: false in the config, for the domain.
writeConfig({ domains: { watch: { speculate: false } } });
const off = await open("speculate-off");
await off.cell('await scripts.run("find", { post: "Cable Street" })');
await sleep(MODEL_MS);
assert.match(await off.cell('JSON.stringify(await scripts.run("reads"))'), /^\[\]/);
await off.c.close();

fs.rmSync(tmp, { recursive: true, force: true });
console.log("ok");
process.exit(0);
