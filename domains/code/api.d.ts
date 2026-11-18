// The REPL's globals for code-ask. `help` returns this file.

interface Hit { file: string; line: number; text: string; context?: true }

declare const repo: {
  root: string; // absolute path of the repository
  // ripgrep; `pattern` is a regex unless fixed. Paths in results are relative to root.
  rg(pattern: string, o?: { fixed?: boolean; ignoreCase?: boolean; word?: boolean; context?: number;
    glob?: string | string[]; type?: string | string[]; path?: string; hidden?: boolean; max?: number }):
    Promise<Hit[] & { total: number; complete: boolean }>;
  files(glob?: string, o?: { path?: string; hidden?: boolean; max?: number }): Promise<string[] & { total: number; complete: boolean }>;
  // Lines from..to (1-based, inclusive, at most 400), numbered "N\tline". `lines` is the file's length.
  read(file: string, o?: { from?: number; to?: number }): { file: string; from: number; to: number; lines: number; text: string };
  // Read-only git: log, show, blame, diff, ls-files, grep, rev-parse, status, shortlog, branch, tag. Returns stdout.
  git(sub: string, ...args: string[]): Promise<string>;
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
