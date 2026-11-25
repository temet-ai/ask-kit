// The REPL's globals for code-ask. `help` returns this file.

interface Hit { file: string; line: number; text: string; context?: true }

declare const repo: {
  root: string; // absolute path of the repository
  // A path that does not exist (rg, sg, files, read) gives one row, or text, starting NO SUCH PATH
  // with the nearest paths, and `missing` set: nothing was searched.
  // ripgrep; `pattern` is a regex unless fixed. Paths in results are relative to root. Files git
  // ignores (node_modules, build output) are skipped, except when `path` points into them (path: "node_modules/some-package").
  rg(pattern: string, o?: { fixed?: boolean; ignoreCase?: boolean; word?: boolean; context?: number;
    glob?: string | string[]; type?: string | string[]; path?: string; hidden?: boolean; max?: number }):
    Promise<Hit[] & { total: number; complete: boolean }>;
  // ast-grep: search by code shape, not text. `$X` matches one node, `$$$` any number. lang: rust,
  // ts, tsx, js, python, go... (inferred from the file when omitted). vars holds what each $X matched.
  sg(pattern: string, o?: { lang?: string; glob?: string | string[]; path?: string; max?: number }):
    Promise<{ file: string; line: number; text: string; vars: Record<string, string> }[] & { total: number; complete: boolean }>;
  files(glob?: string | string[], o?: { path?: string; hidden?: boolean; max?: number }): Promise<string[] & { total: number; complete: boolean }>;
  // Lines from..to (1-based, inclusive, at most 400), numbered "N\tline". `lines` is the file's length.
  read(file: string, o?: { from?: number; to?: number }): { file: string; from: number; to: number; lines: number; text: string };
  // Any git command, run in the repository. Returns stdout; throws on a non-zero exit.
  git(sub: string, ...args: string[]): Promise<string>;
  // git in the repository that holds another folder: repo.at("/path/to/other").git("log", "-3").
  at(folder: string): { root: string; git(sub: string, ...args: string[]): Promise<string> };
  // Write a whole file (folders are created).
  write(file: string, text: string): { file: string; bytes: number };
  // Replace `from` with `to`: exactly one occurrence, or all of them with { all: true }. Throws when not found.
  edit(file: string, from: string, to: string, o?: { all?: boolean }): { file: string; replaced: number };
  // Run any program in the repository (no shell: pass each argument separately). Never throws on a non-zero exit.
  run(cmd: string, ...args: string[]): Promise<{ code: number; out: string; err: string }>;
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
declare function sumBy<T>(rows: T[], key: string | ((r: T) => number)): number;
declare function since(hours: number): string; // ISO time `hours` ago
declare function omit<T>(rows: T | T[], ...keys: string[]): any;
declare function minutes(ms: number): number; // ms to minutes, one decimal
declare const tk: { clip: typeof clip; shape: typeof shape; pick: typeof pick; omit: typeof omit; table: typeof table; top: typeof top; groupBy: typeof groupBy; countBy: typeof countBy; sumBy: typeof sumBy; since: typeof since; minutes: typeof minutes };

// Ask another enabled kit a question (not this kit); `continue: true` follows up with the one asked before. Resolves to its answer text.
declare const ask: { kit(name: string, question: string, o?: { continue?: boolean }): Promise<string> };
