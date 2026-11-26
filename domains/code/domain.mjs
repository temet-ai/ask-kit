// code: questions about one repository's code, answered with path:line citations. A cheap model
// explores (ripgrep, reads, git history, ready-made scripts) outside the calling agent's context,
// and can edit files, run programs and use git when asked to.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeRepo, readOnly, withAt } from "./repo.mjs";

const DIR = path.dirname(fileURLToPath(import.meta.url));

// The repository: ASK_KIT_CODE_ROOT, else the git top level of the directory the server started in
// (agents start MCP servers in the session's project directory).
function repoRoot() {
  const start = process.env.ASK_KIT_CODE_ROOT || process.cwd();
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: start, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return start;
  }
}
const ROOT = repoRoot();

export const domain = {
  name: "code",
  says: "the code in this repository now, or in another checkout named by its folder: where something is defined or used, how it works, which setting, flag, env var or constant controls it, what calls it, when a line changed in git",
  // One state folder per repository: journals, snapshots and the warm session are about that code.
  stateKey: ROOT,
  // The investigator's own server starts in another directory; it must find the same repository.
  childEnv: () => ({ ASK_KIT_CODE_ROOT: ROOT }),
  scriptsDir: path.join(DIR, "scripts"),
  apiDoc: path.join(DIR, "api.d.ts"),
  instructions: path.join(DIR, "instructions.md"),
  // Writing, editing, running programs and git commands that change things only in an ask whose
  // caller asked for a change (act: true); otherwise `repo` reads only.
  makeGlobals: ({ push, act = false }) => {
    const repo = makeRepo({ root: ROOT, push, noteMissing: true });
    return { repo: withAt(act ? repo : readOnly(repo), { push, act }) };
  },
  // Looked up before the first model call. With no `match` it never answers by itself and never
  // claims a route: its pattern is found in any question, and `lookup` returns null (so nothing is
  // added) when the question names nothing the repository holds.
  actions: [{ name: "lookup", title: "what the question names", script: "lookup", patterns: ["(?<question>\\S[\\s\\S]*)"], match: [], params: { budget: 18000 }, expect: null, acts: false }],
  // Run with no model when a session starts (src/warm.mjs): builds or updates the code map, so the
  // map script and lookup answer from it on the first question.
  warm: { script: "map", params: { warm: true } },
  prime:
    "Get ready to answer questions about a codebase. Call the `help` tool, then run one repl cell: " +
    '`(await scripts.run("overview")).dirs.length`. Then reply with the single word: ready',
  answerRules:
    `\n\nAnswer from the repository at ${ROOT}. Answer first, short; cite every fact as \`path:line\` ` +
    "(or a commit sha), and say what you looked for and did not find.",
  openWith:
    "When the question came with a lookup already run, start from that: it holds definitions and callers, and names what it left out. " +
    "Otherwise open with a script, not raw calls:\n" +
    '- What names are, with their code, and what uses or calls them, several together: `await scripts.run("lookup", { names: ["Thing", "other_thing"], budget: 18000 })`, sent with `maxChars: 20000`\n' +
    '- Every caller (several levels), implementation, writer or use of names, and what a range of lines defines and calls, from the code map: `await scripts.run("map", { names: ["Thing", "*Worker"], callers: 3 })`, sent with `maxChars: 20000`\n' +
    '- Every use of one name, counted by file: `await scripts.run("where", { name: "Thing", uses: 60 })`\n' +
    '- Settings, env vars, flags and constants about a topic: `await scripts.run("knobs", { topic: "embedding speed" })`\n' +
    '- When and why something changed: `await scripts.run("history", { term: ["Thing", "other_thing"] })`; in another repository, with `path: "/its/folder"`\n' +
    '- What a file or folder holds (definitions with lines): `await scripts.run("outline", { path: "src/x.rs" })`\n' +
    '- The repository at a glance (folders, docs, entry points): `await scripts.run("overview")`\n' +
    "Then `repo.read(file, { from, to })` only the lines that answer, all the ranges you know you need in one cell. " +
    "Run overview only when the question names nothing to look up. Return only what you need from each cell.\n\n",
  askDescription:
    "Ask a question about this repository's code in plain words and get a short answer with path:line citations. " +
    "A cheap model explores the code outside your context (ripgrep, reads, git history, ready-made scripts), so you pay for one call " +
    "and the answer, not for the searching. Good for: where is X defined or used, is there a setting/flag/env var for Y, how does Z work, " +
    "what calls this, when and why did this change, which files would a change to W touch. It can also make a change you ask for " +
    "(edit files, run a program, commit) when you pass act: true; a request that opens with what to do (\"fix ...\", \"add ...\", \"run the tests\") sets it. " +
    "Without it the investigator only reads.",
  serverInstructions:
    "`ask` answers questions about this repository's code. Call it before a run of grep/rg/cat/read calls whose purpose " +
    "is to answer a question (where, how, is there, what calls, why changed); read files yourself when you are about to edit them.",
  replInstructions:
    "A JavaScript REPL over one repository (`repo`: rg, files, read, git), with ready-made scripts. Variables persist. Call `help` once.",
  fingerprintFiles: () => ["domain.mjs", "repo.mjs", "lib.mjs", "map.mjs", "scan.mjs"].map((f) => path.join(DIR, f)),
  root: ROOT,
};
