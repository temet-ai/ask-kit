// sessions: past work, read from the coding agents' own transcripts (Claude Code, Codex, Copilot
// CLI, Gemini CLI, opencode: whichever setup enabled). No proxy and no database, just the files the agents already write.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeHistory, cite } from "../../src/transcripts/index.mjs";

const DIR = path.dirname(fileURLToPath(import.meta.url));

export const domain = {
  name: "sessions",
  says: "past work in your coding-agent sessions: what was discussed, decided, tried, built or failed, why, when and in which session; what a session did, changed or used",
  scriptsDir: path.join(DIR, "scripts"),
  apiDoc: path.join(DIR, "api.d.ts"),
  instructions: path.join(DIR, "instructions.md"),
  makeGlobals: ({ push, config }) => ({ history: makeHistory({ sources: config.sources, push }), cite }),
  prime:
    "Get ready to answer questions about past coding-agent sessions. Call the `help` tool, then run one repl cell: " +
    '`(await scripts.run("recent", { hours: 24 })).total`. Then reply with the single word: ready',
  answerRules:
    "\n\nAnswer from the transcripts. Answer first, short; cite every fact as `<source> <session id prefix> #<event>` " +
    "(cite() formats it), and say what you searched and did not find.",
  openWith:
    "Open with a script, not raw calls:\n" +
    '- Which session did or discussed X: `await scripts.run("find-sessions", { topic: "X" })`\n' +
    '- What happened in a session: `await scripts.run("session-digest", { session: id })`\n' +
    '- Exact text anywhere (errors, versions, names, ids): `await scripts.run("grep", { query: "text", since: 72 })`\n' +
    '- Sessions in a time window or project: `await scripts.run("recent", { hours: 48, project: "name" })`\n' +
    '- What a session ran and what failed: `await scripts.run("session-tools", { session: id })`\n' +
    '- Files a session changed: `await scripts.run("session-changes", { session: id })`\n' +
    "Return only the fields you need from each cell (a few hundred characters), keeping the rest in variables.\n\n",
  askDescription:
    "Ask about past work in your coding-agent sessions, in plain words, and get a short answer with evidence (source, session id, event number). " +
    "A cheap investigator reads the transcripts outside your context: what was discussed, decided, tried or built, why and in which session; " +
    "what a session did, ran, changed or failed at; which sessions worked on something. Read-only.",
  serverInstructions:
    "`ask` answers questions about past work from your coding agents' own transcripts. Call it first, before git log or memory, " +
    "when the answer lies in what an earlier session did, said or decided. It is a conversation: continue: true asks the same investigator a follow-up.",
  replInstructions:
    "A JavaScript REPL over coding-agent transcripts (`history`: sessions, events, grep, usage), with ready-made scripts. Variables persist. Call `help` once.",
  fingerprintFiles: () => [path.join(DIR, "domain.mjs"), path.join(DIR, "../../src/transcripts/index.mjs")],
};
