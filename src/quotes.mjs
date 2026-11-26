// Quoted rows: an answer that has to list rows word for word (messages, commands, a fleet's tasks)
// names each row by its id, and the host writes the row in. The investigator passes the rows it
// fetched to `quote(rows, { id, text })` in a REPL cell; the REPL keeps each row's text under its
// id in `<session>.quotes.json` beside its snapshot, and the answer carries `{{quote:<id>}}` where
// the row goes. The model writes a few characters per row instead of the row, and the row arrives
// whole. An id that matches no kept row is never filled from a guess: the API loop sends the answer
// back once to fix it, and what is still unknown is marked in the answer.
import fs from "node:fs";
import path from "node:path";
import { slug } from "./config.mjs";

export const QUOTE_MARK = /\{\{quote:([^{}\s]+)\}\}/g;
// How much of each row `quote` shows the investigator next to its marker.
const PREVIEW_CHARS = 160;

export const quotesPath = (stateDir, session) => path.join(stateDir, `${slug(session)}.quotes.json`);

/** The record a REPL saved: { session, caller, quotes: { id: text } }, or null. */
export function readQuotes(file) {
  try {
    const r = JSON.parse(fs.readFileSync(file, "utf8"));
    return r && typeof r.quotes === "object" ? r : null;
  } catch {
    return null;
  }
}

/** The ids `text` quotes, in order, each once. */
export const quotedIds = (text) => [...new Set([...String(text ?? "").matchAll(QUOTE_MARK)].map((m) => m[1]))];

/** The ids `text` quotes that `quotes` does not hold. */
export const unknownIds = (text, quotes) => quotedIds(text).filter((id) => !Object.hasOwn(quotes ?? {}, id));

/** `text` with each marker replaced by its row; an unknown id is left as a visible note. */
export function insertQuotes(text, quotes) {
  const q = quotes ?? {};
  let inserted = 0;
  const unknown = new Set();
  const out = String(text ?? "").replace(QUOTE_MARK, (_m, id) => {
    if (Object.hasOwn(q, id)) {
      inserted++;
      return q[id];
    }
    unknown.add(id);
    return `[no fetched row has id ${id}]`;
  });
  return { text: out, inserted, unknown: [...unknown] };
}

const idSafe = (v) => String(v).trim().replace(/[\s{}]+/g, "-");
const asText = (v) => (typeof v === "string" ? v : v == null ? "" : JSON.stringify(v));
const preview = (s) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > PREVIEW_CHARS ? `${t.slice(0, PREVIEW_CHARS - 1)}…` : t;
};

/**
 * The REPL's `quote` global over a store `{ id: text }`; `save()` is called after each change.
 * `quote(rows, { id, text })`: `id` and `text` are a field name or a function of the row; by default
 * the row's `id` (else q1, q2, ...) and its `text`, `content` or `message` (else the row as JSON).
 */
export function makeQuote(store, save) {
  return function quote(rows, opts = {}) {
    const list = Array.isArray(rows) ? rows : rows == null ? [] : [rows];
    const idOf = typeof opts.id === "function" ? opts.id : opts.id ? (r) => r?.[opts.id] : (r) => r?.id;
    const textOf =
      typeof opts.text === "function"
        ? opts.text
        : opts.text
          ? (r) => r?.[opts.text]
          : (r) => (typeof r === "string" ? r : r?.text ?? r?.content ?? r?.message ?? r);
    const lines = [];
    list.forEach((row, i) => {
      let id = idOf(row, i);
      if (id == null || idSafe(id) === "") {
        let n = Object.keys(store).length + 1;
        while (Object.hasOwn(store, `q${n}`)) n++;
        id = `q${n}`;
      } else id = idSafe(id);
      store[id] = asText(textOf(row, i));
      lines.push(`{{quote:${id}}} ${preview(store[id])}`);
    });
    save();
    return (
      `${lines.length} row(s) kept for quoting. Write a row's marker in your answer where the row goes, ` +
      "and the host writes the row's whole text there; do not copy the text yourself.\n" +
      lines.join("\n")
    );
  };
}
