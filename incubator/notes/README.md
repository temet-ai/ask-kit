# ask-kit-notes

An [ask-kit](https://github.com/temet-ai/ask-kit) kit that lets your coding agent's `ask` tool
answer questions from your own notes: a folder of Markdown or plain text files, such as an
Obsidian vault, a Logseq graph, a `~/notes` folder or a team's decision records. A cheap model
reads the notes outside your agent's context and answers with the note's path, line and date.
When asked, it appends to a note, adds a task, ticks one off, creates a note or captures a line in
today's daily note.

It is meant to replace "second brain" and note-taking skills and agents: the scripts answer the
everyday questions in one call, and the investigator writes its own cells only for the unusual
one.

Questions it answers:

- What did I write about the clacks ledger, and when?
- What did we decide about night patrols, and why?
- What are my open tasks, and which are overdue?
- What is in yesterday's daily note?
- Which notes link to Sam Vimes?
- What did I write this week?

## Install

You need [ask-kit](https://github.com/temet-ai/ask-kit#set-it-up) 0.3 or later and Node 22.13 or
later. The kit has no dependencies and runs no programs: it reads files.

Paste this into your agent:

```
Read ~/.config/ask-kit/AGENTS.md, then add this kit: github.com/temet-ai/ask-kit-notes
```

Or run it yourself:

```sh
ask-kit kit install temet-ai/ask-kit-notes        # shows what it reads, changes and runs
ask-kit kit install temet-ai/ask-kit-notes --yes  # installs and enables it
```

Then say where the notes are, and restart your agents so `ask` lists `notes`. `ask-kit kit list`
says so when the folder is not set.

## Settings

| Setting | Default | What it is |
|---|---|---|
| `NOTES_DIR` | none, required | the folder that holds the notes. There is no default, because guessing someone's notes folder is wrong |
| `NOTES_DAILY` | found from the folder | where daily notes live and how they are named, such as `daily/YYYY-MM-DD.md`. Found from `.obsidian/daily-notes.json`, else from notes named like dates, else a Logseq `journals/` folder |
| `NOTES_PRIVATE_TAGS` | `private,secret` | tags that make a note private |
| `WORKDIR` | the folder the agent runs in | what a relative `NOTES_DIR` or `vault` is resolved against |

Set them in the environment or in ask-kit's config as `domains.notes.settings.NOTES_DIR`.

## What it understands

It reads Markdown without a Markdown library: YAML front matter (`title`, `tags`, `aliases`,
`date`, `created`, `updated`, `private`), headings, `[[wiki links]]` with `|alias` and `#heading`,
`![[embeds]]`, Markdown links to other notes, `#tags` and nested tags `#a/b`, tasks (`- [ ]`,
`- [x]`, `- [-]`) with Obsidian Tasks dates (`📅 2026-11-08`, `due:: 2026-11-08`, `✅`), Logseq
`TODO` and `DONE` blocks with `DEADLINE:` and `key:: value` properties, and dates in file names.
Fenced code blocks and inline code are skipped for tags, links and tasks.

A note's date comes from its front matter or its file name. A note that states no date gets the
file's time, and every result marks that as `dateFrom: "file time"`.

The first question indexes the folder; the index is kept under ask-kit's state folder, keyed by
path, size and modified time, so later questions read only new and changed notes. Measured on a
generated vault of 10,000 notes (2.8 million words) on a Linux machine on 2026-11-21: the first
index took 1.0 to 1.2 s. After that, a new process opened the index and built the link graph in
0.26 to 0.37 s; a running investigator re-checked the folder for changes in 0.11 s per question
and then answered tasks, tags, links and dates in 1 to 40 ms. The searches that read every note's
text (`find`, `decided`, `grep`) added 0.07 to 0.23 s.

## What stays out

A notes folder holds secrets too, and what the investigator reads goes to a model. Never opened:

- folders whose name starts with a dot (`.obsidian` with its plugin data, `.trash`, `.git`,
  `.logseq`), `node_modules` and `logseq/bak`;
- attachments: any file that is not `.md`, `.markdown` or `.txt`. They are counted;
- files and folders named like credentials, by the dotfiles kit's globs: `*token*`, `*secret*`,
  `*credential*`, `*passw*`, `*cookie*`, `*.env`, `*.pem`, `*.key`, `id_rsa*`, `id_ed25519*`,
  `oauth*`, `auth.json`, `hosts.yml`. A note called `Secret Santa.md` is left out by this rule;
  rename it or accept that;
- symbolic links, and notes larger than 2 MB.

Private notes are counted and named by title, and nothing else: a note whose front matter says
`private: true`, or that carries a tag listed in `NOTES_PRIVATE_TAGS` (a nested tag such as
`#private/health` counts). Their text is never searched, quoted or edited, their tasks and
decisions are not listed, and a link from one shows as a title only.

On every line the kit returns, the value after `password:`, `token:`, `api key:`, `secret:` and
the like is replaced by `[redacted]`, as are tokens of a known shape (`sk-`, `ghp_`, `AKIA`, JWTs),
the password in a URL and the body of a private key. This is a net, not a guarantee: it does not
know a password written as plain prose. Mark such notes `private: true`.

The kit reads `.obsidian/daily-notes.json` itself, for the daily note folder and format. Nothing
else in `.obsidian` is opened.

## What it can change

Only when the caller asked for a change (`act`):

- `append`: adds text to a note, under a heading when one is named (made at the end when absent);
- `task`: adds an open task in the note's own style, under its Tasks heading when it has one;
- `check`: ticks one open task, named by its line or its text. When several tasks match, it
  changes nothing and lists them;
- `create`: makes a new note. It refuses when the note exists;
- `capture`: adds a line with the time to today's daily note, making the note when it is absent.

An edit adds lines or changes the one task line. It keeps the file's line endings and front
matter and never reorders a note. Private notes, dot folders, credential-named files and paths
outside the notes folder are refused. The kit deletes nothing and renames nothing.

## How well it works

The bench, `bench/questions.json`, holds 14 shots (a script and its params, no model) against
`bench/fixture/vault`, a small Obsidian-style vault of made-up Discworld notes, each with patterns
its output must match. `ask-kit kit test notes` on 2026-11-21: 14/14, all answered with no model.
No model run has been made yet: the bench has no questions for a model, because those come only
from real sessions and none were at hand.

## What is in it

`notes.mjs` gives the investigator the `notes` global: `index`, `find`, `grep`, `note`,
`backlinks`, `links`, `tags`, `tagged`, `tasks`, `recent`, `daily`, `dailies`, `unresolved`,
`orphans`, `hubs`, `decisions`, `at` (the same over another folder) and the five acting calls
above. Its scripts are `find` (what the notes say about something), `decided` (decisions on a
topic with the reason lines near them), `tasks` (open tasks, overdue first, by due date or by
note), `recent` (what was written or changed since a time, by day), `links` (a note's backlinks,
outgoing links and links to notes that do not exist), `daily` (a day's daily note, or the days of
a range), `tags` (the tags with counts, or the notes of one tag) and `overview` (the vault in
numbers, its orphans and missing notes). Two questions are answered with no model at all: "what
are my open tasks" and "what is in today's daily note". [RECIPE.md](RECIPE.md) says what it reads,
and how to rebuild it.

MIT licence.
