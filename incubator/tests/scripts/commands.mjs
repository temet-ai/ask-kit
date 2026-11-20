export const meta = {
  purpose: "Which checks this project defines and how each is run: its tests, typecheck, lint, build and format commands, found in package.json scripts, Cargo.toml, go.mod, pyproject.toml, a Makefile or a justfile. Runs nothing.",
  params: { dir: "another folder to look in (a package of a monorepo), optional" },
  returns: "{root, checks:[{name, kind, command, from, runnable, why?, script?}], note?}",
  example: 'await scripts.run("commands")',
};

export default async function ({ checks }, { dir } = {}) {
  const c = dir ? checks.at(dir) : checks;
  const list = c.commands();
  return {
    root: c.project().root,
    checks: list.map(({ cmd, ...r }) => ({ ...r, command: cmd.join(" ") })),
    ...(list.length ? {} : { note: "no package.json scripts, Cargo.toml, go.mod, pyproject.toml, Makefile or justfile check found here; name the folder with `dir`" }),
  };
}
