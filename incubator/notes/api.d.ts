// notes: the user's own notes, a folder of Markdown or plain text files (NOTES_DIR). Paths are relative to it.
// Lines are 1-based. Dates are YYYY-MM-DD. A note's date comes from its front matter (date, created) or its
// file name; a note that says nothing has dateFrom "file time".
// Never read: .obsidian, .trash, .git and other dot folders, attachments, files named like credentials.
// Private notes (front matter `private: true`, or a tag of NOTES_PRIVATE_TAGS) are named by title only.
// Every `today` option is the date to count from (default the machine's date).

interface Row { path: string; title: string; date: string; dateFrom?: "file time" }
interface Passage { line: number; heading: string | null; text: string }
interface Task { path: string; line: number; text: string; done: boolean; cancelled?: true; due?: string; overdue?: true; scheduled?: string; doneOn?: string; tags?: string[]; heading: string | null; noteDate: string }
// A time: a date, "today", "yesterday", "week" (since Monday), "month", or a span back: "7d", "2w", "3m".
type When = string;
interface Filter { tag?: string; in?: string; since?: When; until?: When; today?: string; max?: number }
interface Changed { changed: boolean; path: string; line?: number; added?: number; under?: string | null; headingMade?: boolean; created?: true; why?: string; now?: string }

declare const notes: {
  root: string; // absolute path of the notes folder

  // The vault in numbers: notes, words, tags, links, tasks, where daily notes live, the private notes by title,
  // and what is left out. index.read is how many notes were read this time; the rest came from the saved index.
  index(): { root: string; notes: number; words: number; tags: number; links: number; unresolvedLinks: number;
    tasks: { open: number; done: number; cancelled: number }; dailyNotes: { pattern: string; from: string; count: number };
    oldest: string | null; newest: string | null; private: { count: number; titles: string[]; why: string };
    leftOut: { attachments: number; credentialNamed: number; hiddenFolders: string[]; tooBig: string[] };
    index: { file: string; read: number; reused: number; ms: number } };

  // Notes holding the words, best first: a match in the title, file name or an alias, then in a heading, then in
  // the text; rare words weigh more; a note that lacks a word ranks far lower and says so in `missing`; newest
  // first within equal rank. A word of four letters or more also matches with a short ending ("patrol" finds
  // "patrols"); a shorter word matches whole. max default 6 notes, passages default 2 lines per note.
  find(words: string, o?: Filter & { passages?: number }): { words: string[]; notes: (Row & { score: number; matched: ("title" | "heading" | "body")[];
    missing?: string[]; tags?: string[]; passages: Passage[] })[]; total: number; withEveryWord: number; leftOut?: number; searched: number;
    privateNotesWithTheWordInTheirTitle?: string[] };

  // Lines matching a regular expression (ignoring case unless ignoreCase: false). For what find cannot say:
  // a phrase ("home by six"), a pattern ("WATCH-\\d+"). max default 40.
  grep(pattern: string | RegExp, o?: Filter & { ignoreCase?: boolean }): { hits: { path: string; line: number; date: string; heading: string | null; text: string }[];
    total: number; complete: boolean; searched: number };

  // One note by title, alias, file name or path, the way a wiki link finds it: exact first, then a substring.
  // matchedBy says which ("path", "file name", "title", "alias", "substring"); alsoMatched lists the others.
  // text is numbered "N\tline": whole lines up to `chars` characters (default 2600, so the result fits a cell;
  // `more` says how to read on) and `max` lines (default 120); `heading` gives one section; from/to a range.
  // A missing note is {found: false, near}. A private note is {found: true, private: true, title}.
  note(name: string, o?: { heading?: string; from?: number; to?: number; max?: number; chars?: number }): {
    found: boolean; private?: true; path?: string; title?: string; matchedBy?: string; alsoMatched?: string[]; near?: string[];
    date?: string; dateFrom?: string; modified?: string; aliases?: string[]; tags?: string[]; properties?: Record<string, string>;
    words?: number; headings?: string[] /* "12 ## Facts" */; tasks?: { open: number; done: number };
    links?: { out: number; in: number }; section?: string; lines?: number; from?: number; to?: number; more?: string; text?: string; error?: string };

  // The notes that link to a note, with the line of each link. fromPrivateNotes holds titles only.
  backlinks(name: string, o?: { max?: number }): { found: boolean; note?: Row; matchedBy?: string; near?: string[];
    backlinks?: (Row & { line: number; heading: string | null; embed?: true; text: string })[]; total?: number; leftOut?: number; fromPrivateNotes?: string[] };

  // What a note links to. resolved is the note's path, or null for a note that does not exist (also in `unresolved`).
  links(name: string, o?: { max?: number }): { found: boolean; note?: Row; matchedBy?: string; near?: string[];
    links?: { line: number; target: string; resolved: string | null; private?: true; title?: string; heading?: string; shownAs?: string; embed?: true; text: string }[];
    total?: number; unresolved?: string[]; leftOut?: number };

  // Every tag with the number of notes carrying it; a nested tag a/b also counts for a. max default 60.
  tags(o?: { max?: number }): { tags: { tag: string; notes: number }[]; total: number; leftOut?: number };
  // The notes carrying a tag or a tag nested under it, newest first. `near` lists tags like it when none match.
  tagged(tag: string, o?: { max?: number }): { tag: string; notes: (Row & { tags: string[] })[]; total: number; leftOut?: number; privateNotes?: number; near?: string[] };

  // Tasks: `- [ ]`, `- [x]`, `- [-]` (cancelled) and Logseq TODO, DOING, DONE, with due dates (📅, due::, DEADLINE).
  // open: true open only, false done only, omitted both. due: "overdue", "today", "week" (within 7 days, overdue
  // included), "none", a date (due on or before it), or {after, before}. tag matches the task's or the note's tags.
  // Sorted: overdue, then by due date, then undated (newest note first), then done. Counts cover all; max default 60.
  tasks(o?: { open?: boolean; due?: string | { after?: When; before?: When }; tag?: string; note?: string; today?: string; max?: number }): {
    today: string; note?: Row; matchedBy?: string; found?: false; near?: string[]; tasks: Task[]; total: number; open: number; overdue: number; done: number; leftOut?: number };

  // Notes created or changed from `since` (default "7d") to `until` (default today), newest first.
  // created: true keeps new notes only. dateFrom "file time" marks a date the note itself does not state.
  recent(o?: { since?: When; until?: When; created?: boolean; today?: string; max?: number }): { since: string; until: string;
    notes: { path: string; title: string; day: string; what: "created" | "changed"; created?: string; dateFrom?: "file time"; words: number; tags?: string[] }[];
    total: number; leftOut?: number; privateNotes?: number };

  // A day's daily note: `date` is a date, "today" (default) or "yesterday". When there is none: exists false,
  // where it would be, and the nearest days that have one.
  daily(date?: When, o?: { today?: string; max?: number; chars?: number }): { date: string; weekday: string; exists: boolean; private?: true; path?: string; words?: number;
    tags?: string[]; tasks?: { open: number; done: number }; openTasks?: { line: number; text: string; due?: string }[]; links?: string[]; lines?: number; more?: string; text?: string;
    expectedAt?: string; pattern?: string; patternFrom?: string; nearest?: { before: string | null; after: string | null } };
  // The daily notes of a range, oldest first, without their text.
  dailies(o?: { since?: When; until?: When; today?: string; max?: number }): { since: string; until: string; pattern: string;
    days: { date: string; weekday?: string; path?: string; words?: number; headings?: string[]; tasksOpen?: number; tasksDone?: number; links?: string[]; private?: true }[]; total: number; leftOut?: number };

  // Links to notes that do not exist, most wanted first, with where each link is.
  unresolved(o?: { max?: number }): { unresolved: { target: string; count: number; from: { path: string; line: number }[] }[]; total: number; leftOut?: number };
  // Notes nothing links to, newest first. Daily notes are left out.
  orphans(o?: { max?: number }): { orphans: (Row & { linksOut: number })[]; total: number; leftOut?: number };
  // The notes most linked to.
  hubs(o?: { max?: number }): { path: string; title: string; linkedFrom: number }[];

  // Decisions: a "Decision", "Decided" or "Outcome" heading, a line saying "decided", "we will", "agreed",
  // "going with", and decision records (ADR-n files, a decisions folder), each with the reason lines near it
  // ("because", "so that", a Why, Rationale or Context section). With a topic, every word must be in the note;
  // decisions that hold the words themselves come first, then newest first. max default 10.
  decisions(topic?: string, o?: Filter): { topic: string[]; decisions: (Row & { status?: string; line: number; heading: string | null; decision: string;
    reasons: { line: number; text: string; under?: string }[]; reasonIsOnTheLine?: true; topicIsIn?: string })[]; total: number; leftOut?: number; searched: number };

  // The same functions over another notes folder (relative to the caller's folder): notes.at("docs/adr").decisions()
  at(dir: string): typeof notes;

  // ---- these change notes: they work only when the caller asked for a change (act) ----
  // Each keeps the file's line endings and front matter, adds lines without moving any, and returns the lines
  // as they are now in `now`. A name that matches no note is an error naming near ones; a private note is refused.

  // Add text to a note: under a heading when given (exact, then substring; made as "## heading" at the end
  // when absent), else at the end.
  append(name: string, text: string, o?: { under?: string }): Changed;
  // Make a new note (".md" is added). Refuses when the note exists. tags go in front matter.
  create(name: string, text?: string, o?: { folder?: string; tags?: string[] | string }): Changed & { sameNameAs?: string[] };
  // Add an open task in the note's own style, under its Tasks heading when it has one (or `under`).
  task(name: string, text: string, o?: { under?: string; due?: When; today?: string }): Changed & { task: string };
  // Tick one open task: by line number, or by text (exact, then substring). When several tasks match, nothing
  // changes and `candidates` lists them: call again with a line.
  check(name: string, task: string | number): Changed & { task?: string; matchedTaskBy?: string; candidates?: { line: number; text: string }[]; openTasks?: { line: number; text: string }[] };
  // Add "- HH:MM text" to today's daily note, making the note when it is not there.
  capture(text: string, o?: { today?: string; time?: string; under?: string }): Changed & { date: string };
};
