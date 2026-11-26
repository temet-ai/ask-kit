// Quoted rows: the investigator keeps the rows it fetched with `quote(rows)`, writes
// {{quote:<id>}} in its answer, and the host writes each row in whole. An id that matches no kept
// row goes back to the model once, and is marked in the answer if it is still unknown. A follow-up
// can quote rows an earlier ask kept. Scripted backend on 127.0.0.1; no network, no model.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fakeBackend } from "./fixtures/shot-kit/fake-backend.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ask-kit-quotes-"));
const config = path.join(tmp, "config");
const state = path.join(tmp, "state");
process.env.ASK_KIT_CONFIG = config;
process.env.ASK_KIT_STATE = state;
fs.cpSync(path.join(ROOT, "test", "fixtures", "shot-kit"), path.join(config, "kits", "watch"), { recursive: true });

// The helpers on their own.
const { insertQuotes, makeQuote, quotedIds, unknownIds } = await import("../src/quotes.mjs");
const store = {};
let saved = 0;
const quote = makeQuote(store, () => saved++);
const shown = quote([{ id: "m 1", text: "Sam Vimes: {braces} stay" }, { body: "no id here" }, "a plain string"], { text: (r) => (typeof r === "string" ? r : r.text ?? r.body) });
assert.deepEqual(Object.keys(store), ["m-1", "q2", "q3"], "an id with a space is made safe; rows without one are numbered");
assert.equal(store["m-1"], "Sam Vimes: {braces} stay");
assert.equal(saved, 1);
assert.match(shown, /^3 row\(s\) kept/);
assert.match(shown, /\{\{quote:q3\}\} a plain string/);
quote([{ n: 7, line: "Nobby" }], { id: "n", text: "line" });
assert.equal(store["7"], "Nobby");
quote([{ text: "Detritus" }]);
assert.equal(store.q5, "Detritus", "a numbered id never takes one that is already there");
assert.deepEqual(quotedIds("{{quote:a}} {{quote:b}} {{quote:a}}"), ["a", "b"]);
assert.deepEqual(unknownIds("{{quote:m-1}} {{quote:zz}}", store), ["zz"]);
const filled = insertQuotes("- {{quote:m-1}}\n- {{quote:zz}}", store);
assert.equal(filled.text, "- Sam Vimes: {braces} stay\n- [no fetched row has id zz]");
assert.equal(filled.inserted, 1);
assert.deepEqual(filled.unknown, ["zz"]);
assert.deepEqual(unknownIds("{{quote:toString}}", {}), ["toString"], "an id is looked up as the row's own key only");

// The whole ask.
const ROWS =
  'const book = (await scripts.run("duty", { post: "Pseudopolis Yard" })).officers.map((name, i) => ({ id: "w" + (i + 1), text: name + " signed the duty book at Pseudopolis Yard: \\"on watch, nothing to report\\"" }));\nquote(book)';
const VIMES = 'Sam Vimes signed the duty book at Pseudopolis Yard: "on watch, nothing to report"';
const CARROT = 'Carrot Ironfoundersson signed the duty book at Pseudopolis Yard: "on watch, nothing to report"';
const fake = await fakeBackend([
  { code: ROWS },
  { answer: "Signed in at Pseudopolis Yard:\n- {{quote:w1}}\n- {{quote:w9}}" },
  { answer: "Signed in at Pseudopolis Yard:\n- {{quote:w1}}\n- {{quote:w2}}" },
  // The follow-up: one row the first ask kept, one id that matches nothing, twice.
  { answer: "Carrot: {{quote:w2}}; Angua: {{quote:w7}}" },
  { answer: "Carrot: {{quote:w2}}; Angua: {{quote:w7}}" },
]);
fs.writeFileSync(path.join(config, "config.json"), JSON.stringify({ version: 1, sources: [], backends: { default: "fake", list: { fake: fake.backend } }, domains: { watch: {} } }));
const env = { ...process.env, ASK_KIT_DOMAIN: "watch", ASK_KIT_SESSION: "quotes-test" };
const textOf = (r) => r.content.map((c) => c.text).join("\n");
const client = new Client({ name: "test", version: "0" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, "src", "server.mjs")], env, stderr: "inherit" }));

const first = await client.callTool({ name: "ask", arguments: { question: "list word for word what each officer wrote in the Pseudopolis Yard duty book", early: false } });
const text = textOf(first);
assert.ok(!first.isError, text);
assert.equal(text, `Signed in at Pseudopolis Yard:\n- ${VIMES}\n- ${CARROT}`, "each marker became its row, whole");
assert.match(fake.requests[0].messages[0].content, /quote\(rows, \{ id, text \}\)/, "the work-loop text tells the investigator");
const cellResult = fake.requests[1].messages.findLast((m) => m.role === "tool").content;
assert.match(cellResult, /\{\{quote:w1\}\} Sam Vimes signed/, "the cell shows each row's marker");
const sentBack = fake.requests[2].messages.at(-1);
assert.equal(sentBack.role, "user");
assert.match(sentBack.content, /\{\{quote:w9\}\}/);
assert.match(sentBack.content, /The ids kept: w1, w2\./);
assert.equal(fake.requests[2].messages.at(-2).content, "Signed in at Pseudopolis Yard:\n- {{quote:w1}}\n- {{quote:w9}}", "the answer it sends back is the model's own");

const second = await client.callTool({ name: "ask", arguments: { question: "and Angua?", continue: true, early: false } });
const text2 = textOf(second);
assert.equal(text2, `Carrot: ${CARROT}; Angua: [no fetched row has id w7]`, "a follow-up quotes the earlier rows; an id still unknown is marked, never guessed");
assert.equal(fake.requests.length, 5, "the unknown id went back to the model once, not twice");
assert.ok(fake.requests[4].messages.findLast((m) => m.role === "assistant").content.includes("{{quote:w2}}"), "the history keeps markers, not rows");

const rows = fs.readFileSync(path.join(state, "watch", "quotes-test.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((r) => r.type === "ask");
assert.deepEqual(rows[0].quotes, { inserted: 2 });
assert.equal(rows[0].quotesSentBack, 1);
assert.deepEqual(rows[1].quotes, { inserted: 1, unknown: ["w7"] });
assert.ok(!("quotesFrom" in rows[0]), "the REPL's id is not journaled");
assert.equal(rows[0].answerChars, text.length);

await client.close();
await fake.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log("ok");
process.exit(0);
