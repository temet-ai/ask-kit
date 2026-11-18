# Domains

A domain is what an investigator answers about: the REPL globals it gets, its scripts, its
instructions and the words of its `ask` tool. `src/domains.mjs` finds and loads domains, the two
built-in ones live in `domains/`, and `src/gallery.mjs` installs shared ones from GitHub. For
the user's view see [Domains](../domains.md); for the typed contract see
[the domain API](../reference/domain-api.md); to write one see
[write a domain](../guides/write-a-domain.md).

## Files

| File | What is in it |
|---|---|
| [src/domains.mjs](https://github.com/temet-ai/ask-kit/blob/main/src/domains.mjs) | `domainDirs()`, `listDomains()`, `loadDomain(name)`, and the header comment that lists the fields of a domain module. The name pattern `NAME` is `^[a-z][a-z0-9-]*$`. |
| [src/gallery.mjs](https://github.com/temet-ai/ask-kit/blob/main/src/gallery.mjs) | `TOPIC`, `listGallery()`, `parseRef()`, `addDomain()`, and the helpers `fetchRepo`, `findDomains`, `listFiles`. |
| [src/server.mjs](https://github.com/temet-ai/ask-kit/blob/main/src/server.mjs) | Where most of a domain's fields are read: `loadDomain(DOMAIN_NAME)`, `refreshScripts`, the `scripts` object, `helpText`, and the `fingerprintFiles` list passed to `registerAsk`. |
| [src/router.mjs](https://github.com/temet-ai/ask-kit/blob/main/src/router.mjs) | `makeRouter`: which domains are enabled, and the `says` line the router reads. |
| [src/ask.mjs](https://github.com/temet-ai/ask-kit/blob/main/src/ask.mjs) | `registerAsk`: reads `instructions`, `prime`, `answerRules`, `openWith`, `askDescription`, `childEnv`, `defaultBackend`. |
| [domains/code/domain.mjs](https://github.com/temet-ai/ask-kit/blob/main/domains/code/domain.mjs) | The `domain` export of `code`; `repoRoot()` finds the repository. |
| [domains/code/repo.mjs](https://github.com/temet-ai/ask-kit/blob/main/domains/code/repo.mjs) | `makeRepo({root, push})`: `rg`, `files`, `read`, `git`; the constants `GIT_ALLOWED` and `GIT_DENIED`. |
| [domains/code/lib.mjs](https://github.com/temet-ai/ask-kit/blob/main/domains/code/lib.mjs) | `NOISE`, `spellings`, `escape`, `definitionPattern`. Kept outside `scripts/`, because every `.mjs` file in `scripts/` is loaded as a script. |
| [domains/code/api.d.ts](https://github.com/temet-ai/ask-kit/blob/main/domains/code/api.d.ts) | Types for `repo`, `scripts` and the toolkit. `help` returns this file. |
| [domains/code/instructions.md](https://github.com/temet-ai/ask-kit/blob/main/domains/code/instructions.md) | The system prompt of the `code` investigator. |
| [domains/code/scripts/](https://github.com/temet-ai/ask-kit/tree/main/domains/code/scripts) | `where`, `knobs`, `history`, `outline`, `overview`. |
| [domains/sessions/domain.mjs](https://github.com/temet-ai/ask-kit/blob/main/domains/sessions/domain.mjs) | The `domain` export of `sessions`; its globals come from `src/transcripts/index.mjs`. |
| [domains/sessions/api.d.ts](https://github.com/temet-ai/ask-kit/blob/main/domains/sessions/api.d.ts) | Types for `Session`, `Event`, `Hit`, `history`, `cite`, `scripts` and the toolkit. |
| [domains/sessions/instructions.md](https://github.com/temet-ai/ask-kit/blob/main/domains/sessions/instructions.md) | The system prompt of the `sessions` investigator. |
| [domains/sessions/scripts/](https://github.com/temet-ai/ask-kit/tree/main/domains/sessions/scripts) | `find-sessions`, `session-digest`, `grep`, `session-tools`, `session-changes`, `recent`. |

## How a domain is found

`domainDirs()` returns two folders, in this order:

```js
return [path.join(CONFIG_DIR, "domains"), path.join(ROOT, "domains")];
```

The first is the user's (`~/.config/ask-kit/domains` on Linux and macOS, `%APPDATA%\ask-kit\domains`
on Windows, moved by `ASK_KIT_CONFIG` or `XDG_CONFIG_HOME`). The second is the built-in folder in
the install.

- `loadDomain(name)` checks the name against `NAME`, then walks the two folders in order and
  imports the first `<dir>/<name>/domain.mjs` it finds. A user domain therefore wins over a
  built-in of the same name. The module's `domain` export is returned. If no folder has it, the
  error lists the names that do exist.
- `listDomains()` returns the union of folder names that contain a `domain.mjs`. Only
  `src/agentsmd.mjs` uses it, to print "Domains available now" in the guide.
- The import has no cache-busting query. A process loads a domain once, so a change to
  `domain.mjs` takes effect when the server restarts. Changes to `instructions.md`,
  `api.d.ts` and `scripts/` take effect on the next question, as the next sections describe.

## How a domain is enabled

A folder on disk does not make a domain available. `makeRouter` in `src/router.mjs` takes the
keys of `config.domains` whose `enabled` is not `false`, and calls `loadDomain` for each:

```js
const enabled = Object.entries(config.domains ?? {}).filter(([, d]) => d.enabled !== false).map(([n]) => n);
```

The `about` argument of `ask` is an enum of exactly these names. `ask-kit serve --domain d` skips
the router and loads `d` directly, enabled or not.

The entry in `config.json` can hold:

| Key | Read by | Meaning |
|---|---|---|
| `enabled` | `makeRouter` | `false` turns the domain off. |
| `backend` | `registerAsk` | This domain's default backend. Order: this key, the module's `defaultBackend`, `backends.default`, the first backend. |
| `from`, `commit` | nothing at run time | Written by `ask-kit add`: the repository the domain came from and its commit. |

`ask-kit setup` and `ask-kit apply` write `domains` from the answers, `{enabled: true}` for each
name, and replace the whole object. See [setup.md](setup.md#things-to-watch-for).

## The domain module

A domain module exports `domain`, an object. The header of `src/domains.mjs` lists most fields;
this table is complete for the code on `main`, with the file that reads each one.

| Field | Read by | Meaning |
|---|---|---|
| `name` | `server.mjs` | Names the MCP server `ask-<name>`. |
| `says` | `router.mjs` | One line saying what the domain answers. It goes into the router's prompt and into the `ask` tool description agents see. |
| `stateKey` | `server.mjs` | When set, state goes in `STATE_ROOT/<domain>/<slug(stateKey)>/`. `code` sets it to the repository root, so each repository has its own journal, snapshots and warm session. |
| `childEnv()` | `ask.mjs` (`childEnv`, `replEnv`) | Extra environment for the investigator and the REPL server. `code` passes `ASK_KIT_CODE_ROOT`, because those processes start in another directory. |
| `scriptsDir` | `server.mjs` | Folder of scripts. |
| `apiDoc` | `server.mjs` (`helpText`) | Path of the typed API. `help` returns it after the script list. |
| `instructions` | `ask.mjs`, `server.mjs` | Path of the system prompt. |
| `makeGlobals({push, config})` | `server.mjs` | Returns the REPL's service globals. `push(call)` records a call in the cell's journal entry. `config` is the parsed `config.json`. |
| `beforeCell(globals)` | `server.mjs` (`runCell`) | Optional. Runs before every cell. Neither built-in domain defines it. |
| `prime` | `ask.mjs` | First prompt of the warm session. |
| `answerRules` | `ask.mjs` | Appended to every question. |
| `openWith` | `ask.mjs` | Text placed before the script list in the API loop's system prompt. |
| `codexNote` | `ask.mjs` | Optional. Extra text in the Codex warm prompt. Neither built-in domain defines it. |
| `askDescription`, `serverInstructions` | `server.mjs`, `ask.mjs` | The words of the domain's own `ask` tool. Agents that go through the router see the router's text instead (built from `says`). These are seen with `serve --domain`. |
| `replInstructions` | `server.mjs` | The instructions string of the inner (REPL) MCP server. |
| `fingerprintFiles()` | `server.mjs` | Extra files whose content changes the warm-session fingerprint. |
| `defaultBackend` | `ask.mjs` | A backend name that suits this domain. |

The code domain also sets `root`; nothing reads it.

## Built-in domain: code

Files read by the investigator: `instructions.md`, `api.d.ts`, `scripts/*.mjs`. The code behind
`repo` is `repo.mjs`.

`domain.mjs` computes the repository once, at import:

```js
const start = process.env.ASK_KIT_CODE_ROOT || process.cwd();
// git rev-parse --show-toplevel in `start`, else `start` itself
```

Agents start MCP servers in the session's project directory, so `process.cwd()` is the
repository. `childEnv` passes the result on as `ASK_KIT_CODE_ROOT`.

`makeRepo` returns four methods. All run with `execFile`, so no shell is involved.

- `rg(pattern, opts)` runs ripgrep with `--json`, always with an explicit path (otherwise rg
  reads stdin). It returns `{file, line, text}` rows, at most `max` (default 200), with `total`
  and `complete` on the array. Exit code 1 (no match) is treated as an empty result.
- `files(glob, opts)` runs `rg --files`, sorted, at most 2000 by default.
- `read(file, {from, to})` returns at most 400 numbered lines.
- `git(sub, ...args)` allows only the subcommands in `GIT_ALLOWED` (`log`, `show`, `blame`,
  `diff`, `ls-files`, `grep`, `rev-parse`, `status`, `shortlog`, `branch`, `tag`) and rejects any
  argument matching `GIT_DENIED` (`--output`, `--ext-diff`, `-c`, `--git-dir`, `-C` and similar).

`inside()` resolves every path against the real repository root and throws when the result is
outside. `rgPath()` from `src/platform.mjs` supplies ripgrep.

The scripts search every spelling of a name through `spellings()` in `lib.mjs`, and leave out the
paths in `NOISE`. Their `meta` and default function are described below.

## Built-in domain: sessions

`domain.mjs` builds its globals from the transcript layer:

```js
makeGlobals: ({ push, config }) => ({ history: makeHistory({ sources: config.sources, push }), cite }),
```

`config.sources` is the list of adapters `ask-kit setup` enabled. The adapters, the event shape
and `history` are in [transcripts.md](transcripts.md). `fingerprintFiles` lists `domain.mjs` and
`src/transcripts/index.mjs`.

## How scripts are exposed

`server.mjs` builds a registry from two folders: the domain's `scriptsDir` and the session's
drafts folder.

1. `dirStamp(dir)` lists the `.mjs` files directly in the folder (not in sub-folders) with their
   modification times.
2. `refreshScripts()` runs before every cell and in `help`. It joins the path and mtime of every
   file into a signature. If the signature equals the last one, nothing happens. Otherwise it
   clears the registry and imports each file with `?v=<mtime>` appended, so an edited file is
   re-read.
3. A script file must have a default export that is a function. It may export `meta`. A file
   that fails to import is reported in the next cell's output ("scripts that failed to load")
   and left out.
4. The registry key is the file name without `.mjs`. Library scripts load first and drafts
   after, so a draft with the same name replaces the library script.

A script is called as `fn({...GLOBALS, tk}, params)`: the first argument holds the domain's
globals (`repo`, or `history` and `cite`) and the toolkit as `tk`. A script written like this:

```js
export const meta = { purpose: "...", params: { name: "..." }, returns: "{...}", example: 'await scripts.run("where", { name: "X" })' };
export default async function ({ repo }, { name }) { /* ... */ }
```

is available to the investigator as `scripts.run("where", { name: "X" })`. The `scripts` global
also has `list()`, `show(name)` (the source) and `draft(name, source)`.

`help` returns each script's name, `purpose`, `params`, `returns` and `example`, then the text of
`apiDoc`. That is how the investigator learns about a script, so `meta` is part of the prompt.

A script that imports a helper module (the code scripts import `../lib.mjs`) gets the module
from Node's import cache. Changing `lib.mjs` does not reload it in a running server. The code
domain lists `lib.mjs` in `fingerprintFiles`, which makes the next question start new processes.

### Draft scripts

`scripts.draft(name, source)` writes `STATE_DIR/drafts/<slug(SESSION)>/<name>.mjs` (mode 0600).
The name must match `^[a-z0-9][a-z0-9-]*$`. The next cell loads it, flagged `draft: true`.
Drafts belong to one session and are not shared. `reset` keeps them. A good draft is copied by
hand into a domain's `scripts/` folder; [Make it better](../tuning.md) describes how.
`ask-kit report` counts draft runs separately (`name (draft)`).

## What makes the investigator load a domain again

`registerAsk` in `src/ask.mjs` fingerprints the warm session from: the instructions file, the
list from `fingerprintFiles` in `server.mjs`, and the backend's config. That list holds
`src/server.mjs`, `src/core/toolkit.mjs`, `apiDoc`, `instructions`, the domain's own
`fingerprintFiles()` and every `.mjs` in `scriptsDir`. A backend that keeps a warm session (the
Claude Code and Codex CLIs) starts a new one on the next question after any of them changes.
[ask-lifecycle.md](ask-lifecycle.md) covers the warm session.

## The gallery: `ask-kit gallery` and `ask-kit add`

A shared domain is a public GitHub repository with the topic `ask-kit-domain` (the constant
`TOPIC`), holding the domain folder and a `RECIPE.md`.

`listGallery()` calls the GitHub search API:

```
https://api.github.com/search/repositories?q=topic:ask-kit-domain&sort=stars&per_page=50
```

It sends `GITHUB_TOKEN` as a bearer token when the variable is set, times out after 10 seconds
and returns `{repo, description, stars, updated, url}` rows. `ask-kit gallery` prints them, or
JSON with `--json`.

`addDomain(ref, {yes})` is `ask-kit add <ref> [--yes]`:

1. `parseRef` accepts a local folder that exists, or `owner/repo`, `github.com/owner/repo` or a
   full URL (a trailing `.git` is allowed).
2. `fetchRepo` uses the folder as it is, or runs `git clone --depth 1` into
   `STATE_ROOT/gallery/<owner>-<repo>` (an existing clone is deleted first). It needs `git` on
   `PATH`. It records the commit with `git rev-parse HEAD`.
3. `findDomains` looks for `domain.mjs` at the root of the repository (the domain name is the
   repository name without a leading `ask-kit-`), in each sub-folder, and in each sub-folder of
   `domains/`.
4. Without `--yes` it returns what it found and installs nothing: the source, the commit, the
   first 3000 characters of `RECIPE.md` (or `README.md`), and for each domain its file list with
   sizes and the first 4000 characters of `domain.mjs`. The `next` field tells the agent to read
   the code, report what it reads and runs, and ask the user.
5. With `--yes`, for each domain it deletes `CONFIG_DIR/domains/<name>`, copies the folder there
   (leaving out paths containing `/.git`), and sets
   `config.domains[name] = {...existing, enabled: true, from, commit}`. Then it saves the config
   and rewrites the guide.

`addDomain` needs an existing config (`loadConfig()` throws "not set up yet" otherwise). A
domain is code that runs with the user's rights, which is why step 4 exists. The `ask-kit-domain`
skill in [bundle/skills/ask-kit-domain/SKILL.md](https://github.com/temet-ai/ask-kit/blob/main/bundle/skills/ask-kit-domain/SKILL.md)
tells the agent how to carry it out.

## What to look at when changing it

- Adding a field to the contract: read it in the file that uses it, give it a safe default
  (`D.field?.()`), add it to the header of `src/domains.mjs` and to
  [the domain API](../reference/domain-api.md).
- A domain that needs per-project state: set `stateKey`, as `code` does, and pass whatever the
  child processes need through `childEnv`. The investigator and the REPL server start in a
  different working directory from the agent.
- A new built-in domain: add `domains/<name>/` with `domain.mjs`, `api.d.ts`, `instructions.md`
  and `scripts/`. It must also be offered by setup: the `domains` question in
  `src/setup/questions.mjs` lists only `sessions` and `code`, and the router's keyword fallback
  `RULES` in `src/router.mjs` knows only those two names.
- A domain's globals carry the actions its domain needs, not only reads (see `CONTRIBUTING.md`).
  `repo.mjs` is the model: search, read, write, edit, run and git, through `execFile` with no shell.
- Tests: `test/repl.mjs` starts `src/server.mjs` for the `sessions` domain over MCP, checks that
  `help` lists the six scripts, runs one, and checks that a variable survives a restart. It does
  not load the `code` domain. Nothing under `test/` covers `src/gallery.mjs`,
  `src/domains.mjs` precedence or `domains/code/repo.mjs`. A change to those needs a test added.
