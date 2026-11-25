import { NOISE, definitionPattern, escape, spellings } from "../lib.mjs";

export const meta = {
  purpose:
    "Everything named in a question, in one cell: for each identifier, its definitions with their numbered bodies and every use with the definition it sits in (so, what calls it); for each file named, its lines or its definitions; for each quoted text, where it occurs. Pass the question, or `names` for several identifiers together. Use it instead of where, then read, then a search for callers.",
  params: {
    question: "the question as asked; its names, files, quoted texts and folders outside the repository are found for you",
    names: "identifiers to look up (array, or one string), instead of or besides the question's",
    path: "folder to search, optional",
    budget: "characters the result may take, default 3900 (a REPL result is clipped at 4000 unless the cell is sent with a larger maxChars); what does not fit is named with the call that reads it",
  },
  returns: "text: per name, `file:from-to` with numbered lines, then uses as `file:line [in definition] text`; a 'Not shown' list says what is left and how to read it. null when the question names nothing that is in the repository",
  example: 'await scripts.run("lookup", { names: ["InvoiceWorker", "retry_limit"] })',
};

const DEF = /^\s*(?:export\s+)?(?:default\s+)?(?:pub(?:\([^)]*\))?\s+)?(?:async\s+|unsafe\s+|static\s+|abstract\s+)*(?:fn|struct|enum|trait|impl|mod|function|class|interface|type|def|func|const|let|var)\b\s*\*?\s*[\w$<]/;
// A definition that holds code: a local `let x = ...` around a use is not the caller.
const HOLDS = /^\s*(?:export\s+)?(?:default\s+)?(?:pub(?:\([^)]*\))?\s+)?(?:async\s+|unsafe\s+|static\s+)*(?:(?:fn|struct|enum|trait|impl|mod|function|class|interface|def|func)\b\s*\*?\s*[\w$<]|(?:const|let|var)\s+[\w$]+\s*=\s*(?:async\s*)?(?:function|\(.*=>|\w+\s*=>|\($))/;
const PROSE = /\.(md|mdx|txt|rst)$/i;
const TEST = /(^|[\/_.-])(tests?|spec|fixtures?|bench)([\/_.-]|$)/i;
const FILE = /(?:~?\/)?(?:[\w.@-]+\/)*[\w.@-]+\.(?:rs|mjs|cjs|jsx?|tsx?|py|go|sql|toml|ya?ml|json|sh|css|html|md|c|h|cpp|java|rb|swift|kt|lua|ml|service|timer)(?::\d+(?:-\d+)?)?(?![\w.])/g;
const MAX_NAMES = 12;

/** The identifiers, files, quoted texts and outside folders a question names, in the order it names them. */
export function named(question) {
  const q = String(question ?? "");
  const files = [...new Set(q.match(FILE) ?? [])];
  const text = files.reduce((s, f) => s.split(f).join(" "), q);
  const folders = [...new Set((text.match(/(?<![\w.~/])\/(?:[\w.@-]+\/)*[\w.@-]+/g) ?? []).map((p) => p.replace(/[.,]+$/, "")))];
  const sure = new Map();
  const add = (s, at) => s.length > 2 && !sure.has(s) && sure.set(s, at);
  for (const m of text.matchAll(/`([^`\n]+)`/g)) {
    const w = /([A-Za-z_$][\w$]*)(?:\(\))?$/.exec(m[1].trim());
    if (w && !/\s/.test(m[1])) add(w[1], m.index);
  }
  for (const m of text.matchAll(/\b(?:[A-Za-z0-9]+(?:_[A-Za-z0-9]+)+|[a-z][a-z0-9]*(?:[A-Z][A-Za-z0-9]*)+|[A-Z][a-z0-9]+(?:[A-Z][A-Za-z0-9]*)+)\b/g)) add(m[0], m.index);
  for (const m of text.matchAll(/\b([A-Za-z_$][\w$]*)\(\)/g)) add(m[1], m.index);
  for (const m of text.matchAll(/\b\w+(?:::\w+)+/g)) add(m[0].split("::").at(-1), m.index);
  const names = [...sure].sort((a, b) => a[1] - b[1]).map(([n]) => n);
  // A hyphenated word is often plain English: kept only when it has a definition.
  const maybe = [...new Set(text.match(/\b[a-z][a-z0-9]*(?:-[a-z0-9]+)+\b/g) ?? [])];
  const quotes = [...new Set([...text.matchAll(/"([^"\s][^"\n]{5,})(?<!\s)"|`([^`\s][^`\n]*\s[^`\n]*)(?<!\s)`/g)].map((m) => (m[1] ?? m[2]).replace(/\s*(\.\.\.|…)$/, "").trim()).filter((s) => s.length > 5 && !names.includes(s)))];
  return { names, maybe, files, quotes, folders };
}

const indent = (l) => /^\s*/.exec(l)[0].replace(/\t/g, "    ").length;

/** The last line (1-based) of the definition that starts on `line`, read from the indentation. */
export function bodyEnd(lines, line) {
  const base = indent(lines[line - 1]);
  let end = line;
  for (let i = line; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim()) continue;
    const t = l.trim();
    if (indent(l) > base) {
      end = i + 1;
      continue;
    }
    if (t === "{" || /^where\b/.test(t)) {
      end = i + 1;
      continue;
    }
    if (/^[)}\]]/.test(t)) {
      end = i + 1;
      if (/[{([]$|^\)\s*(->|:)/.test(t)) continue;
    }
    break;
  }
  return end;
}

/** The first line of the comments and attributes directly above `line`. */
function bodyStart(lines, line) {
  let from = line;
  while (from > 1 && /^\s*(\/\/|\/\*|\*|#\[|#(?!!)|@\w|--)/.test(lines[from - 2])) from--;
  return from;
}

export default async function ({ repo }, { question, names: asked, path, budget = 3900 }) {
  const found = named(question);
  const wanted = [...new Set([...[].concat(asked ?? []), ...found.names])];
  const names = wanted.slice(0, MAX_NAMES);
  if (!question && !names.length) throw new Error("lookup needs `question` or `names`");
  // Notes on what did not fit: whole while they fit in their part of the budget.
  const left = wanted.slice(MAX_NAMES).map((n) => `${n}: not looked up; scripts.run("lookup", { names: [${JSON.stringify(n)}] })`);
  // The repository, or `path`, and each folder outside the repository that the question names.
  const outside = [];
  for (const f of found.folders) {
    if (f === repo.root || f.startsWith(`${repo.root}/`) || repo.root.startsWith(`${f}/`)) continue;
    if (await repo.files(null, { path: f, max: 1 }).then((l) => l.length > 0, () => false)) outside.push(f);
  }
  const places = [path, ...outside];
  const problems = [];
  const search = async (pattern, o) => {
    const parts = await Promise.all(
      places.map((p) =>
        repo.rg(pattern, { glob: NOISE, max: 5000, ...o, path: p }).catch((e) => {
          problems.push(`search for ${pattern.slice(0, 80)} in ${p ?? "the repository"} failed: ${e.message.slice(0, 200)}`);
          return Object.assign([], { total: 0, complete: false });
        }),
      ),
    );
    return Object.assign(parts.flat(), { total: parts.reduce((n, h) => n + h.total, 0), complete: parts.every((h) => h.complete) });
  };
  const cache = new Map();
  const linesOf = (file) => {
    if (!cache.has(file)) {
      const out = [];
      try {
        for (let from = 1, total = 1; from <= total; from += 400) {
          const r = repo.read(file, { from });
          total = r.lines;
          out.push(...r.text.split("\n").map((l) => l.replace(/^\d+\t/, "")));
        }
      } catch {}
      cache.set(file, out);
    }
    return cache.get(file);
  };
  const numbered = (file, from, to) => linesOf(file).slice(from - 1, to).map((l, i) => `${from + i}\t${l}`).join("\n");
  const inside = (file, line) => {
    if (PROSE.test(file)) return null;
    const lines = linesOf(file);
    let at = indent(lines[line - 1] ?? "");
    for (let i = line - 2; i >= 0; i--) {
      const l = lines[i];
      if (!l.trim() || indent(l) >= at) continue;
      if (HOLDS.test(l)) return l.trim().replace(/\s*[{(=:].*$/, "").replace(/^(export |default |pub(\([^)]*\))? |async )+/, "");
      if (/^\S/.test(l) && !/^[)}\]]/.test(l)) break;
      if (!/^\s*[)}\]]/.test(l)) at = indent(l);
    }
    return null;
  };
  const notesRoom = Math.min(900, Math.floor(budget / 4));
  let room = budget - notesRoom;
  const out = [];
  const put = (text) => {
    if (text.length + 1 > room) return false;
    room -= text.length + 1;
    out.push(text);
    return true;
  };

  const look = async (name, needDef) => {
    let spelled = [name];
    let hits = await search(`\\b${escape(name)}\\b`);
    if (!hits.total) {
      spelled = spellings(name);
      if (spelled.length) hits = await search(`\\b(${spelled.map(escape).join("|")})\\b`);
    }
    if (!hits.total) return { name, none: true };
    const defs = await search(definitionPattern(spelled), { max: 200 });
    const rank = (d) => (PROSE.test(d.file) ? 2 : 0) + (TEST.test(d.file) ? 1 : 0);
    const real = [...new Map(defs.filter((d) => !PROSE.test(d.file)).map((d) => [`${d.file}:${d.line}`, d])).values()].sort((a, b) => rank(a) - rank(b));
    if (needDef && !real.length) return null;
    return { name, spelled, hits, defs: real, partial: !defs.complete };
  };
  const rows = [
    ...(await Promise.all(names.map((n) => look(n)))),
    ...(await Promise.all(found.maybe.slice(0, MAX_NAMES).map((n) => look(n, true)))),
  ].filter(Boolean);
  const missing = rows.filter((r) => r.none).map((r) => r.name);
  const known = rows.filter((r) => !r.none);

  // Bodies first, every name's best definition before any name's second; uses after.
  const shown = new Set();
  const addBody = (r, d) => {
    const lines = linesOf(d.file);
    const from = bodyStart(lines, d.line);
    const to = Math.max(d.line, bodyEnd(lines, d.line));
    const key = `${d.file}:${d.line}`;
    if (shown.has(key)) return;
    shown.add(key);
    if (!put(`\n## ${r.name} defined: ${d.file}:${from}-${to}\n${numbered(d.file, from, to)}`)) left.push(`${r.name} defined ${d.file}:${d.line} \`${d.text.trim()}\`: repo.read(${JSON.stringify(d.file)}, { from: ${from}, to: ${to} })`);
  };
  for (const r of known) if (r.defs[0]) addBody(r, r.defs[0]);
  const usesRoom = Math.floor(budget / 4);
  for (const r of known)
    for (const [i, d] of r.defs.slice(1).entries()) {
      // Further definitions leave room for the uses; past that they are a place to read.
      if (room < usesRoom) {
        left.push(`${r.name}: also defined ${r.defs.slice(i + 1, i + 7).map((x) => `${x.file}:${x.line}`).join(", ")}${r.defs.length > i + 7 ? ` and ${r.defs.length - i - 7} more` : ""}`);
        break;
      }
      addBody(r, d);
    }

  for (const r of known) {
    const defKeys = new Set(r.defs.map((d) => `${d.file}:${d.line}`));
    const order = (h) => (PROSE.test(h.file) ? 2 : TEST.test(h.file) ? 1 : 0);
    const uses = r.hits.filter((h) => !defKeys.has(`${h.file}:${h.line}`)).sort((a, b) => order(a) - order(b));
    const files = new Set(uses.map((h) => h.file));
    const head = `\n## ${r.name} used: ${uses.length}${r.hits.complete ? "" : " or more"} lines in ${files.size} files${r.spelled.length > 1 ? ` (spelled ${r.spelled.join(", ")})` : ""}${r.defs.length ? "" : "; no definition line found"}${r.partial ? "; more than 200 definition lines, some not listed" : ""}`;
    if (!uses.length) {
      put(head);
      continue;
    }
    // Uses take an even share of what is left, so one busy name does not crowd out the next.
    let share = Math.floor(room / (known.length - known.indexOf(r)));
    let n = 0;
    const block = [head];
    share -= head.length + 1;
    for (const h of uses) {
      const where = inside(h.file, h.line);
      const line = `${h.file}:${h.line} ${where ? `[in ${where}] ` : ""}${h.text.trim()}`;
      if (line.length + 1 > share) break;
      share -= line.length + 1;
      block.push(line);
      n++;
    }
    if (n === 0 || !put(block.join("\n"))) n = 0;
    if (n < uses.length) {
      const rest = Object.entries(uses.slice(n).reduce((m, h) => ((m[h.file] = (m[h.file] ?? 0) + 1), m), {})).sort((a, b) => b[1] - a[1]).map(([f, c]) => `${f} (${c})`);
      left.push(`${r.name}: ${uses.length - n} more uses, in ${rest.slice(0, 4).join(", ")}${rest.length > 4 ? ` and ${rest.length - 4} more files` : ""}`);
    }
    if (!r.hits.complete) left.push(`${r.name}: more than 5000 lines hold it; narrow with path`);
  }

  // Files the question names: the lines it names, or what the file defines.
  for (const ref of found.files) {
    const [, name, a, b] = /^(.*?)(?::(\d+)(?:-(\d+))?)?$/.exec(ref);
    const tail = name.replace(/^~?\//, "");
    let hits = [];
    if (name.startsWith("/")) hits = linesOf(name).length ? [name] : [];
    if (!hits.length)
      for (const p of places) hits.push(...(await repo.files([`**/${tail.split("/").at(-1)}`, ...NOISE], { path: p }).catch(() => [])).filter((f) => f === tail || f.endsWith(`/${tail}`)));
    if (!hits.length) {
      missing.push(ref);
      continue;
    }
    if (hits.length > 3) left.push(`${name}: ${hits.length} files have this name: ${hits.join(", ")}`);
    for (const file of hits.slice(0, 3)) {
      const lines = linesOf(file);
      if (a) {
        const from = Math.max(1, Number(a) - 15);
        const to = Math.min(lines.length, Number(b ?? a) + 25);
        if (!put(`\n## ${file}:${from}-${to}\n${numbered(file, from, to)}`)) left.push(`${file}: repo.read(${JSON.stringify(file)}, { from: ${from}, to: ${to} })`);
      } else {
        const defs = lines.flatMap((l, i) => (DEF.test(l) && indent(l) <= 4 ? [`${i + 1}\t${l}`] : []));
        if (!put(`\n## ${file}: ${lines.length} lines${defs.length ? `, its definitions\n${defs.join("\n")}` : ""}`)) left.push(`${file}: ${defs.length} definitions; scripts.run("outline", { path: ${JSON.stringify(file)} })`);
      }
    }
  }

  for (const quote of found.quotes) {
    const hits = await search(quote, { fixed: true, max: 200 });
    if (!hits.total) {
      missing.push(JSON.stringify(quote));
      continue;
    }
    const rowsOf = hits.map((h) => `${h.file}:${h.line} ${h.text.trim()}`);
    if (!put(`\n## ${JSON.stringify(quote)}: ${hits.total} lines\n${rowsOf.join("\n")}`)) left.push(`${JSON.stringify(quote)}: ${hits.total} lines; repo.rg(${JSON.stringify(quote)}, { fixed: true })`);
  }

  if (!out.length && !left.length) return null;
  const searched = `Searched: ${path ?? repo.root}${outside.length ? `, ${outside.join(", ")}` : ""}; git-ignored, generated, vendored and lock files left out.`;
  // What is left out comes first, so it is read even when a reader's own limit cuts the end.
  const note = (title, rows, sep) => {
    if (!rows.length) return [];
    let n = 0;
    for (let used = title.length; n < rows.length && (used += rows[n].length + sep.length) < notes; n++);
    notes -= rows.slice(0, n).join(sep).length + title.length + sep.length;
    const more = rows.length - n;
    return [`${title}${rows.slice(0, n).join(sep)}${more ? `${n ? sep : ""}and ${more} more: ask for fewer names at once` : ""}`];
  };
  let notes = notesRoom - searched.length - 150;
  const missed = note("Not found: ", missing, ", ");
  return [
    searched,
    ...missed,
    ...note("Problems: ", problems, "; "),
    ...note("Not shown (the rest, and how to read it):\n- ", left, "\n- "),
    ...out,
  ].join("\n");
}
