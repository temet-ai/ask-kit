interface Hit { file: string; line: number; text: string; context?: true }

declare const __NAME__: {
  root: string; // absolute path of the folder
  // ripgrep; `pattern` is a regex unless fixed. Paths in results are relative to root.
  rg(pattern: string, o?: { fixed?: boolean; ignoreCase?: boolean; word?: boolean; context?: number;
    glob?: string | string[]; type?: string | string[]; path?: string; hidden?: boolean; max?: number }):
    Promise<Hit[] & { total: number; complete: boolean }>;
  // ast-grep: search by code shape, not text. `$X` matches one node, `$$$` any number. lang: rust,
  // ts, tsx, js, python, go... (inferred from the file when omitted). vars holds what each $X matched.
  sg(pattern: string, o?: { lang?: string; glob?: string | string[]; path?: string; max?: number }):
    Promise<{ file: string; line: number; text: string; vars: Record<string, string> }[] & { total: number; complete: boolean }>;
  files(glob?: string, o?: { path?: string; hidden?: boolean; max?: number }): Promise<string[] & { total: number; complete: boolean }>;
  // Lines from..to (1-based, inclusive, at most 400), numbered "N\tline". `lines` is the file's length.
  read(file: string, o?: { from?: number; to?: number }): { file: string; from: number; to: number; lines: number; text: string };
  // Any git command, run in the folder (a git repository). Returns stdout; throws on a non-zero exit.
  git(sub: string, ...args: string[]): Promise<string>;
  // Write a whole file (folders are created).
  write(file: string, text: string): { file: string; bytes: number };
  // Replace `from` with `to`: exactly one occurrence, or all of them with { all: true }. Throws when not found.
  edit(file: string, from: string, to: string, o?: { all?: boolean }): { file: string; replaced: number };
  // Run any program in the folder (no shell: pass each argument separately). Never throws on a non-zero exit.
  run(cmd: string, ...args: string[]): Promise<{ code: number; out: string; err: string }>;
};

