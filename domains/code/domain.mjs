// code: questions about one repository's code, answered with path:line citations. A cheap model
// explores (ripgrep, reads, git history, ready-made scripts) outside the calling agent's context,
// and can edit files, run programs and use git when asked to.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeRepo } from "./repo.mjs";

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
  says: "the code in this repository now: where something is defined or used, how it works, which setting, flag, env var or constant controls it, what calls it, when a line changed in git",
  // One state folder per repository: journals, snapshots and the warm session are about that code.
  stateKey: ROOT,
  // The investigator's own server starts in another directory; it must find the same repository.
  childEnv: () => ({ ASK_KIT_CODE_ROOT: ROOT }),
  scriptsDir: path.join(DIR, "scripts"),
  apiDoc: path.join(DIR, "api.d.ts"),
  instructions: path.join(DIR, "instructions.md"),
  makeGlobals: ({ push }) => ({ repo: makeRepo({ root: ROOT, push }) }),
  prime:
    "Get ready to answer questions about a codebase. Call the `help` tool, then run one repl cell: " +
    '`(await scripts.run("overview")).dirs.length`. Then reply with the single word: ready',
  answerRules:
    `\n\nAnswer from the repository at ${ROOT}. Answer first, short; cite every fact as \`path:line\` ` +
    "(or a commit sha), and say what you looked for and did not find.",
  openWith:
    "Open with a script, not raw calls:\n" +
    '- Where something is defined and used: `await scripts.run("where", { name: "Thing" })`\n' +
    '- Settings, env vars, flags and constants about a topic: `await scripts.run("knobs", { topic: "embedding speed" })`\n' +
    '- When and why something changed: `await scripts.run("history", { term: "Thing" })`\n' +
    '- What a file or folder holds (definitions with lines): `await scripts.run("outline", { path: "src/x.rs" })`\n' +
    '- The repository at a glance (folders, docs, entry points): `await scripts.run("overview")`\n' +
    "Then `repo.read(file, { from, to })` only the lines that answer. Return only what you need from each cell.\n\n",
  askDescription:
    "Ask a question about this repository's code in plain words and get a short answer with path:line citations. " +
    "A cheap model explores the code outside your context (ripgrep, reads, git history, ready-made scripts), so you pay for one call " +
    "and the answer, not for the searching. Good for: where is X defined or used, is there a setting/flag/env var for Y, how does Z work, " +
    "what calls this, when and why did this change, which files would a change to W touch. It can also make a change you ask for " +
    "(edit files, run a program, commit).",
  serverInstructions:
    "`ask` answers questions about this repository's code. Call it before a run of grep/rg/cat/read calls whose purpose " +
    "is to answer a question (where, how, is there, what calls, why changed); read files yourself when you are about to edit them.",
  replInstructions:
    "A JavaScript REPL over one repository (`repo`: rg, files, read, git), with ready-made scripts. Variables persist. Call `help` once.",
  fingerprintFiles: () => [path.join(DIR, "domain.mjs"), path.join(DIR, "repo.mjs"), path.join(DIR, "lib.mjs")],
  root: ROOT,
};
