# Recipe: the notes kit

## What it answers

From a person's own notes, a folder of Markdown or plain text files (an Obsidian vault, a Logseq
graph, a notes folder, a team's decision records): what was written about something and when,
what was decided and why, which tasks are open, overdue or done, what a day's daily note holds,
what was written or changed since a time, which notes link to a note or carry a tag, which links
point at notes that do not exist and which notes nothing links to. With `act`, it appends to a
note, adds a task, ticks one off, creates a note and captures a line in today's daily note.

## What it needs

- ask-kit 0.3 or later (`min_ask_kit = "0.3.0"`) and Node 22.13 or later. No dependencies, no
  programs, no network.
- `NOTES_DIR`, the folder that holds the notes. It is required and has no default.
- Optional: `NOTES_DAILY` (where daily notes live, such as `daily/YYYY-MM-DD.md`; found from the
  folder when unset), `NOTES_PRIVATE_TAGS` (default `private,secret`), `WORKDIR` (detected: what a
  relative folder is resolved against).

## What it reads and runs

It runs nothing. It reads the `.md`, `.markdown` and `.txt` files under `NOTES_DIR`, and
`.obsidian/daily-notes.json` for the daily note folder and format. It writes one index file per
vault under `<ask-kit state>/notes/`, named after the folder and a hash of its path: per note the
title, aliases, tags, links, tasks, headings, dates and word count, keyed by size and modified
time. A private note's headings and tasks are not stored there, and the index is rebuilt when
`NOTES_PRIVATE_TAGS` changes.

Never opened: folders whose name starts with a dot, `node_modules`, `logseq/bak`, symbolic links,
files of any other type, notes over 2 MB, and files or folders named like credentials (`*token*`,
`*secret*`, `*credential*`, `*passw*`, `*cookie*`, `*.env`, `*.pem`, `*.key`, `id_rsa*`,
`id_ed25519*`, `oauth*`, `auth.json`, `hosts.yml`). Notes with `private: true` in their front
matter or a private tag are counted and named by title only. Returned lines have credential
values redacted.

With `act` it writes inside `NOTES_DIR` only: lines added to an existing note, one task line
ticked, a new note (never over an existing one), a new daily note.

## Brief to rebuild it from an empty folder

Make a folder with `ask-kit.toml` (id `temet.notes`, name `notes`, `says`, `keywords`,
`route_hint`, `cite`, `instructions = "instructions.md"`, `acts` listing `notes.append`,
`notes.create`, `notes.task`, `notes.check`, `notes.capture`, the four settings above with
`NOTES_DIR` marked `required`, one `[[sources]]` of kind `module`, name `notes`, module
`notes.mjs`, api `api.d.ts`, and two `[[actions]]`: `tasks` for "what are my open tasks" and
`daily` for "what is in today's daily note").

A `folder` source was considered for search, reads and edits and left out: its `exclude` takes
globs only, so it cannot hide a note whose front matter says `private: true` or that carries a
private tag, and its `rg`, `read`, `find` and `outline` would quote those notes. The module does
its own search, and its own edits so that a private note is refused and line endings are kept.

`notes.mjs` exports `make({settings, push, act})` returning the `notes` global.

- `parseNote(text)` reads one note line by line with no Markdown library: narrow YAML front matter
  (`key: value`, `key: [a, b]`, `key:` with `- item` lines), Logseq page properties
  (`key:: value` before any other text), headings, wiki links with `|alias` and `#heading`,
  embeds, Markdown links to notes (URLs, anchors and attachments skipped), `#tags` (a number is
  not a tag; link targets are blanked first), tasks (`[ ]`, `[x]`, `[-]`, Logseq `TODO`, `DOING`,
  `DONE`, `CANCELED`) with due, scheduled and done dates from the task line or the `DEADLINE:` and
  `SCHEDULED:` lines under it, and the word count. Fenced code, inline code, `%%comments%%` and
  HTML comments are skipped for tags, links, tasks and headings.
- The index: walk the folder with the exclusions above, reuse a saved record when the size and
  modified time match, parse the rest, save when anything changed. Calls less than 1.5 s apart
  share one walk; every acting call drops it.
- A note's date is its front matter `date` or `created`, else a date in its file name, else the
  file's time, marked `dateFrom: "file time"`.
- Names resolve the way a wiki link does: a path, a file name (the shortest path wins, the same
  folder first for a link), a title or alias; for a name the caller gives, then a substring.
  `matchedBy` says which.
- Daily notes: a pattern of `YYYY`, `MM`, `DD` and friends becomes a regex and a path maker. A
  folder segment is a date only when it is all tokens, so `Daily/` keeps its D.
- Reading functions: `index`, `find` (title, file name and alias matches weigh 8, headings 4, the
  text by the root of the count, each times the word's rarity, the whole times the square of the
  share of words found; newest first within equal rank), `grep`, `note` (numbered text, whole
  lines within a character budget), `backlinks`, `links`, `tags`, `tagged`, `tasks`, `recent`,
  `daily`, `dailies`, `unresolved`, `orphans`, `hubs`, `decisions` (a Decision or Outcome heading
  with the section's first lines; a line saying "decided to", "we will", "agreed to", "going
  with"; a decision record by its path; reasons are lines with "because", "so that" and the like,
  and the first lines of a Why, Rationale, Context or Consequences section) and `at(dir)`.
- Acting functions, built only when `act` is true, else throwing `not in this ask: ...`:
  `append`, `create`, `task`, `check`, `capture`. A file is split into lines with each line's own
  ending kept, lines are inserted, and the file is written back, so nothing else changes.
- `safe(line)` redacts credential values on every returned line; private key bodies are blanked
  when a file is split into lines.

`fit.mjs` shortens a script result's lists from the end until the result is under 3600
characters, and says how many rows it cut: ask-kit clips a cell's output at 4000.

Scripts in `scripts/` (each `export const meta = {purpose, params, returns, example}` and
`export default async function ({notes}, params)`; each takes `vault` for another folder, and
`today` where dates are compared): `find`, `decided`, `tasks`, `recent`, `links`, `daily`,
`tags`, `overview`. Each returns a one-line `verdict` first, then the counts, then the lists.

`instructions.md` has the docker kit's structure: how to work (scripts first; read around a line
before answering why; say which note a substring matched; file-time dates are marked; a decision
is what the note states as decided; private notes are named, never quoted; act on exactly what
was asked and report the lines as they are now) and the answer format (the answer first, each
fact with the note's path, line and date).

`bench/fixture/vault` is a small Obsidian-style vault of made-up Discworld notes (Sam Vimes's
working notes on the Watch): people with aliases, two cases, two decision records, four daily
notes with dates in their names, tasks open and done with due dates, nested tags, one link to a
note that does not exist, an embed, a code block holding a `#tag`, a `[[link]]` and a task that
must not count, one note with `private: true`, one with a private tag, a credential-named file,
a note in `.trash`, plugin data in `.obsidian` and an attachment.

## Bench

Run it from the kit's folder, because the fixture path is relative, and with `NOTES_DIR` set,
because the kit is not offered without it:

```sh
NOTES_DIR=bench/fixture/vault ask-kit kit test notes
```

All 14 questions are shots (`do`) with `vault` and `today` fixed in their params, so the bench
calls no model, costs nothing and does not depend on the clock, on the machine or on your own
notes. Questions for a model (`q`) are still to be added from real sessions: the times an agent
searched a notes folder by hand. `ask` with the sessions kit can list them.

## Results

ask-kit `kit test` on 2026-11-21: 14/14, all answered with no model. No model run yet.
