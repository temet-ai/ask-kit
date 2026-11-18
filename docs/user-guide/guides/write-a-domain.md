# Write a domain

This guide builds a small, working domain from nothing: `notes`, which answers questions about a
folder of markdown notes. You write five files, turn the domain on and ask it a question. The
steps carry over to any data source or system: a folder, a database, logs, a service.

[Domains](../domains.md) explains what a domain is and how to share one. This page is the
hands-on version. The contract a domain module follows is in
[`src/domains.mjs`](https://github.com/temet-ai/ask-kit/blob/main/src/domains.mjs) (the header
comment and `loadDomain`), and the globals a domain offers are described in the
[Investigator API reference](../reference/domain-api.md).

## Before you start

- ask-kit is set up: `ask-kit doctor` shows at least one working backend.
- You have a folder of `.md` files. The examples use `~/notes`. Any folder works.
- You know where ask-kit is installed. `ask-kit doctor` prints the guide's path, and the guide
  (`~/.config/ask-kit/AGENTS.md`) names the install folder.

On Windows the config folder is `%APPDATA%\ask-kit`. This page writes `~/.config/ask-kit`.

## 1. Make the folder

```sh
mkdir -p ~/.config/ask-kit/domains/notes/scripts
cd ~/.config/ask-kit/domains/notes
```

A folder under `domains/` in the config folder is a domain when it holds a `domain.mjs`. The name
is the folder name: lowercase letters, digits and dashes, starting with a letter. A domain here
replaces a built-in one of the same name, so pick a new name.

## 2. Write the client

The client is what the investigator's programs call: methods that return plain data. This one
only reads; a domain that should act (add a note, tag one) gets methods for that too. Every call
reports itself through `push`, so the journal shows what the investigator did.

Save as `notes.mjs`:

```js
// A client for a folder of markdown notes. Note names resolve against the folder.
import fs from "node:fs";
import path from "node:path";

export function makeNotes({ root, push }) {
  const ROOT = fs.realpathSync(root);
  const note = (kind, detail, started, size) => push({ kind, detail, ms: Date.now() - started, size });

  const inside = (name) => {
    const full = path.resolve(ROOT, name);
    const rel = path.relative(ROOT, full);
    return { full, rel: rel.split(path.sep).join("/") };
  };

  function walk(dir, out = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, out);
      else if (e.name.endsWith(".md")) out.push(full);
    }
    return out;
  }

  const tagsOf = (text) => [...new Set([...text.matchAll(/(?:^|\s)#([a-z][\w-]*)/gi)].map((m) => m[1].toLowerCase()))];
  const titleOf = (text) => text.match(/^#\s+(.+)$/m)?.[1].trim() ?? null;

  return {
    root: ROOT,

    /** Notes, newest first. `tag` keeps notes carrying that #tag; `since` is hours ago; `max` caps the list (default 200). */
    list(o = {}) {
      const started = Date.now();
      const cutoff = o.since != null ? Date.now() - o.since * 3600_000 : 0;
      const tag = o.tag?.replace(/^#/, "").toLowerCase();
      const rows = [];
      for (const full of walk(ROOT)) {
        const st = fs.statSync(full);
        if (st.mtimeMs < cutoff) continue;
        const text = fs.readFileSync(full, "utf8");
        const tags = tagsOf(text);
        if (tag && !tags.includes(tag)) continue;
        rows.push({ name: path.relative(ROOT, full).split(path.sep).join("/"), title: titleOf(text), tags, bytes: st.size, modified: st.mtime.toISOString() });
      }
      rows.sort((a, b) => b.modified.localeCompare(a.modified));
      const max = o.max ?? 200;
      note("list", JSON.stringify(o).slice(0, 120), started, rows.length);
      return Object.assign(rows.slice(0, max), { total: rows.length, complete: rows.length <= max });
    },

    /** Lines `from`..`to` of one note (1-based, inclusive, at most 200), numbered "N<tab>line". */
    read(name, o = {}) {
      const started = Date.now();
      const { full, rel } = inside(name);
      const lines = fs.readFileSync(full, "utf8").split("\n");
      const from = Math.max(1, o.from ?? 1);
      const to = Math.min(lines.length, o.to ?? from + 199, from + 199);
      const text = lines.slice(from - 1, to).map((l, i) => `${from + i}\t${l}`).join("\n");
      note("read", `${rel}:${from}-${to}`, started, to - from + 1);
      return { name: rel, from, to, lines: lines.length, text };
    },

    /** Lines holding every word of `query` (any case), as {name, line, text}. `max` caps the hits (default 50). */
    search(query, o = {}) {
      const started = Date.now();
      const words = String(query).toLowerCase().split(/\s+/).filter(Boolean);
      const max = o.max ?? 50;
      const hits = [];
      let total = 0;
      for (const full of walk(ROOT)) {
        const name = path.relative(ROOT, full).split(path.sep).join("/");
        fs.readFileSync(full, "utf8").split("\n").forEach((text, i) => {
          const lower = text.toLowerCase();
          if (!words.length || !words.every((w) => lower.includes(w))) return;
          total++;
          if (hits.length < max) hits.push({ name, line: i + 1, text: text.trim().slice(0, 300) });
        });
      }
      note("search", String(query), started, total);
      return Object.assign(hits, { total, complete: total <= max });
    },
  };
}
```

Three habits in this file come from the built-in `code` domain's
[`repo.mjs`](https://github.com/temet-ai/ask-kit/blob/main/domains/code/repo.mjs):

- Results carry `total` and `complete`, so the investigator can tell a short list from a cut one.
- Results are capped by default, so one careless call does not fill the investigator's context.
- Paths are checked against the root, so a program cannot read outside the folder.

## 3. Describe the API

The investigator learns what its programs can reach from this file alone. Declare every global and method, its
parameters and what it returns. Keep the `scripts` block and the toolkit lines: they describe what
every domain has.

Save as `api.d.ts`:

```ts
// The REPL's globals for the notes domain. `help` returns this file.

interface NoteRow { name: string; title: string | null; tags: string[]; bytes: number; modified: string }
interface Hit { name: string; line: number; text: string }

declare const notes: {
  root: string; // absolute path of the notes folder
  // Notes, newest first. `tag` keeps notes carrying that #tag, `since` is hours ago, `max` caps the list (default 200).
  list(o?: { tag?: string; since?: number; max?: number }): NoteRow[] & { total: number; complete: boolean };
  // Lines from..to (1-based, inclusive, at most 200) of one note, numbered "N\tline". `lines` is the note's length.
  read(name: string, o?: { from?: number; to?: number }): { name: string; from: number; to: number; lines: number; text: string };
  // Lines holding every word of `query` (any case). `max` caps the hits (default 50); `.total` counts them all.
  search(query: string, o?: { max?: number }): Hit[] & { total: number; complete: boolean };
};

declare const scripts: {
  list(): { name: string; purpose: string; params: Record<string, string>; returns: string; draft: boolean }[];
  show(name: string): string;
  run(name: string, params?: Record<string, unknown>): Promise<any>;
  draft(name: string, source: string): { name: string; file: string };
};

// Toolkit (also tk.*)
declare function shape(x: unknown, depth?: number): unknown;
declare function pick<T>(rows: T | T[], ...keys: string[]): any;
declare function table(rows: object[], cols?: string[], o?: { width?: number }): string;
declare function top<T>(rows: T[], key: string | ((r: T) => number), n?: number): T[];
declare function groupBy<T>(rows: T[], key: string | ((r: T) => string)): Record<string, T[]>;
declare function countBy<T>(rows: T[], key: string | ((r: T) => string)): Record<string, number>;
declare function clip(s: string | null, max?: number): string | null;
```

## 4. Write the instructions

Say what the data holds, how to search it narrowly, what counts as evidence and how to cite it.
Keep it short: every line is read on every question. `domains/code/instructions.md` is a good
length to aim for.

Save as `instructions.md`:

```md
You are an investigator of a person's markdown notes. Another coding-agent session sends you one
question about what the person wrote down. You answer it through your REPL, which can list,
search and read the notes folder.

What the notes hold:

- One markdown file per note, in folders by project. The first `# heading` is the note's title.
- `#tags` appear inline in the text. Notes are not dated inside; `modified` on a listing is the
  file's last change.

How to work:

- Start from a ready-made script (`scripts.run`) when one fits. `find-notes` ranks notes for a topic.
- Search for the distinctive words, two or three, not a sentence; try synonyms when the first
  search finds nothing. Words must all appear on one line.
- Read the lines that decide the answer (`notes.read`) before you state it: a hit is a lead,
  not proof.
- Keep results in variables and return only what answers the question from each cell.
- When a cell fails, read the error and change the cell. Never send the same cell twice.
- If the notes do not answer the question, say what you searched and what is missing. Never
  guess a name, a date or what a note says.
- A question in several parts gets every part answered.

The answer:

- Short and direct: the answer first, then a few lines of support.
- Every fact names its evidence as `<note name>:<line>`, e.g. `projects/billing.md:14`.
- No preamble, no restating the question, no offer of further help.
```

## 5. Write a first script

A script is a ready-made program for a question people ask often. It saves the investigator from
rewriting the same search. This one ranks notes for a topic. The next guide,
[Add a script to a domain](add-a-script.md), covers scripts in more detail.

Save as `scripts/find-notes.mjs`:

```js
export const meta = {
  purpose:
    "Which notes cover a topic: searches every note for the topic's words, ranks notes by matching lines (a title match counts extra) and returns the first matching lines of each.",
  params: {
    topic: "a few distinctive words, e.g. 'action items'",
    tag: "only notes with this #tag, optional",
    max: "notes returned, default 10",
  },
  returns: "{words, total, notes:[{name, title, tags, matches, lines:[{line, text}]}], complete}",
  example: 'await scripts.run("find-notes", { topic: "action items" })',
};

const STOP = new Set(["the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "what", "did", "i", "was", "is", "about"]);

export default async function ({ notes }, { topic, tag, max = 10 }) {
  if (!topic) throw new Error("find-notes needs `topic`");
  const words = String(topic).toLowerCase().split(/\s+/).filter((w) => w && !STOP.has(w));
  if (!words.length) throw new Error("find-notes needs `topic` with at least one meaningful word");
  const allowed = tag ? new Set(notes.list({ tag, max: 10_000 }).map((n) => n.name)) : null;
  const info = new Map(notes.list({ max: 10_000 }).map((n) => [n.name, n]));
  const hits = notes.search(words.join(" "), { max: 500 });
  const by = new Map();
  for (const h of hits) {
    if (allowed && !allowed.has(h.name)) continue;
    const n = info.get(h.name);
    const row = by.get(h.name) ?? { name: h.name, title: n?.title ?? null, tags: n?.tags ?? [], matches: 0, lines: [] };
    row.matches++;
    if (row.lines.length < 3) row.lines.push({ line: h.line, text: h.text.slice(0, 160) });
    by.set(h.name, row);
  }
  const score = (r) => r.matches + (words.every((w) => (r.title ?? "").toLowerCase().includes(w)) ? 5 : 0);
  const ranked = [...by.values()].sort((a, b) => score(b) - score(a));
  return { words, total: ranked.length, notes: ranked.slice(0, max), complete: hits.complete };
}
```

A script's first argument holds the domain's globals (here `notes`) and `tk`, the toolkit. Its
second is the parameters the investigator passed.

## 6. Write `domain.mjs`

This file ties the others together. It exports one object, `domain`. Each field is described in
the header comment of
[`src/domains.mjs`](https://github.com/temet-ai/ask-kit/blob/main/src/domains.mjs).

Save as `domain.mjs`:

```js
// notes: questions about a folder of markdown notes, answered with note names and line numbers.
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeNotes } from "./notes.mjs";

const DIR = path.dirname(fileURLToPath(import.meta.url));

// The folder: `dir` under domains.notes in config.json, else ~/notes.
const folder = (config) => {
  const dir = config?.domains?.notes?.dir ?? "~/notes";
  return dir.replace(/^~(?=$|\/)/, os.homedir());
};

export const domain = {
  name: "notes",
  says: "what my markdown notes say: what I wrote down about a topic, a project, a person or a decision, and when",
  scriptsDir: path.join(DIR, "scripts"),
  apiDoc: path.join(DIR, "api.d.ts"),
  instructions: path.join(DIR, "instructions.md"),
  makeGlobals: ({ push, config }) => ({ notes: makeNotes({ root: folder(config), push }) }),
  prime:
    "Get ready to answer questions about a folder of notes. Call the `help` tool, then run one repl cell: " +
    "`notes.list({ max: 5 }).total`. Then reply with the single word: ready",
  answerRules:
    "\n\nAnswer from the notes. Answer first, short; cite every fact as `<note name>:<line>`, " +
    "and say what you searched for and did not find.",
  openWith:
    "Open with a script, not raw calls:\n" +
    '- Which notes cover a topic: `await scripts.run("find-notes", { topic: "action items" })`\n' +
    "Then `notes.read(name, { from, to })` only the lines that answer. Return only what you need from each cell.\n\n",
  askDescription:
    "Ask about my markdown notes in plain words and get a short answer with note names and line numbers. " +
    "A cheap model searches and reads the notes outside your context. Good for: what did I write about X, " +
    "which notes mention Y, what did I decide about Z.",
  serverInstructions:
    "`ask` answers questions about my markdown notes. Call it before a run of searches and reads whose purpose is to answer " +
    "a question about what I wrote down.",
  replInstructions:
    "A JavaScript REPL over a folder of markdown notes (`notes`: list, read, search), with ready-made scripts. Variables persist. Call `help` once.",
  fingerprintFiles: () => [path.join(DIR, "domain.mjs"), path.join(DIR, "notes.mjs")],
};
```

What each field does:

| Field | Used for |
|---|---|
| `name` | The domain's name. Match the folder name. |
| `says` | One line the router reads to decide whether a question belongs here. Make it say what the domain answers, in the words people use. |
| `scriptsDir`, `apiDoc`, `instructions` | Paths to the scripts folder, `api.d.ts` and `instructions.md`. |
| `makeGlobals({ push, config })` | Returns the REPL's globals. `push(call)` journals a call. `config` is the whole `config.json`, so a domain can read its own keys under `domains.<name>`. Here that is `dir`. |
| `prime` | The first prompt of a warm session (used for the `claude-cli` and `codex-cli` backends). It makes the model call `help` and run a cell, so the session holds the instructions and API before the first real question. |
| `answerRules` | Added to every question: how to cite. |
| `openWith` | Tells an `api` model which script to start from. |
| `askDescription` | The `ask` tool's description for this domain, which the calling agent reads. Say when to use it. |
| `serverInstructions`, `replInstructions` | The MCP server instructions for the calling agent and for the investigator. |
| `fingerprintFiles()` | Files whose change re-warms the investigator. The instructions, `api.d.ts` and scripts are included already. List your own code here. |

Fields this example leaves out: `stateKey` (a sub-folder of the state folder, one per repository
in `code`), `childEnv()` (extra environment for the investigator's server), `beforeCell(globals)`
(called before each cell), `codexNote` (text added to a Codex warm prompt), `defaultBackend` (a
backend name that suits this domain). `domains/code/domain.mjs` uses `stateKey` and `childEnv`.

## 7. Check that it loads

Run this from the ask-kit folder. It needs no model.

```sh
node -e 'import("./src/domains.mjs").then(async (m) => { console.log(m.listDomains()); console.log((await m.loadDomain("notes")).says); })'
```

You should see `notes` in the list, then the `says` line. An import error here points at a typo in
`domain.mjs` or `notes.mjs`.

For a closer check without a model, start the investigator's server the way
[`test/repl.mjs`](https://github.com/temet-ai/ask-kit/blob/main/test/repl.mjs) does: with
`ASK_KIT_INNER=1` and `ASK_KIT_DOMAIN=notes`, list its tools, call `help` and run a cell such as
`notes.list({ max: 5 }).total`. `help` should list `find-notes`, and the cell should return the
number of notes. Use throwaway `ASK_KIT_CONFIG` and `ASK_KIT_STATE` folders for this, so the
test leaves no journals in your real state folder.

## 8. Enable it

Open `~/.config/ask-kit/config.json` and add the domain under `domains`, with the folder:

```json
"domains": {
  "sessions": { "enabled": true },
  "code": { "enabled": true },
  "notes": { "enabled": true, "dir": "~/notes" }
}
```

`dir` is this domain's own key. [`domains`](../reference/config.md#domains) lists the keys every
domain has: `enabled`, `backend`, `from` and `commit`.

Two things to know:

- `ask-kit ask --domain notes` works without this step, because `--domain` starts that domain's
  server directly. Agents reach the domain through the router, and the router offers only the
  domains in the config.
- `ask-kit setup` and `ask-kit apply` write the `domains` object again from their answers. If you
  run one later, add `notes` and `dir` back.

Restart your agents. The `ask` tool's description now lists `notes`, with the `says` line.

To answer this domain on a different model, add `"backend": "<name>"` next to `enabled`.

## 9. Ask it a question

```sh
ask-kit ask --domain notes "what are the action items from the billing retro?"
```

The first question for a `claude-cli` or `codex-cli` backend also builds the warm session, so it
takes longer. A good answer cites notes by name and line, in the form `projects/billing.md:5`,
ends with the footer `[notes · <backend> · <seconds>s · ...]`, and says what it searched for if
it found nothing.

If the folder in `dir` does not exist, `makeNotes` throws when the server starts, and the ask
fails with a connection error from the server instead of an answer. If `dir` points at a different
folder than the one the question is about, the answer says the notes do not cover it. Check `dir`
first in both cases.

## 10. Read what the investigator did

Every cell is journaled. Find the investigator's journal in the state folder and read the code
it ran:

```sh
ls -t ~/.local/state/ask-kit/notes/*.jsonl | head -3
jq -r 'select(.code) | .code' $(ls -t ~/.local/state/ask-kit/notes/*.jsonl | head -3)
```

The newest file is usually the caller's journal, which holds the `ask` record. The cells are in
the investigator's file next to it. The `select(.code)` keeps only cell records. See the
[journal reference](../reference/journal.md).

You are looking for two things. The investigator should start from `scripts.run("find-notes", ...)`
and then read the lines it cites with `notes.read`. If it writes its own search instead, the
instructions or `openWith` do not point at the script clearly enough.
[Find and fix a bad answer](debug-a-bad-answer.md) covers the full loop.

## 11. Ask three real questions and fix what fails

Pick three questions you would really ask: one about a topic, one about a decision, one that the
notes cannot answer. For each, check the answer against the note, and check that the third one
says so instead of guessing. Change one line in `instructions.md` or one script for each failure,
and ask again. Changes take effect on the next question; nothing needs restarting.

## Next

- [Add a script to a domain](add-a-script.md) adds a `tagged` script and shows how to promote
  one the investigator drafted.
- [Domains](../domains.md) covers adding a shared domain and sharing yours with a `RECIPE.md`.
- [How domains load](../internals/domains.md) describes the loader and the contract in detail.
