import fs from "node:fs";
import nodePath from "node:path";
import { NOISE } from "../lib.mjs";
import { callsIn, defsIn, defsOf, enclosing, ensureMap, mapped, methodSetImplementations, namesLike, relsTo, statusLine, textHits, usesOf } from "../map.mjs";

export const meta = {
  purpose:
    "The code map, for questions about every, each or all of something: for each name, its definitions with their line ranges, what implements or extends it, its callers through several levels, every line that writes it and every use, as rows `file:line [in caller] source line`; for each line range, what it defines and what it calls. The map covers every file in the repository's languages and is brought up to date with edits before it answers; it says when it is stale or partial, and searches the files it does not cover (docs, config) with ripgrep.",
  params: {
    names: "identifiers (array, or one string); `*` matches any part of a name (`*Worker`, `retry_*`)",
    at: "line ranges, `file:from-to` (array, or one string): what is defined there and what it calls",
    callers: "levels of callers to follow, default 2 (0 for none)",
    uses: "list every use, default true",
    path: "folder whose rows to keep, optional",
    rows: "true: the same as objects ({map, names, ranges}, each row with file, line and text) instead of text",
    budget: "characters the text may take, default 3900 (a REPL result is clipped at 4000 unless the cell is sent with a larger maxChars); what does not fit is named",
    warm: "true: only bring the map up to date and say how big it is",
  },
  returns:
    "text: a `Code map:` line (tree, files, when built; then STALE or PARTIAL lines when so), `Not found` and `Not shown` lists, then per name `## name defined`, `implemented by`, `callers`, `written`, `used`, `in files the map does not cover`; per range what it defines and calls",
  example: 'await scripts.run("map", { names: ["InvoiceWorker", "retry_limit"], callers: 3 })',
};

const MAX_NAMES = 12;
const MAX_CALL_ROWS = 240;
const PROSE = /\.(md|mdx|txt|rst)$/i;
const TEST = /(^|[/_.-])(tests?|spec|fixtures?|bench)([/_.-]|$)/i;
const ORDER = { call: 0, write: 0, read: 0, key: 1, import: 2, string: 3, comment: 4 };
const ANY_PATH = new Set(["self", "Self", "super", "crate"]);

/** Whether a use on `text` of `name` can be a use of `def`: true unless the line names `name` through
 *  a `path::` whose last segment is neither def's file (or its folder, for mod.rs, index and the like)
 *  nor def's container. */
export function reaches(text, name, def) {
  const esc = name.replace(/[$]/g, "\\$&");
  const quals = [...String(text).matchAll(new RegExp(`([A-Za-z_]\\w*)\\s*::\\s*(?:<[^>]*>\\s*::\\s*)?${esc}(?![\\w$])`, "g"))].map((m) => m[1]);
  const bare = new RegExp(`(?<![\\w$:])${esc}(?![\\w$])`).test(String(text).replace(new RegExp(`\\w+\\s*::\\s*${esc}`, "g"), ""));
  if (!quals.length || bare) return true;
  const parts = def.file.split("/");
  const stem = parts.at(-1).replace(/\.[^.]+$/, "");
  const fits = new Set([stem, ...(/^(mod|lib|main|index|__init__)$/.test(stem) && parts.length > 1 ? [parts.at(-2)] : [])]);
  if (def.container) fits.add(String(def.container).split(/::|\./).at(-1).replace(/<.*$/, ""));
  return quals.some((q) => ANY_PATH.has(q) || fits.has(q));
}

export default async function ({ repo }, { names: asked, at, callers = 2, uses = true, path, rows = false, budget = 3900, warm = false } = {}) {
  // In an ask a cell has 60 s at most: what is not read in 40 s is searched with ripgrep and read on the next call.
  const map = await ensureMap(repo.root, warm ? {} : { budgetMs: 40_000 });
  if (warm) {
    return {
      notice: `the code map of ${nodePath.basename(map.root)} is ready (${map.files.size} files): \`ask\` with about: "code" answers the callers, implementations, writers and uses of a name from it`,
      files: map.files.size,
      built: map.built,
      ms: map.ms,
      stale: map.stale.length,
      skipped: Object.keys(map.skipped).length,
    };
  }
  const rel = path ? nodePath.relative(map.root, nodePath.resolve(map.root, String(path))) : "";
  if (rel.startsWith("..") || nodePath.isAbsolute(rel)) return `The code map covers ${map.root} only; for ${path} use lookup or repo.rg with that path.`;
  const where = rel && rel !== "." ? rel : undefined;
  if (where && !fs.existsSync(nodePath.join(map.root, where))) return `NO SUCH PATH ${where} (not searched)`;
  const wanted = [];
  const expanded = [];
  for (const n of [].concat(asked ?? []).map(String).filter(Boolean)) {
    if (n.includes("*")) {
      const like = namesLike(map, n);
      expanded.push(`${n}: ${like.length ? like.join(", ") : "no name in the map matches"}`);
      wanted.push(...like);
    } else wanted.push(n.split(/::|\./).at(-1).replace(/\(\)$/, ""));
  }
  const names = [...new Set(wanted)].slice(0, MAX_NAMES);
  const ranges = [].concat(at ?? []).map(String).filter(Boolean);
  if (!names.length && !ranges.length) throw new Error("map needs `names` or `at`");
  const left = [...new Set(wanted)].slice(MAX_NAMES).map((n) => `${n}: not looked up; scripts.run("map", { names: [${JSON.stringify(n)}] })`);

  const cache = new Map();
  const lineOf = (file, line) => {
    if (!cache.has(file)) {
      let lines = [];
      try {
        lines = fs.readFileSync(nodePath.join(map.root, file), "utf8").split("\n");
      } catch {}
      cache.set(file, lines);
    }
    const t = (cache.get(file)[line - 1] ?? "").trim();
    return t.length > 200 ? `${t.slice(0, 200)}…` : t;
  };
  const qual = (d) => (d ? `${d.container ? `${d.container}.` : ""}${d.name}` : null);
  const defRow = (d) => ({ file: d.file, line: d.line, end: d.end, kind: d.kind, name: d.name, container: d.container, text: lineOf(d.file, d.line) });
  const useRow = (u) => {
    const c = enclosing(map, u.file, u.line);
    return { file: u.file, line: u.line, kind: u.kind, caller: c ? qual(c) : null, callerAt: c ? `${c.file}:${c.line}-${c.end}` : null, text: lineOf(u.file, u.line) };
  };

  // Names the map does not hold (reserved words, words with dashes) are found with ripgrep alone.
  const plain = names.filter((n) => !mapped(n));
  const inMap = names.filter((n) => mapped(n));
  const others = await textHits(repo, map, inMap, { path: where });
  for (const n of plain) others.set(n, [...(await repo.rg(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, { glob: NOISE, path: where, max: 400 }))].filter((h) => !h.context));

  const result = {};
  const missing = [];
  for (const name of names) {
    const defs = mapped(name) ? defsOf(map, name, { path: where }) : [];
    const defLines = new Set(defs.map((d) => `${d.file}:${d.line}`));
    const all = mapped(name) ? usesOf(map, name, { path: where }).filter((u) => !defLines.has(`${u.file}:${u.line}`)) : [];
    const text = others.get(name) ?? [];
    if (!defs.length && !all.length && !text.length) {
      missing.push(name);
      continue;
    }
    const impls = mapped(name) ? [...relsTo(map, name, { path: where }), ...methodSetImplementations(map, name)] : [];
    // Callers: the definitions holding each use in code, then theirs, `callers` levels deep.
    let count = 0;
    const seen = new Set(defs.map((d) => `${d.file}:${d.line}`));
    // `def`: the one definition whose callers are wanted, when several share its name. A use that
    // names its module or type (`memory::call_tool(`, `Store::open(`) is then kept only when that
    // path can lead to `def`; unqualified uses, and `self`/`super`/`crate`, are kept.
    const tree = (target, level, def = null) => {
      if (level > callers || count >= MAX_CALL_ROWS) return [];
      const own = new Set(defsOf(map, target).map((d) => `${d.file}:${d.line}`));
      const out = [];
      for (const u of usesOf(map, target, { path: where })) {
        if (own.has(`${u.file}:${u.line}`) || (u.kind !== "call" && u.kind !== "read")) continue;
        if (def && !reaches(lineOf(u.file, u.line), target, def)) continue;
        if (++count > MAX_CALL_ROWS) break;
        const row = { level, ...useRow(u), callers: [] };
        const c = enclosing(map, u.file, u.line);
        if (c) {
          const id = `${c.file}:${c.line}`;
          const same = defsOf(map, c.name).length;
          if (same > 1) row.sameName = same;
          if (!seen.has(id)) {
            seen.add(id);
            row.callers = tree(c.name, level + 1, same > 1 ? c : null);
          }
        }
        out.push(row);
      }
      return out;
    };
    const callTree = callers > 0 && mapped(name) ? tree(name, 1) : [];
    const order = (r) => (PROSE.test(r.file) ? 20 : TEST.test(r.file) ? 10 : 0) + (ORDER[r.kind] ?? 5);
    result[name] = {
      definitions: defs.map(defRow),
      implementations: impls.map((r) => ({ file: r.file, line: r.line, kind: r.kind, by: r.from, ...(r.by ? { how: r.by } : {}), text: lineOf(r.file, r.line) })),
      callers: callTree,
      callersCut: count > MAX_CALL_ROWS,
      writers: all.filter((u) => u.kind === "write" || u.kind === "key").sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "write" ? -1 : 1)).map(useRow),
      uses: uses ? all.map(useRow).sort((a, b) => order(a) - order(b)) : [],
      usesByKind: all.reduce((m, u) => ((m[u.kind] = (m[u.kind] ?? 0) + 1), m), {}),
      usesFiles: new Set(all.map((u) => u.file)).size,
      elsewhere: text.map((h) => ({ file: h.file, line: h.line, text: h.text.trim().slice(0, 200) })),
      ...(mapped(name) ? {} : { notInMap: "not an identifier the map holds (a reserved word, or not one word); found with ripgrep" }),
    };
  }

  const rangeRows = [];
  for (const ref of ranges) {
    const m = /^(.*?)(?::(\d+)(?:-(\d+))?)?$/.exec(ref);
    const file = m[1].replace(/^\.\/+/, "").replace(new RegExp(`^${map.root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/`), "");
    const from = m[2] ? Number(m[2]) : 1;
    const to = m[3] ? Number(m[3]) : m[2] ? from : Infinity;
    if (!map.files.has(file)) {
      missing.push(`${ref} (not a file the map covers)`);
      continue;
    }
    const inside = enclosing(map, file, from);
    const calls = [];
    const once = new Set();
    for (const c of callsIn(map, file, from, to)) {
      if (once.has(`${c.name}:${c.line}`)) continue;
      once.add(`${c.name}:${c.line}`);
      const targets = defsOf(map, c.name);
      const best = targets.find((d) => d.file === file) ?? targets[0];
      calls.push({ file, line: c.line, name: c.name, defined: best ? `${best.file}:${best.line}-${best.end}` : null, definitions: targets.length, text: lineOf(file, c.line) });
    }
    rangeRows.push({ ref, file, from, to: Number.isFinite(to) ? to : map.files.get(file).n, in: inside && inside.line < from ? `${qual(inside)} ${inside.line}-${inside.end}` : null, defines: defsIn(map, file, from, to).map(defRow), calls });
  }

  if (rows) return { map: statusLine(map), ...(expanded.length ? { expanded } : {}), notFound: missing, notLookedUp: left, names: result, ranges: rangeRows };

  // Text: the status and what is left out first, so a reader's own limit never cuts them.
  const notesRoom = Math.min(900, Math.floor(budget / 4));
  let room = budget - notesRoom;
  const out = [];
  const put = (t) => {
    if (t.length + 1 > room) return false;
    room -= t.length + 1;
    out.push(t);
    return true;
  };
  const rowText = (r) => `${r.file}:${r.line} ${r.caller ? `[in ${r.caller} ${r.callerAt.split(":")[1]}] ` : ""}${r.text}`;
  const share = (k) => Math.floor(room / Math.max(1, k));
  const section = (head, lines, more, shareOf) => {
    let cap = shareOf - head.length - 1;
    const block = [head];
    let n = 0;
    for (const l of lines) {
      if (l.length + 1 > cap) break;
      cap -= l.length + 1;
      block.push(l);
      n++;
    }
    if (n === 0 && lines.length) {
      if (put(head)) left.push(`${more}: ${lines.length} rows did not fit; ask for this name alone, or with rows: true`);
      return;
    }
    if (!put(block.join("\n"))) {
      left.push(`${more}: ${lines.length} rows did not fit; ask for this name alone, or with rows: true`);
      return;
    }
    if (n < lines.length) left.push(`${more}: ${lines.length - n} more rows; ask for this name alone, with path, or with rows: true`);
  };
  const present = Object.keys(result);
  // Definitions and implementations of every name first: they are short and say where to read.
  for (const name of present) {
    const r = result[name];
    if (r.definitions.length) section(`\n## ${name} defined: ${r.definitions.length}`, r.definitions.map((d) => `${d.file}:${d.line}-${d.end} ${d.kind}${d.container ? ` in ${d.container}` : ""} | ${d.text}`), `${name} definitions`, share(present.length * 3));
    if (r.implementations.length) section(`\n## ${name} implemented or extended by: ${r.implementations.length}`, r.implementations.map((i) => `${i.file}:${i.line} ${i.by} ${i.kind} ${name}${i.how ? ` (${i.how})` : ""} | ${i.text}`), `${name} implementations`, share(present.length * 2));
  }
  for (const [k, name] of present.entries()) {
    const r = result[name];
    const each = Math.max(1, (present.length - k) * 4);
    if (r.callers.length) {
      const lines = [];
      const walk = (rows, depth) => {
        for (const c of rows) {
          lines.push(`${"  ".repeat(depth)}${rowText(c)}${c.sameName ? ` (${c.sameName} definitions named ${c.caller.split(".").at(-1)}; a caller that names another module or type through a path is left out)` : ""}`);
          walk(c.callers, depth + 1);
        }
      };
      walk(r.callers, 0);
      section(`\n## ${name} callers, ${callers} level(s): each row is a use in code, indented under the use it is a caller of${r.callersCut ? `; cut at ${MAX_CALL_ROWS} rows` : ""}`, lines, `${name} callers`, share(each));
    }
    if (r.writers.length) section(`\n## ${name} written (assigned, set in a literal, inserted, updated, deleted or changed by a call): ${r.writers.length} lines`, r.writers.map(rowText), `${name} writers`, share(each - 1));
    if (r.uses.length) {
      const kinds = Object.entries(r.usesByKind).sort((a, b) => b[1] - a[1]).map(([kk, v]) => `${kk} ${v}`).join(", ");
      section(`\n## ${name} used: ${r.uses.length} lines in ${r.usesFiles} files (${kinds})`, r.uses.map((u) => `${rowText(u)}${u.kind === "string" || u.kind === "comment" ? ` (${u.kind})` : ""}`), `${name} uses`, share(each - 2));
    } else if (!uses && Object.keys(r.usesByKind).length) put(`\n## ${name} used: ${Object.values(r.usesByKind).reduce((a, b) => a + b, 0)} lines (uses: false)`);
    if (r.elsewhere.length) section(`\n## ${name} in files the map does not cover (ripgrep): ${r.elsewhere.length} lines${r.notInMap ? `; ${r.notInMap}` : ""}`, r.elsewhere.map((h) => `${h.file}:${h.line} ${h.text}`), `${name} in other files`, share(each - 3));
  }
  for (const g of rangeRows) {
    const head = `\n## ${g.file}:${g.from}-${g.to}${g.in ? ` (inside ${g.in})` : ""}: defines ${g.defines.length}, calls ${g.calls.length}`;
    const lines = [...g.defines.map((d) => `${d.file}:${d.line}-${d.end} ${d.kind} ${d.container ? `${d.container}.` : ""}${d.name}`), ...g.calls.map((c) => `${c.file}:${c.line} calls ${c.name} -> ${c.defined ?? "no definition in the map"}${c.definitions > 1 ? ` (and ${c.definitions - 1} more)` : ""} | ${c.text}`)];
    section(head, lines, `${g.ref}`, share(2));
  }
  let notes = notesRoom - 150;
  const note = (title, list, sep) => {
    if (!list.length) return [];
    let n = 0;
    for (let used = title.length; n < list.length && (used += list[n].length + sep.length) < notes; n++);
    notes -= list.slice(0, n).join(sep).length + title.length;
    return [`${title}${list.slice(0, n).join(sep)}${list.length > n ? `${n ? sep : ""}and ${list.length - n} more` : ""}`];
  };
  const status = statusLine(map);
  return [
    status + (where ? ` Rows under ${where} only.` : ""),
    ...note("Expanded: ", expanded, "; "),
    ...note("Not found (no definition or use in the map, and none in other files): ", missing, ", "),
    ...note("Not shown (the rest, and how to read it):\n- ", left, "\n- "),
    ...out,
  ].join("\n");
}
