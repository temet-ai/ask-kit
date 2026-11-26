// Shared by the code scripts (outside scripts/, which loads every file as a script).

// Generated, vendored and lock files: searched only when asked for.
export const NOISE = [
  "!**/node_modules/**", "!**/target/**", "!**/dist/**", "!**/build/**", "!**/.git/**", "!**/vendor/**",
  "!**/*.lock", "!**/package-lock.json", "!**/pnpm-lock.yaml", "!**/*.min.js", "!**/*.map", "!**/.sqlx/**",
  "!**/__snapshots__/**", "!**/*.snap",
];

// The same files as NOISE, for a path git lists (NOISE is ripgrep's form of it).
const NOISE_DIRS = new Set(["node_modules", "target", "dist", "build", ".git", "vendor", ".sqlx", "__snapshots__"]);
const NOISE_FILES = /(?:\.lock|(?:^|\/)package-lock\.json|(?:^|\/)pnpm-lock\.yaml|\.min\.js|\.map|\.snap)$/;
/** Whether a repository-relative path is generated, vendored or a lock file (left out of searches and the code map). */
export const noisy = (file) => NOISE_FILES.test(file) || String(file).split("/").slice(0, -1).some((d) => NOISE_DIRS.has(d));

// Every spelling a name has: fooBar, FooBar, foo_bar, FOO_BAR, foo-bar.
export function spellings(name) {
  const words = String(name)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
  if (!words.length) return [];
  const cap = (w) => w[0].toUpperCase() + w.slice(1);
  return [...new Set([
    words.join("_"), words.join("_").toUpperCase(), words.join("-"),
    words[0] + words.slice(1).map(cap).join(""), words.map(cap).join(""), words.join(""),
  ])];
}

export const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// A definition of `n` in the common languages here: Rust, TS/JS, Python, Go, shell, SQL.
export function definitionPattern(names) {
  const alt = names.map(escape).join("|");
  return (
    `(\\b(fn|struct|enum|trait|type|mod|impl|const|static|let|function|class|interface|def|var|func)\\s+(${alt})\\b)` +
    `|(\\b(${alt})\\s*[:=]\\s*(async\\s+)?(\\(|function|\\{|\\[))` +
    `|(^\\s*(export\\s+)?(${alt})\\s*\\(\\))` +
    `|(\\bcreate\\s+(table|view|function|index)\\s+(if\\s+not\\s+exists\\s+)?[\\w.]*(${alt})\\b)`
  );
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
