// The code map's reader of one file: every identifier with its line and the kind of use it is
// (a call, a write, a key, an import, a read, or a word in a string or a comment), and the
// definitions with the line each one ends on. A small lexer per language family tells comments and
// strings from code; brackets, or indentation for Python, Ruby and Lua, give the spans.
//
// There is no parser here and no dependency. Every identifier a word search (rg -w) finds in a
// mapped file is kept, whatever the lexer makes of the line around it, so a lexer mistake can give
// a use the wrong kind or a definition the wrong end, but it cannot drop a use. A file whose braces
// do not balance is marked (`u`), and its definitions end where their indentation does.
import path from "node:path";
import { bodyEnd } from "./lib.mjs";

/** Bumped when what a scan writes changes; maps written by another version are rebuilt. */
export const SCAN_VERSION = 2;

export const LANGS = {
  js: [".js", ".mjs", ".cjs", ".jsx"],
  ts: [".ts", ".tsx", ".mts", ".cts"],
  rust: [".rs"],
  go: [".go"],
  python: [".py", ".pyi"],
  java: [".java"],
  kotlin: [".kt", ".kts"],
  scala: [".scala"],
  swift: [".swift"],
  c: [".c", ".h"],
  cpp: [".cc", ".cpp", ".cxx", ".hpp", ".hh", ".hxx"],
  csharp: [".cs"],
  php: [".php"],
  dart: [".dart"],
  ruby: [".rb"],
  lua: [".lua"],
  sh: [".sh", ".bash", ".zsh"],
  sql: [".sql"],
};
const LANG_OF = Object.fromEntries(Object.entries(LANGS).flatMap(([l, exts]) => exts.map((e) => [e, l])));
/** The language the map reads a file as, from its extension, or null when the map does not cover it. */
export const langOf = (file) => LANG_OF[path.extname(String(file)).toLowerCase()] ?? null;
/** Every extension the map covers. */
export const MAPPED_EXTS = Object.keys(LANG_OF);

// How a use is stored: line * 8 + kind. A file's uses are `xn`, its names, and `xc`, one string
// holding each name's codes in the same order, `;` between names, each code after the first as the
// difference from the one before (a large map stays small in memory; decodeUses reads one name).
export const KINDS = ["read", "call", "write", "key", "import", "string", "comment"];
const READ = 0, CALL = 1, WRITE = 2, KEY = 3, IMPORT = 4, STRING = 5, COMMENT = 6;
// How a definition is stored: [name, line, end, kind index, container].
export const DEF_KINDS = ["function", "method", "class", "interface", "trait", "struct", "enum", "variant", "impl", "type", "const", "var", "field", "module", "macro", "object", "table", "view", "column", "index", "procedure", "trigger"];
const K = Object.fromEntries(DEF_KINDS.map((k, i) => [k, i]));
// How a relation is stored: [kind index, from, to, line]: `from` implements or extends `to`.
export const REL_KINDS = ["implements", "extends"];
// Definitions that hold code, so a use inside one has it as its caller.
export const CALLABLE = new Set(["function", "method", "macro", "procedure", "trigger"]);
// Definitions other definitions sit in (a method's class, a field's struct).
const CONTAINERS = new Set(["class", "interface", "trait", "struct", "enum", "impl", "object", "module", "type", "table"]);

// Reserved words of the covered languages that are never anything else. They are not stored; a
// question about one of them is answered by ripgrep (src: domains/code/map.mjs `mapped`).
export const STOP = new Set(
  ("if else for while do return function const let var break continue switch case try catch finally throw new this true false null undefined " +
    "typeof instanceof void fn impl pub mut mod crate struct enum trait where loop elif def lambda pass raise None True False and or not is in " +
    "func chan defer goto package range self Self extends implements import export from as async await yield static super with except global nonlocal assert del").split(" "),
);

const LEX = {
  js: { slash: true, block: true, dq: 1, sq: 1, template: true, regex: true },
  ts: { slash: true, block: true, dq: 1, sq: 1, template: true, regex: true },
  rust: { slash: true, block: true, nested: true, dq: 2, rustRaw: true, rustChar: true },
  go: { slash: true, block: true, dq: 1, sq: 1, rawTick: true },
  java: { slash: true, block: true, dq: 1, sq: 1, triple: true },
  kotlin: { slash: true, block: true, nested: true, dq: 1, sq: 1, triple: true },
  scala: { slash: true, block: true, nested: true, dq: 1, sq: 1, triple: true },
  swift: { slash: true, block: true, nested: true, dq: 1, triple: true },
  c: { slash: true, block: true, dq: 1, sq: 1 },
  cpp: { slash: true, block: true, dq: 1, sq: 1 },
  csharp: { slash: true, block: true, dq: 1, sq: 1 },
  php: { slash: true, block: true, hash: true, dq: 2, sq: 2 },
  dart: { slash: true, block: true, dq: 1, sq: 1, triple: true },
  python: { hash: true, dq: 1, sq: 1, triple: true, pyPrefix: true },
  ruby: { hash: true, dq: 2, sq: 2, rubyBlock: true },
  lua: { dash: true, luaLong: true, dq: 1, sq: 1 },
  sh: { hash: "word", dq: 2, sq: 3 },
  sql: { dash: true, block: true, sq: 4 },
};

const isIdStart = (c) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 36;
const isIdChar = (c) => isIdStart(c) || (c >= 48 && c <= 57);
const REGEX_AFTER = new Set("(,=:[!&|?{};+-*%<>~^".split("").map((c) => c.charCodeAt(0)));
const REGEX_WORDS = new Set(["return", "typeof", "case", "do", "else", "in", "of", "new", "delete", "void", "throw", "yield", "await"]);

/**
 * The text with comments and string contents blanked (newlines and quote marks kept), and the
 * blanked regions in order as parallel arrays: start, end (exclusive), kind (STRING or COMMENT).
 */
export function lex(text, lang) {
  const o = LEX[lang] ?? {};
  const n = text.length;
  const m = new Uint16Array(n);
  for (let i = 0; i < n; i++) m[i] = text.charCodeAt(i);
  const rs = [], re = [], rk = [];
  const blank = (a, b, kind) => {
    if (b <= a) return;
    for (let k = a; k < b; k++) if (m[k] !== 10) m[k] = 32;
    rs.push(a);
    re.push(b);
    rk.push(kind);
  };
  const at = (i) => text.charCodeAt(i);
  const eol = (i) => {
    const e = text.indexOf("\n", i);
    return e === -1 ? n : e;
  };
  // A quoted string from the quote at i: content blanked, the quotes kept. Returns the index after it.
  const quoted = (i, q, multi, escapes, doubled = false) => {
    let j = i + 1;
    while (j < n) {
      const c = at(j);
      if (escapes && c === 92) {
        j += 2;
        continue;
      }
      if (c === q) {
        if (doubled && at(j + 1) === q) {
          j += 2;
          continue;
        }
        break;
      }
      if (c === 10 && !multi) break;
      j++;
    }
    blank(i + 1, Math.min(j, n), STRING);
    return j < n && at(j) === q ? j + 1 : j;
  };
  const tripleEnd = (i, q) => {
    let j = i + 3;
    while (j < n && !(at(j) === q && at(j + 1) === q && at(j + 2) === q)) j += at(j) === 92 ? 2 : 1;
    blank(i + 3, Math.min(j, n), STRING);
    return Math.min(n, j + 3);
  };

  let lastSig = 0;
  let lastWord = "";
  // Code from i; with `untilClose`, stops at the `}` that closes a template's `${` and returns its index.
  const run = (i, untilClose) => {
    let depth = 0;
    while (i < n) {
      const c = at(i);
      if (c === 10 || c === 32 || c === 9 || c === 13) {
        i++;
        continue;
      }
      if (untilClose) {
        if (c === 123) depth++;
        else if (c === 125) {
          if (depth === 0) return i;
          depth--;
        }
      }
      const c1 = at(i + 1);
      if (o.slash && c === 47 && c1 === 47) {
        const e = eol(i);
        blank(i, e, COMMENT);
        i = e;
        continue;
      }
      if (o.block && c === 47 && c1 === 42) {
        let j = i + 2, d = 1;
        while (j < n && d > 0) {
          if (at(j) === 42 && at(j + 1) === 47) {
            d--;
            j += 2;
          } else if (o.nested && at(j) === 47 && at(j + 1) === 42) {
            d++;
            j += 2;
          } else j++;
        }
        blank(i, Math.min(j, n), COMMENT);
        i = j;
        continue;
      }
      if (o.hash && c === 35) {
        const prev = i === 0 ? 10 : at(i - 1);
        if (o.hash !== "word" || prev === 10 || prev === 32 || prev === 9 || prev === 59 || prev === 124 || prev === 38 || prev === 40) {
          const e = eol(i);
          blank(i, e, COMMENT);
          i = e;
          continue;
        }
      }
      if (o.rubyBlock && c === 61 && (i === 0 || at(i - 1) === 10) && text.startsWith("=begin", i)) {
        const e = text.indexOf("\n=end", i);
        const end = e === -1 ? n : eol(e + 1);
        blank(i, end, COMMENT);
        i = end;
        continue;
      }
      if (o.dash && c === 45 && c1 === 45) {
        // Lua's --[[ ... ]] and --[==[ ... ]==]; otherwise to the end of the line.
        const long = o.luaLong && /^\[(=*)\[/.exec(text.slice(i + 2, i + 12));
        if (long) {
          const close = `]${long[1]}]`;
          const e = text.indexOf(close, i);
          const end = e === -1 ? n : e + close.length;
          blank(i, end, COMMENT);
          i = end;
          continue;
        }
        const e = eol(i);
        blank(i, e, COMMENT);
        i = e;
        continue;
      }
      if (o.luaLong && c === 91 && (c1 === 91 || c1 === 61)) {
        const long = /^\[(=*)\[/.exec(text.slice(i, i + 10));
        if (long) {
          const close = `]${long[1]}]`;
          const e = text.indexOf(close, i);
          const end = e === -1 ? n : e + close.length;
          blank(i + long[0].length, e === -1 ? n : e, STRING);
          i = end;
          lastSig = 93;
          continue;
        }
      }
      if (c === 34 || c === 39 || c === 96) {
        if (c === 96 && o.template) {
          // A JS template: text blanked, `${ ... }` read as code (its `${` and `}` blanked too).
          let j = i + 1, seg = j;
          while (j < n) {
            const d = at(j);
            if (d === 92) {
              j += 2;
              continue;
            }
            if (d === 96) break;
            if (d === 36 && at(j + 1) === 123) {
              blank(seg, j + 2, STRING);
              const close = run(j + 2, true);
              if (close < n) m[close] = 32;
              j = close + 1;
              seg = j;
              continue;
            }
            j++;
          }
          blank(seg, Math.min(j, n), STRING);
          i = Math.min(n, j + 1);
          lastSig = 96;
          continue;
        }
        if (c === 96 && o.rawTick) {
          const e = text.indexOf("`", i + 1);
          const end = e === -1 ? n : e;
          blank(i + 1, end, STRING);
          i = Math.min(n, end + 1);
          lastSig = 96;
          continue;
        }
        if (c === 39 && o.rustChar) {
          const ch = /^'(?:\\(?:[nrt0\\'"]|x[0-9a-fA-F]{2}|u\{[0-9a-fA-F]{1,6}\})|[^\\'\n])'/.exec(text.slice(i, i + 12));
          if (ch) {
            blank(i + 1, i + ch[0].length - 1, STRING);
            i += ch[0].length;
            lastSig = 39;
            continue;
          }
          // A lifetime ('a): code.
          i++;
          continue;
        }
        if (o.triple && (c === 34 || c === 39) && c1 === c && at(i + 2) === c) {
          i = tripleEnd(i, c);
          lastSig = c;
          continue;
        }
        const mode = c === 34 ? o.dq : c === 39 ? o.sq : 0;
        if (mode) {
          // 1: one line, escapes; 2: several lines, escapes; 3: several lines, no escapes; 4: SQL ('' inside).
          i = quoted(i, c, mode >= 2, mode <= 2, mode === 4);
          lastSig = c;
          continue;
        }
        i++;
        lastSig = c;
        continue;
      }
      if (o.regex && c === 47 && c1 !== 42 && c1 !== 47 && (lastSig === 0 || REGEX_AFTER.has(lastSig) || REGEX_WORDS.has(lastWord))) {
        // A regular expression literal, which never crosses a line; anything else is a division.
        let j = i + 1, cls = false, ok = false;
        while (j < n) {
          const d = at(j);
          if (d === 10) break;
          if (d === 92) {
            j += 2;
            continue;
          }
          if (d === 91) cls = true;
          else if (d === 93) cls = false;
          else if (d === 47 && !cls) {
            ok = true;
            break;
          }
          j++;
        }
        if (ok) {
          blank(i + 1, j, STRING);
          i = j + 1;
          while (i < n && isIdChar(at(i))) i++;
          lastSig = 47;
          lastWord = "";
          continue;
        }
      }
      if (isIdStart(c)) {
        let j = i + 1;
        while (j < n && isIdChar(at(j))) j++;
        const w = text.slice(i, j);
        // Rust raw strings: r"..", r#".."#, br"..".
        if (o.rustRaw && (w === "r" || w === "br" || w === "cr") && (at(j) === 34 || at(j) === 35)) {
          let k = j, hashes = 0;
          while (at(k) === 35) {
            k++;
            hashes++;
          }
          if (at(k) === 34) {
            const close = `"${"#".repeat(hashes)}`;
            const e = text.indexOf(close, k + 1);
            const end = e === -1 ? n : e;
            blank(i, k, STRING);
            blank(k + 1, end, STRING);
            i = e === -1 ? n : e + close.length;
            lastSig = 34;
            continue;
          }
        }
        // Python string prefixes (r"..", f"..", rb"..") are blanked with the string.
        if (o.pyPrefix && /^(?:[rRbBuUfF]|[rR][bBfF]|[bBfF][rR])$/.test(w) && (at(j) === 34 || at(j) === 39)) {
          blank(i, j, STRING);
          i = j;
          continue;
        }
        lastWord = w;
        lastSig = c;
        i = j;
        continue;
      }
      if (c >= 48 && c <= 57) {
        // A number: digits, letters (0x1F, 1e9, 10u32) and dots.
        let j = i + 1;
        while (j < n && (isIdChar(at(j)) || at(j) === 46)) j++;
        lastSig = 48;
        lastWord = "";
        i = j;
        continue;
      }
      lastSig = c;
      lastWord = "";
      i++;
    }
    return i;
  };
  run(0, false);
  return { mask: new TextDecoder("utf-16le").decode(m), rs, re, rk };
}

function lineStarts(text) {
  const s = [0];
  for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) s.push(i + 1);
  return s;
}
// The 1-based line holding offset `at`.
function lineAt(starts, at) {
  let lo = 0, hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= at) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

const CONTROL = new Set(
  "if else for while switch catch try finally do with match loop return case default function new typeof sizeof await yield throw delete select defer go foreach using lock fixed synchronized when unless until elif except assert in of and or not is as constructor super this".split(" "),
);
const FAMILY = {
  js: "js", ts: "js", rust: "rust", go: "go",
  java: "gen", kotlin: "gen", scala: "gen", swift: "gen", c: "gen", cpp: "gen", csharp: "gen", php: "gen", dart: "gen",
  sh: "sh",
};

// The last segment of a type name, without generics: `crate::jobs::Job<T>` -> Job.
function baseName(s) {
  let t = String(s).trim();
  for (let k = 0; k < 6 && /<[^<>]*>|\[[^[\]]*\]/.test(t); k++) t = t.replace(/<[^<>]*>|\[[^[\]]*\]/g, "");
  t = t.replace(/\(.*$/, "").replace(/^(?:public|private|protected|internal|virtual|dyn|impl|&|'\w+|\s|mut\b)+/g, "").trim();
  const parts = t.split(/::|\.|\\/).map((x) => x.trim()).filter(Boolean);
  const last = parts.at(-1) ?? "";
  return /^[A-Za-z_]\w*$/.test(last) ? last : null;
}
const listNames = (s) => String(s ?? "").split(/,|\+|\bwith\b/).map(baseName).filter(Boolean);
const noGenerics = (s) => {
  let t = s.replace(/->/g, "→").replace(/=>/g, "⇒");
  for (let k = 0; k < 6 && /<[^<>(){};]*>/.test(t); k++) t = t.replace(/<[^<>(){};]*>/g, (g) => " ".repeat(g.length));
  return t.replace(/→/g, "->").replace(/⇒/g, "=>");
};

// ---- what a `{` opens, from the text before it ----
//
// Each returns null (nothing known) or { name?, at? (index of the name in `c`), kind?, ctx, container?, rels? }.
// `ctx` is what the block holds: fn (code), class, object, interface, enum, struct, impl, trait, top, block.

function jsHeader(c, ctx) {
  let m;
  const inBody = ctx === "class" || ctx === "object" || ctx === "interface";
  if ((m = /(?:^|[^\w$.])(?:(?:export\s+)?(const|let|var)\s+)?([A-Za-z_$][\w$]*)\s*(?:\??:\s*[^=]*?)?[:=]\s*(?:async\s+)?function\b[^]*$/d.exec(c)))
    return { name: m[2], at: m.indices[2][0], kind: m[1] || !inBody ? "function" : "method", ctx: "fn" };
  if ((m = /(?:^|[^\w$])(?:(?:module\.)?exports|([A-Za-z_$][\w$]*)\.prototype|this)\.([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:function\b[^]*|\([^]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)\s*$/d.exec(c)))
    return { name: m[2], at: m.indices[2][0], kind: m[1] ? "method" : "function", container: m[1], ctx: "fn" };
  if ((m = /(?:^|[^\w$.])(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*(?:<[^]*>)?\s*\([^]*\)\s*(?::[^]*)?$/d.exec(c)))
    return { name: m[1], at: m.indices[1][0], kind: "function", ctx: "fn" };
  if ((m = /(?:^|[^\w$.])(?:(?:export\s+)?(const|let|var)\s+)?([A-Za-z_$][\w$]*)\s*(?:\??:\s*[^=]*?)?[:=]\s*(?:async\s+)?(?:\([^]*\)|[A-Za-z_$][\w$]*)\s*(?::\s*[^=]*?)?=>\s*$/d.exec(c)))
    return { name: m[2], at: m.indices[2][0], kind: m[1] || !inBody ? "function" : "method", ctx: "fn" };
  // `export default function (...)`: the module's default export, named `default`.
  if ((m = /(?:^|[^\w$.])export\s+(default)\s+(?:async\s+)?function\s*\*?\s*\([^]*\)\s*(?::[^]*)?$/d.exec(c))) return { name: m[1], at: m.indices[1][0], kind: "function", ctx: "fn" };
  if (/(?:^|[^\w$])function\s*\*?\s*\([^]*\)\s*(?::[^]*)?$/.test(c) || /=>\s*$/.test(c)) return { ctx: "fn" };
  if ((m = /(?:^|[^\w$.])(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)([^]*)$/d.exec(c)) || (m = /(?:^|[^\w$.])([A-Za-z_$][\w$]*)\s*=\s*class\b([^]*)$/d.exec(c))) {
    const rest = noGenerics(m[2]);
    const rels = [];
    const ext = /\bextends\s+([A-Za-z_$][\w$.]*)/.exec(rest);
    if (ext && baseName(ext[1])) rels.push(["extends", baseName(ext[1])]);
    const imp = /\bimplements\s+([^]*)$/.exec(rest);
    if (imp) for (const t of listNames(imp[1])) rels.push(["implements", t]);
    return { name: m[1], at: m.indices[1][0], kind: "class", ctx: "class", rels };
  }
  if ((m = /(?:^|[^\w$.])(?:export\s+)?(?:declare\s+)?interface\s+([A-Za-z_$][\w$]*)([^]*)$/d.exec(c))) {
    const ext = /\bextends\s+([^]*)$/.exec(noGenerics(m[2]));
    return { name: m[1], at: m.indices[1][0], kind: "interface", ctx: "interface", rels: ext ? listNames(ext[1]).map((t) => ["extends", t]) : [] };
  }
  if ((m = /(?:^|[^\w$.])(?:export\s+)?(?:declare\s+)?(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)\s*$/d.exec(c))) return { name: m[1], at: m.indices[1][0], kind: "enum", ctx: "enum" };
  if ((m = /(?:^|[^\w$.])(?:export\s+)?(?:declare\s+)?(?:namespace|module)\s+([A-Za-z_$][\w$.]*)\s*$/d.exec(c))) return { name: m[1], at: m.indices[1][0], kind: "module", ctx: "top" };
  if ((m = /(?:^|[^\w$.])(?:export\s+)?(?:declare\s+)?type\s+([A-Za-z_$][\w$]*)\s*(?:<[^]*>)?\s*=\s*$/d.exec(c))) return { name: m[1], at: m.indices[1][0], kind: "type", ctx: "interface" };
  if ((m = /(?:^|[^\w$.])(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]*)?=\s*(?:Object\.freeze\(\s*)?$/d.exec(c))) return { name: m[1], at: m.indices[1][0], kind: "const", ctx: "object" };
  if (inBody && (m = /^\s*(?:(?:public|private|protected|static|readonly|override|abstract|async|get|set|declare|accessor)\s+|\*\s*)*#?([A-Za-z_$][\w$]*)\s*\??\s*(?:<[^]*>)?\s*\([^]*\)\s*(?::[^]*)?$/d.exec(c)) && !CONTROL.has(m[1]))
    return { name: m[1], at: m.indices[1][0], kind: "method", ctx: "fn" };
  if (inBody && (m = /^\s*(?:(?:public|private|protected|static|readonly|override|abstract|async|get|set|declare|accessor)\s+|\*\s*)*(constructor)\s*\([^]*\)\s*$/d.exec(c)))
    return { name: m[1], at: m.indices[1][0], kind: "method", ctx: "fn" };
  if (/(?:[=:(,[?]|\breturn|\|\||&&|\?\?)\s*$/.test(c) || !c.trim()) return { ctx: "object" };
  return null;
}

function rustHeader(c, ctx) {
  let m;
  const pub = "(?:pub(?:\\s*\\([^)]*\\))?\\s+)?";
  if ((m = new RegExp(`(?:^|[^\\w])${pub}(?:default\\s+)?(?:(?:const|async|unsafe|extern(?:\\s*"[^"]*")?)\\s+)*fn\\s+([A-Za-z_]\\w*)[^]*$`, "d").exec(c)))
    return { name: m[1], at: m.indices[1][0], kind: ctx === "impl" || ctx === "trait" ? "method" : "function", ctx: "fn" };
  if ((m = /(?:^|[^\w])(?:unsafe\s+)?impl\b([^]*)$/d.exec(c))) {
    let rest = m[1].trim();
    if (rest.startsWith("<")) {
      let d = 0, k = 0;
      for (; k < rest.length; k++) {
        if (rest[k] === "<") d++;
        else if (rest[k] === ">" && rest[k - 1] !== "-" && --d === 0) break;
      }
      rest = rest.slice(k + 1);
    }
    rest = noGenerics(rest).replace(/\bwhere\b[^]*$/, "");
    const f = /^\s*!?\s*([^]*?)\s+for\s+([^]*)$/.exec(rest);
    const type = baseName(f ? f[2] : rest);
    if (!type) return { ctx: "impl" };
    const trait = f ? baseName(f[1]) : null;
    const at = m.indices[1][0] + m[1].lastIndexOf(type);
    return { name: type, at, kind: "impl", ctx: "impl", rels: trait ? [["implements", trait]] : [], trait };
  }
  if ((m = new RegExp(`(?:^|[^\\w])${pub}(?:unsafe\\s+)?(?:auto\\s+)?(struct|enum|union|trait)\\s+([A-Za-z_]\\w*)([^]*)$`, "d").exec(c))) {
    const kind = m[1] === "union" ? "struct" : m[1];
    const sup = kind === "trait" ? /^\s*(?:<[^]*?>)?\s*:\s*([^]*?)(?:\bwhere\b|$)/.exec(noGenerics(m[3])) : null;
    return { name: m[2], at: m.indices[2][0], kind, ctx: kind, rels: sup ? listNames(sup[1]).map((t) => ["extends", t]) : [] };
  }
  if ((m = new RegExp(`(?:^|[^\\w])${pub}mod\\s+([A-Za-z_]\\w*)\\s*$`, "d").exec(c))) return { name: m[1], at: m.indices[1][0], kind: "module", ctx: "top" };
  if ((m = /macro_rules!\s*([A-Za-z_]\w*)\s*$/d.exec(c))) return { name: m[1], at: m.indices[1][0], kind: "macro", ctx: "block" };
  if (ctx === "enum" && (m = /^\s*([A-Za-z_]\w*)\s*$/d.exec(c))) return { name: m[1], at: m.indices[1][0], kind: "variant", ctx: "struct" };
  if (/\|[^|]*\|\s*(?:->\s*[^{]*)?$|\|\|\s*$|\basync\s+(?:move\s*)?$/.test(c)) return { ctx: "fn" };
  if (/(?:[=(,[]|\breturn)\s*[A-Za-z_][\w:]*\s*$/.test(c)) return { ctx: "object" };
  return null;
}

function goHeader(c, ctx) {
  let m;
  if ((m = /(?:^|[^\w])func\s*(?:\(\s*(?:[A-Za-z_]\w*\s+)?\*?\s*([A-Za-z_][\w.]*)(?:\[[^\]]*\])?\s*\)\s*)?([A-Za-z_]\w*)\s*(?:\[[^\]]*\])?\s*\([^]*$/d.exec(c)))
    return { name: m[2], at: m.indices[2][0], kind: m[1] ? "method" : "function", container: m[1] ? baseName(m[1]) : undefined, ctx: "fn" };
  if (/(?:^|[^\w])func\s*\([^]*$/.test(c)) return { ctx: "fn" };
  if ((m = /(?:^|[^\w])type\s+([A-Za-z_]\w*)\s*(?:\[[^\]]*\])?\s+(struct|interface)\s*$/d.exec(c)) || (ctx === "group-type" && (m = /^\s*([A-Za-z_]\w*)\s*(?:\[[^\]]*\])?\s+(struct|interface)\s*$/d.exec(c))))
    return { name: m[1], at: m.indices[1][0], kind: m[2], ctx: m[2] };
  if (/\b(struct|interface)\s*$/.test(c)) return { ctx: /struct\s*$/.test(c) ? "struct" : "interface" };
  if (/[\w\]]\s*$/.test(c) && !/^\s*(if|for|switch|select|else|go|defer)\b|\b(else|if|for|switch|select)\b[^]*$/.test(c)) return { ctx: "object" };
  return null;
}

function genHeader(c, ctx, lang) {
  let m;
  if ((m = /(?:^|[^\w])(?:(?:public|private|protected|internal|static|final|abstract|sealed|open|data|partial|export|inline|value|annotation|inner|enum|case|fileprivate|readonly)\s+)*(class|interface|struct|enum|record|trait|object|protocol|extension|namespace|union)\s+([A-Za-z_]\w*)([^]*)$/d.exec(c))) {
    const kind = { record: "class", object: "class", protocol: "interface", extension: "impl", namespace: "module", union: "struct" }[m[1]] ?? m[1];
    const rest = noGenerics(m[3]).replace(/^\s*\([^)]*\)/, "");
    const rels = [];
    const ext = /\bextends\s+([^]*?)(?:\bimplements\b|\bwith\b|$)/.exec(rest);
    if (ext) for (const t of listNames(ext[1])) rels.push(["extends", t]);
    const withs = /\bwith\s+([^]*?)(?:\bimplements\b|$)/.exec(rest);
    if (withs) for (const t of listNames(withs[1])) rels.push(["extends", t]);
    const imp = /\bimplements\s+([^]*)$/.exec(rest);
    if (imp) for (const t of listNames(imp[1])) rels.push(["implements", t]);
    const colon = /^\s*:\s*([^]*?)(?:\bwhere\b|$)/.exec(rest);
    if (colon) for (const t of listNames(colon[1].replace(/\b(public|private|protected|virtual)\b/g, ""))) rels.push([kind === "interface" ? "extends" : "implements", t]);
    return { name: m[2], at: m.indices[2][0], kind, ctx: kind === "module" ? "top" : "class", rels };
  }
  if ((m = /(?:^|[^\w])(?:fun|func|def|function)\s+(?:<[^>]*>\s*)?(?:([A-Za-z_]\w*)\.)?([A-Za-z_]\w*)\s*(?:<[^]*>)?\s*\([^]*$/d.exec(c)))
    return { name: m[2], at: m.indices[2][0], kind: ctx === "class" ? "method" : "function", container: m[1], ctx: "fn" };
  if ((ctx === "top" || ctx === "class") && (m = /(?:^|[\s*&:~>])(?:([A-Za-z_]\w*)::)?(~?[A-Za-z_]\w*)\s*\((?:[^()]|\([^()]*\))*\)\s*(?:const\s*|noexcept\s*|override\s*|final\s*|throws\s+[\w.,\s]+|->\s*[^{]*|:\s*[^{]*)*$/d.exec(c)) && !CONTROL.has(m[2].replace(/^~/, "")) && !/\bnew\s+$/.test(c.slice(0, m.indices[2][0])))
    return { name: m[2], at: m.indices[2][0], kind: ctx === "class" || m[1] ? "method" : "function", container: m[1], ctx: "fn" };
  if (/(?:->|=>)\s*$/.test(c)) return { ctx: "fn" };
  if (/(?:[=(,[]|\breturn)\s*$/.test(c)) return { ctx: "object" };
  return null;
}

function shHeader(c) {
  const m = /(?:^|[\s;])(?:function\s+)?([A-Za-z_]\w*)\s*\(\s*\)\s*$/d.exec(c) ?? /(?:^|[\s;])function\s+([A-Za-z_]\w*)\s*$/d.exec(c);
  return m ? { name: m[1], at: m.indices[1][0], kind: "function", ctx: "fn" } : null;
}

const HEADERS = { js: jsHeader, rust: rustHeader, go: goHeader, gen: genHeader, sh: shHeader };

// ---- definitions without braces, one per line, by what the line sits in ----

const P = "(?:pub(?:\\s*\\([^)]*\\))?\\s+)?";
// `const send = async (n) => ...` with no braces: a function, at the top or inside another one.
const JS_ARROW = [/^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]*)?=\s*(?:async\s+)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=]*)?=>/d, 1, "function"];
const LINE_RULES = {
  js: {
    fn: [JS_ARROW],
    block: [JS_ARROW],
    top: [
      JS_ARROW,
      [/^\s*(?:export\s+)?(?:declare\s+)?(const)\s+([A-Za-z_$][\w$]*)\s*(?:[:=]|$)/d, 2, "const"],
      [/^\s*(?:export\s+)?(?:declare\s+)?(?:let|var)\s+([A-Za-z_$][\w$]*)\s*(?:[:=;]|$)/d, 1, "var"],
      [/^\s*(?:export\s+)?(?:declare\s+)?type\s+([A-Za-z_$][\w$]*)\b[^=]*=/d, 1, "type"],
      [/^\s*(?:export\s+)?(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*[(<]/d, 1, "function"],
      [/^\s*(?:module\.)?exports\.([A-Za-z_$][\w$]*)\s*=/d, 1, "const"],
      [/^\s*(?:export\s+)?(?:declare\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/d, 1, "class"],
      [/^\s*(?:export\s+)?(?:declare\s+)?interface\s+([A-Za-z_$][\w$]*)/d, 1, "interface"],
      [/^\s*(?:export\s+)?(?:declare\s+)?(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)/d, 1, "enum"],
    ],
    any: [[/^\s*([A-Za-z_$][\w$]*)\.prototype\.([A-Za-z_$][\w$]*)\s*=/d, 2, "method", 1]],
    class: [[/^\s*(?:(?:public|private|protected|static|readonly|declare|override|abstract|accessor)\s+)*#?([A-Za-z_$][\w$]*)\s*[?!]?\s*(?::[^=;(]*)?(?:=(?![=>])|;|$)/d, 1, "field"]],
    interface: [
      [/^\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)\s*\??\s*[(<]/d, 1, "method"],
      [/^\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)\s*\??\s*:/d, 1, "field"],
    ],
    enum: [[/^\s*([A-Za-z_$][\w$]*)\s*(?:=|,|$)/d, 1, "variant"]],
  },
  rust: {
    top: [
      [new RegExp(`^\\s*${P}(?:const|static)\\s+(?:mut\\s+)?([A-Za-z_]\\w*)\\s*:`, "d"), 1, "const"],
      [new RegExp(`^\\s*${P}type\\s+([A-Za-z_]\\w*)`, "d"), 1, "type"],
      [new RegExp(`^\\s*${P}(?:struct|union)\\s+([A-Za-z_]\\w*)`, "d"), 1, "struct"],
      [new RegExp(`^\\s*${P}enum\\s+([A-Za-z_]\\w*)`, "d"), 1, "enum"],
      [new RegExp(`^\\s*${P}trait\\s+([A-Za-z_]\\w*)`, "d"), 1, "trait"],
      [new RegExp(`^\\s*${P}(?:default\\s+)?(?:(?:const|async|unsafe|extern(?:\\s*"[^"]*")?)\\s+)*fn\\s+([A-Za-z_]\\w*)`, "d"), 1, "function"],
      [new RegExp(`^\\s*${P}mod\\s+([A-Za-z_]\\w*)\\s*;`, "d"), 1, "module"],
      [/^\s*macro_rules!\s*([A-Za-z_]\w*)/d, 1, "macro"],
    ],
    struct: [[new RegExp(`^\\s*${P}([A-Za-z_]\\w*)\\s*:(?!:)`, "d"), 1, "field"]],
    enum: [[/^\s*([A-Za-z_]\w*)\s*(?:[,({=]|$)/d, 1, "variant"]],
  },
  go: {
    top: [
      [/^(?:var|const)\s+([A-Za-z_]\w*)/d, 1, "var"],
      [/^type\s+([A-Za-z_]\w*)/d, 1, "type"],
      [/^func\s*(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*[([]/d, 1, "function"],
    ],
    "group-const": [[/^\s*([A-Za-z_]\w*)\b/d, 1, "const"]],
    "group-var": [[/^\s*([A-Za-z_]\w*)\b/d, 1, "var"]],
    "group-type": [[/^\s*([A-Za-z_]\w*)\s*(?:\[[^\]]*\])?\s+\S/d, 1, "type"]],
    struct: [[/^\s*([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s+(?:\*|\[|map\b|chan\b|func\b|struct\b|interface\b|[A-Za-z_])/d, 1, "field"]],
    interface: [[/^\s*([A-Za-z_]\w*)\s*\(/d, 1, "method"]],
  },
  gen: {
    top: [
      [/^\s*#\s*define\s+([A-Za-z_]\w*)/d, 1, "macro"],
      [/^\s*typedef\b[^;]*?\b([A-Za-z_]\w*)\s*;\s*$/d, 1, "type"],
      [/^\s*(?:(?:public|private|internal|export|const|val|var|let)\s+)+([A-Za-z_]\w*)\s*(?:[:=;]|$)/d, 1, "const"],
    ],
    class: [
      [/^\s*(?:@\w+(?:\([^)]*\))?\s+)*(?:(?:public|private|protected|internal|static|final|readonly|const|volatile|transient|override|lateinit|open|abstract|val|var|let)\s+)+(?:[\w<>[\],.?\s]+?\s+)??([A-Za-z_]\w*)\s*(?:[:=;]|$)/d, 1, "field"],
      [/^\s*(?:[\w<>[\],.?@]+\s+)+([A-Za-z_]\w*)\s*\([^)]*\)\s*(?:throws\s+[\w.,\s]+)?;\s*$/d, 1, "method"],
    ],
  },
};

const IMPORT_LINE = /^\s*(?:import\b|export\s+(?:\*|\{[^}]*\}?)\s*(?:as\s+\w+\s+)?from\b|export\s+\{|(?:pub(?:\([^)]*\))?\s+)?use\s|from\s+[\w.]+\s+import\b|#\s*include\b|extern\s+crate\b|require\s|using\s+[\w.]+\s*;|package\s+[\w.]+)/;

/** Read one file: { n: lines, d: definitions, r: relations, xn: names, xc: their uses (see KINDS), u?: 1 when its brackets do not balance }. */
export function scanFile(text, lang) {
  const { mask, rs, re, rk } = lex(text, lang);
  const starts = lineStarts(text);
  const nLines = starts.length;
  const maskLines = mask.split("\n");
  const defs = [];
  const rels = [];
  let unbalanced = false;
  // Per line (1-based): the frame it starts in and the bracket depth there.
  const frameAt = new Array(nLines + 2);
  const depthAt = new Int32Array(nLines + 2);

  const fam = FAMILY[lang];
  const header = HEADERS[fam];
  if (header) {
    const top = { open: 0, kind: "top", sep: 0, def: null };
    const stack = [top];
    let line = 1;
    frameAt[1] = top;
    const containerOf = () => {
      for (let k = stack.length - 1; k >= 0; k--) if (stack[k].def && (CONTAINERS.has(DEF_KINDS[stack[k].def[3]]) || stack[k].kind === "object")) return stack[k].def[0];
      return "";
    };
    for (let i = 0; i < mask.length; i++) {
      const c = mask.charCodeAt(i);
      if (c === 10) {
        line++;
        frameAt[line] = stack.at(-1);
        depthAt[line] = stack.length - 1;
        continue;
      }
      if (c === 123) {
        const f = stack.at(-1);
        const from = Math.max(f.sep, i - 2000);
        const head = mask.slice(from, i);
        const parts = head.split("\n");
        let d = null;
        // The shortest run of lines before the brace that reads as a definition (signatures span lines).
        for (let k = 1; k <= Math.min(10, parts.length) && !d?.name; k++) {
          const cand = parts.slice(-k).join(" ");
          const got = header(cand, f.kind, lang);
          if (got?.name) d = { ...got, at: from + head.length - cand.length + got.at };
          else if (k === 1) d = got;
        }
        if (!d && !head.trim()) d = { ctx: f.kind === "paren" ? "object" : "block" };
        const frame = { open: 123, kind: d?.ctx ?? "block", sep: i + 1, def: null };
        if (d?.name) {
          const kind = K[d.kind] ?? K.function;
          frame.def = [d.name, lineAt(starts, d.at), 0, kind, d.container ?? containerOf()];
          for (const [rk, to] of d.rels ?? []) rels.push([REL_KINDS.indexOf(rk), d.name, to, frame.def[1]]);
        }
        stack.push(frame);
        continue;
      }
      if (c === 125) {
        if (stack.length > 1 && stack.at(-1).open === 123) {
          const f = stack.pop();
          if (f.def) {
            f.def[2] = line;
            defs.push(f.def);
          }
        } else if (stack.length > 1) {
          // A `}` closing brackets left open: close them with it.
          while (stack.length > 1 && stack.at(-1).open !== 123) stack.pop();
          if (stack.length > 1) {
            const f = stack.pop();
            if (f.def) {
              f.def[2] = line;
              defs.push(f.def);
            }
          }
          unbalanced = true;
        } else unbalanced = true;
        stack.at(-1).sep = i + 1;
        continue;
      }
      if (c === 40 || c === 91) {
        const f = stack.at(-1);
        const kw = c === 40 && fam === "go" ? /^\s*(const|var|type)\s*$/.exec(mask.slice(Math.max(f.sep, i - 40), i)) : null;
        stack.push({ open: c, kind: kw ? `group-${kw[1]}` : "paren", sep: i + 1, def: null });
        continue;
      }
      if (c === 41 || c === 93) {
        if (stack.length > 1 && stack.at(-1).open !== 123) stack.pop();
        else if (fam !== "sh") unbalanced = true;
        continue;
      }
      if (c === 59) {
        stack.at(-1).sep = i + 1;
        continue;
      }
      if (c === 44) {
        const f = stack.at(-1);
        // A comma ends a part in a list; in code and type bodies it may be inside generics.
        if (f.kind === "object" || f.kind === "enum" || f.kind === "struct" || f.kind === "paren" || f.kind === "interface" || f.kind.startsWith("group-")) f.sep = i + 1;
      }
    }
    if (stack.length > 1) unbalanced = true;
    while (stack.length > 1) {
      const f = stack.pop();
      if (f.def) {
        f.def[2] = nLines;
        defs.push(f.def);
      }
    }
    // Definitions with no braces, by the frame their line starts in.
    const rules = LINE_RULES[fam] ?? {};
    const seen = new Set(defs.map((d) => `${d[0]}:${d[1]}`));
    for (let L = 1; L <= nLines; L++) {
      const f = frameAt[L] ?? top;
      const kind = f.kind;
      const set = [...(rules[kind === "module" ? "top" : kind] ?? []), ...(rules.any ?? [])];
      if (!set.length) continue;
      const text0 = maskLines[L - 1];
      if (!text0 || !text0.trim()) continue;
      for (const [re, g, dk, cg] of set) {
        const mm = re.exec(text0);
        if (!mm || CONTROL.has(mm[g]) || STOP.has(mm[g])) continue;
        if (fam === "js" && kind === "class" && /^\s*(?:get|set|static|async)\s*$/.test(text0)) continue;
        // Go: `a, b int` defines both fields.
        const names = String(mm[g]).split(",").map((s) => s.trim()).filter((s) => /^[A-Za-z_]\w*$/.test(s));
        for (const name of names) {
          if (seen.has(`${name}:${L}`)) continue;
          seen.add(`${name}:${L}`);
          // The statement ends where the bracket depth comes back to the line's own.
          let end = L;
          while (end < nLines && depthAt[end + 1] > depthAt[L] && end - L < 2000) end++;
          const container = cg ? mm[cg] : f.def && CONTAINERS.has(DEF_KINDS[f.def[3]]) ? f.def[0] : "";
          defs.push([name, L, end, K[dk], container]);
        }
        break;
      }
      // Go: an interface's embedded interface is a relation.
      if (fam === "go" && kind === "interface" && f.def) {
        const emb = /^\s*([A-Za-z_][\w.]*)\s*$/.exec(text0);
        if (emb && baseName(emb[1])) rels.push([REL_KINDS.indexOf("extends"), f.def[0], baseName(emb[1]), L]);
      }
    }
    if (unbalanced) {
      const lines = text.split("\n");
      for (const d of defs) d[2] = Math.max(d[1], bodyEnd(lines, d[1]));
    }
  } else if (lang === "python" || lang === "ruby" || lang === "lua") indentDefs(lang, maskLines, defs, rels, depthAt);
  else if (lang === "sql") sqlDefs(mask, starts, defs);

  defs.sort((a, b) => a[1] - b[1] || b[2] - a[2]);
  const byName = uses(text, mask, maskLines, starts, rs, re, rk);
  const xn = [...byName.keys()];
  const xc = [...byName.values()].map((codes) => codes.map((c, i) => (i ? c - codes[i - 1] : c)).join(",")).join(";");
  return { n: nLines, d: defs, r: rels, xn, xc, ...(unbalanced ? { u: 1 } : {}) };
}

// Python, Ruby and Lua: a definition runs while the lines below it are indented more.
function indentDefs(lang, maskLines, defs, rels, depthAt) {
  const width = (l) => {
    let w = 0;
    for (const ch of l) {
      if (ch === " ") w++;
      else if (ch === "\t") w += 8 - (w % 8);
      else break;
    }
    return w;
  };
  const open = [];
  let lastCode = 0;
  // Bracket depth at the start of each line: a line inside brackets continues the one before.
  for (let L = 1, depth = 0; L <= maskLines.length; L++) {
    depthAt[L] = depth;
    const l = maskLines[L - 1];
    for (let k = 0; k < l.length; k++) {
      const c = l.charCodeAt(k);
      if (c === 40 || c === 91 || c === 123) depth++;
      else if ((c === 41 || c === 93 || c === 125) && depth > 0) depth--;
    }
  }
  const close = (L, indent, endWord) => {
    while (open.length && open.at(-1).indent >= indent) {
      const o = open.pop();
      o.def[2] = endWord && o.indent === indent ? L : Math.max(o.def[1], lastCode);
      defs.push(o.def);
    }
  };
  const rules =
    lang === "python"
      ? [
          [/^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/d, "function"],
          [/^\s*class\s+([A-Za-z_]\w*)\s*(?:\(([^]*)\))?\s*:/d, "class"],
        ]
      : lang === "ruby"
        ? [
            [/^\s*def\s+(?:self\.)?([A-Za-z_]\w*)/d, "function"],
            [/^\s*class\s+([A-Z]\w*)(?:\s*<\s*([\w:]+))?/d, "class"],
            [/^\s*module\s+([A-Z]\w*)/d, "module"],
          ]
        : [[/^\s*(?:local\s+)?function\s+(?:([A-Za-z_]\w*)[.:])?([A-Za-z_]\w*)\s*\(/d, "function"]];
  for (let L = 1; L <= maskLines.length; L++) {
    const l = maskLines[L - 1];
    const startDepth = depthAt[L];
    if (!l.trim() || startDepth > 0) {
      if (l.trim()) lastCode = L;
      continue;
    }
    const indent = width(l);
    const endWord = lang !== "python" && /^\s*end\b/.test(l);
    close(L, indent, endWord);
    if (endWord) {
      lastCode = L;
      continue;
    }
    let matched = false;
    for (const [re, kind] of rules) {
      const m = re.exec(l);
      if (!m) continue;
      const nameIdx = lang === "lua" ? 2 : 1;
      const inClass = open.some((o) => DEF_KINDS[o.def[3]] === "class");
      const container = lang === "lua" ? m[1] ?? "" : [...open].reverse().find((o) => CONTAINERS.has(DEF_KINDS[o.def[3]]))?.def[0] ?? "";
      const k2 = kind === "function" && (inClass || (lang === "lua" && m[1])) ? "method" : kind;
      const def = [m[nameIdx], L, L, K[k2], container];
      if (kind === "class" && m[2]) for (const b of listNames(m[2].replace(/\b\w+\s*=[^,]*/g, ""))) rels.push([REL_KINDS.indexOf("extends"), m[1], b, L]);
      open.push({ indent, def });
      matched = true;
      break;
    }
    if (!matched) {
      // Module-level names (and class attributes in Python): `NAME = ...`, `NAME: T = ...`.
      const top = open.at(-1);
      const atTop = !open.length && indent === 0;
      const inClassBody = lang === "python" && top && DEF_KINDS[top.def[3]] === "class" && indent > top.indent;
      const v = (atTop || inClassBody) && (lang === "lua" ? /^\s*(?:local\s+)?([A-Za-z_]\w*)\s*=(?!=)/d : /^\s*([A-Za-z_]\w*)\s*(?::[^=]+)?=(?!=)|^\s*([A-Za-z_]\w*)\s*:\s*[^=]+$/d).exec(l);
      const name = v && (v[1] ?? v[2]);
      if (name && !STOP.has(name)) {
        let end = L;
        while (end < maskLines.length && depthAt[end + 1] > 0) end++;
        defs.push([name, L, end, K[atTop ? "var" : "field"], inClassBody ? top.def[0] : ""]);
      }
    }
    lastCode = L;
  }
  close(maskLines.length + 1, -1, false);
}

// SQL: create statements, and the columns of a created table.
function sqlDefs(mask, starts, defs) {
  const re = /\bcreate\s+(?:or\s+replace\s+)?(?:(?:temp|temporary|unique|materialized|unlogged)\s+)*(table|view|function|procedure|index|trigger|type|sequence|schema)\s+(?:if\s+not\s+exists\s+)?(?:(?:"[^"]*"|\w+)\.)?"?([A-Za-z_]\w*)"?/dgi;
  const kinds = { table: "table", view: "view", function: "function", procedure: "procedure", index: "index", trigger: "trigger", type: "type", sequence: "const", schema: "module" };
  for (const m of mask.matchAll(re)) {
    const kind = kinds[m[1].toLowerCase()];
    const at = m.indices[2][0];
    let depth = 0, j = m.index, dollar = null, open = -1;
    for (; j < mask.length; j++) {
      const ch = mask[j];
      if (dollar) {
        if (mask.startsWith(dollar, j)) {
          j += dollar.length - 1;
          dollar = null;
        }
        continue;
      }
      if (ch === "$") {
        const t = /^\$\w*\$/.exec(mask.slice(j, j + 40));
        if (t) {
          dollar = t[0];
          j += t[0].length - 1;
          continue;
        }
      }
      if (ch === "(") {
        if (depth === 0 && open === -1) open = j;
        depth++;
      } else if (ch === ")") depth--;
      else if (ch === ";" && depth <= 0) break;
    }
    const line = lineAt(starts, at);
    defs.push([m[2], line, lineAt(starts, Math.min(j, mask.length - 1)), K[kind], ""]);
    if (kind === "table" && open !== -1) {
      // Each part of the column list that starts with a name, not a constraint.
      let d = 0, partStart = open + 1;
      for (let k = open + 1; k <= j && k < mask.length; k++) {
        const ch = mask[k];
        if (ch === "(") d++;
        else if (ch === ")" && d > 0) d--;
        else if ((ch === "," && d === 0) || (ch === ")" && d === 0)) {
          const part = mask.slice(partStart, k);
          const col = /^\s*"?([A-Za-z_]\w*)"?\s+\w/d.exec(part);
          if (col && !/^(primary|foreign|constraint|unique|check|key|index|exclude|like)$/i.test(col[1])) defs.push([col[1], lineAt(starts, partStart + col.indices[1][0]), lineAt(starts, partStart + col.indices[1][0]), K.column, m[2]]);
          partStart = k + 1;
          if (ch === ")") break;
        }
      }
    }
  }
}

// What follows a name in code, and what comes before it.
const AFTER_CALL = /\s*(?:\(|!\s*[([{]|::\s*<[^;{}()\n]*>\s*\(|<[^;{}()\n=]*>\s*\(|`)/y;
const AFTER_WRITE = /\s*(?:=(?![=>~])|[-+*/%&|^]=|<<=|>>=|\?\?=|\|\|=|&&=|\+\+|--(?!>)|:=|(?:,\s*[A-Za-z_]\w*\s*)+:=)/y;
const AFTER_KEY = /\s*\??:(?!:)/y;
const AFTER_MUTATE = /["'`]?\s*\)?\s*\.\s*(?:insert|update|upsert|delete|del|remove|set|push|add|put|create|save|write|append|extend|clear|truncate|splice|pop|shift|unshift|drain|retain|sort|fill)\w*\s*[(!]/iy;
const BEFORE_DECL = /\b(?:let|var|const|mut|static)\s+$|(?:\+\+|--)\s*$/;
const BEFORE_SQL_WRITE = /\b(?:insert\s+(?:or\s+\w+\s+)?into|update|delete\s+from|merge\s+into|replace\s+into|upsert\s+into|truncate(?:\s+table)?|alter\s+table|drop\s+table(?:\s+if\s+exists)?|insert_into|delete_from)\s*[(\s"'`[]*(?:\w+\.)?["'`]?$/i;
const BEFORE_TERNARY = /\?\s*[\w.$]*\s*$|\bcase\s+$/;

function uses(text, mask, maskLines, starts, rs, re, rk) {
  // Lines that import (and the lines of a multi-line import list).
  const imports = new Uint8Array(maskLines.length + 2);
  let openImport = 0;
  for (let L = 1; L <= maskLines.length; L++) {
    const l = maskLines[L - 1];
    if (openImport > 0) {
      imports[L] = 1;
      for (const ch of l) openImport += ch === "{" || ch === "(" ? 1 : ch === "}" || ch === ")" ? -1 : 0;
      continue;
    }
    if (IMPORT_LINE.test(l)) {
      imports[L] = 1;
      let d = 0;
      for (const ch of l) d += ch === "{" || ch === "(" ? 1 : ch === "}" || ch === ")" ? -1 : 0;
      openImport = Math.max(0, d);
    }
  }
  const byName = new Map();
  let line = 0, ri = 0;
  const ID = /\b[A-Za-z_]\w*/g;
  for (const mt of text.matchAll(ID)) {
    const name = mt[0];
    if (name.length < 2 || STOP.has(name)) continue;
    const at = mt.index;
    while (line + 1 < starts.length && starts[line + 1] <= at) line++;
    while (ri < rs.length && re[ri] <= at) ri++;
    const end = at + name.length;
    const lineStart = starts[line];
    let kind;
    if (ri < rs.length && rs[ri] <= at) {
      kind = rk[ri];
      if (kind === STRING) {
        const before = text.slice(Math.max(lineStart, at - 60), at);
        AFTER_MUTATE.lastIndex = end;
        if (BEFORE_SQL_WRITE.test(before) || AFTER_MUTATE.test(text)) kind = WRITE;
      }
    } else if (imports[line + 1]) kind = IMPORT;
    else {
      const before = mask.slice(Math.max(lineStart, at - 60), at);
      AFTER_CALL.lastIndex = end;
      AFTER_WRITE.lastIndex = end;
      AFTER_KEY.lastIndex = end;
      AFTER_MUTATE.lastIndex = end;
      if (AFTER_WRITE.test(mask) || BEFORE_DECL.test(before) || AFTER_MUTATE.test(mask) || BEFORE_SQL_WRITE.test(before)) kind = WRITE;
      else if (AFTER_CALL.test(mask)) kind = CALL;
      else if (AFTER_KEY.test(mask) && !BEFORE_TERNARY.test(before)) kind = KEY;
      else kind = READ;
    }
    const code = (line + 1) * 8 + kind;
    const list = byName.get(name);
    if (!list) byName.set(name, [code]);
    else if (!list.includes(code, Math.max(0, list.length - 4))) list.push(code);
  }
  return byName;
}

// A file entry's uses, split once per entry: name -> index, and the coded lists.
const SPLIT = new WeakMap();
function split(entry) {
  let s = SPLIT.get(entry);
  if (!s) {
    s = { at: new Map((entry.xn ?? []).map((n, i) => [n, i])), parts: String(entry.xc ?? "").split(";") };
    SPLIT.set(entry, s);
  }
  return s;
}
/** One name's uses in a file entry, as codes (line * 8 + kind), or null when the file does not hold it. */
export function decodeUses(entry, name) {
  const s = split(entry);
  const i = s.at.get(name);
  if (i == null) return null;
  const out = [];
  let c = 0;
  for (const d of s.parts[i].split(",")) out.push((c += Number(d)));
  return out;
}
