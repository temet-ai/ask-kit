# Add a script to a domain

A script is a ready-made program for a question people ask often. The investigator runs it with
`scripts.run(name, params)` instead of writing the same search again. A script is tested by every
question that uses it, so it is the best place to put a search that works.

This guide adds a script to the `notes` domain from [Write a domain](write-a-domain.md), then
shows how to promote a draft the investigator wrote. The steps are the same for any domain.

The API a script can use is in the [Investigator API reference](../reference/domain-api.md#scripts).

## Decide whether to add one

Run the report:

```sh
ask-kit report --since 7d
```

The last section, "Written by hand 3+ times (worth a script)", lists cells the investigator wrote
three or more times without a script. A line there is a candidate. A flagged ask that was slow
because a search read too much is another: a script can search less by default. See
[Make it better](../tuning.md) and the [journal reference](../reference/journal.md#ask-kit-report).

Check for a draft first. The investigator may have already written what you need (see
[Promote a draft](#promote-a-draft)).

## Where the file goes

Scripts are `.mjs` files in the `scripts/` folder of the domain. The name is the file name without
`.mjs`.

| Domain | Folder |
|---|---|
| Your own, in the config folder | `~/.config/ask-kit/domains/<name>/scripts/` |
| Built in (`code`, `sessions`) | `domains/<name>/scripts/` in the ask-kit install folder |

Do not copy a built-in domain into your config folder to add a script to it. A domain there
replaces the built-in one entirely, and the `code` domain's files import from `src/` by relative
path, so a copy would not load. Edit the install folder, or write a new domain.

Every `.mjs` file in `scripts/` is loaded as a script. A helper shared by several scripts goes
outside the folder, as `domains/code/lib.mjs` does, and scripts import it with a relative path
(`import { NOISE } from "../lib.mjs"`).

## Write the script

Add a `tagged` script to the `notes` domain. It lists the notes carrying a tag. Save as
`~/.config/ask-kit/domains/notes/scripts/tagged.mjs`:

```js
export const meta = {
  purpose: "Notes carrying a #tag, newest first, with title and last change; answers 'what did I write down under #tag'.",
  params: { tag: "the tag, with or without #", since: "only notes changed in the last N hours, optional", max: "notes returned, default 20" },
  returns: "{tag, total, notes:[{name, title, modified}], complete}",
  example: 'await scripts.run("tagged", { tag: "retro" })',
};

export default async function ({ notes }, { tag, since, max = 20 }) {
  if (!tag) throw new Error("tagged needs `tag`");
  const rows = notes.list({ tag, since, max });
  return { tag: String(tag).replace(/^#/, ""), total: rows.total, notes: rows.map(({ name, title, modified }) => ({ name, title, modified })), complete: rows.complete };
}
```

A script file has two exports:

| Export | Rule |
|---|---|
| `meta` | `purpose`, `params`, `returns` and `example`. `help` prints them, and the investigator chooses a script from them, so write `purpose` as the question the script answers. `params` maps each name to a short description with its default. |
| `default` | An `async function (globals, params)`. `globals` holds the domain's globals (`notes` here) and `tk`, the toolkit. `params` is the object the investigator passed. |

Habits that make a script work well:

- Throw a clear error for a missing required parameter. The investigator reads the message and
  corrects the call.
- Return a small object: counts, the top rows, and `complete: false` when a list was cut. The
  investigator pays for every character it reads.
- Narrow by default: a time window, a cap on rows. The investigator can widen it with a
  parameter.
- Give the result field names a question can use as evidence: a file and a line, a session and an
  event number.

## Try it without a model

Run the script through the investigator's server, with throwaway state so no journal lands in your
real state folder. From the ask-kit folder:

```sh
ASK_KIT_STATE=$(mktemp -d) ASK_KIT_DOMAIN=notes ASK_KIT_INNER=1 ASK_KIT_SESSION=try \
node --input-type=module -e '
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const c = new Client({ name: "try", version: "0" });
await c.connect(new StdioClientTransport({ command: process.execPath, args: ["src/server.mjs"], env: process.env, stderr: "inherit" }));
const cell = async (code) => console.log((await c.callTool({ name: "repl", arguments: { code } })).content[0].text);
await cell(process.argv[1]);
await c.close();
' 'await scripts.run("tagged", { tag: "retro" })'
```

Replace `notes` and the last line with your domain and your call. The output is the cell's result
followed by `[<ms> ms, <n> call(s)]`. For `tagged` with one note tagged `#retro` it looks like:

```
{
 "tag": "retro",
 "total": 1,
 "notes": [
  {
   "name": "projects/billing.md",
   "title": "Billing retro",
   "modified": "2026-11-18T09:28:57.312Z"
  }
 ],
 "complete": true
}

[5 ms, 1 call]
```

To check that `help` lists it, call the `help` tool instead of `repl` the same way. A script
that fails to load shows up at the top of the next cell as
`[scripts that failed to load: tagged.mjs: <reason>]`. The usual reasons are a syntax error, a
missing `export default` function and a bad import path.

## Tell the investigator about it

The investigator sees every script's `purpose`, `params` and `example` in `help`, so a clear
`meta` is usually enough. Two places make it start from the script:

- `openWith` in `domain.mjs`: one line per script that suits a common question, as the built-in
  domains have. It is used by `api` backends.
- `instructions.md`: a line such as "Start from a ready-made script (`scripts.run`) when one
  fits." The sessions and code instructions say this once and do not list scripts.

Keep these short, and replace a line rather than adding one when you can.

## Check that it is used

Changing a script re-warms the investigator on the next question (the script files are part of
its fingerprint). Ask a question the script should answer:

```sh
ask-kit ask --domain notes "which notes did I tag retro?"
```

Then read the cells:

```sh
jq -r 'select(.code) | .code' $(ls -t ~/.local/state/ask-kit/notes/*.jsonl | head -3)
```

You want to see `scripts.run("tagged", ...)` and no hand-written search for the same thing. A week
later, run `ask-kit report`: the script appears under `Scripts` with its run count, and its
failures are counted.

## Promote a draft

During an investigation the model can save a script it wrote with `scripts.draft(name, source)`.
A draft belongs to that investigation's session. It is loaded for later cells in the same
session, and listed as `<name> (draft)`. It is not part of the library until you copy it.

1. Find the drafts. They are in the state folder, one folder per session:

   ```sh
   find ~/.local/state/ask-kit -path '*/drafts/*' -name '*.mjs'
   ```

   Drafts of the `code` domain are one level deeper, under the repository's folder. The report
   marks a draft's runs as `<domain>/<name> (draft)`.

2. Read it, and check it:
   - It exports `meta` and a default async function.
   - It imports nothing by a relative path. A draft is saved in the state folder, so `../lib.mjs`
     would not resolve once the file is in the library. Move shared code into a file outside
     `scripts/`, or inline it.
   - Its `purpose` and `params` say what it answers and what the defaults are.

3. Copy it into the domain's `scripts/` folder under the name you want:

   ```sh
   cp ~/.local/state/ask-kit/notes/drafts/<session>/tagged.mjs ~/.config/ask-kit/domains/notes/scripts/tagged.mjs
   ```

   A script and a draft with the same name are two files. In a session that has the draft, the
   draft wins. A different name avoids the question.

4. Run it as shown under [Try it without a model](#try-it-without-a-model) and ask a question that
   should use it.

5. Delete the draft, so a later investigation does not pick up the old version:

   ```sh
   rm ~/.local/state/ask-kit/notes/drafts/<session>/tagged.mjs
   ```

Names of drafts are lowercase letters, digits and dashes, and start with a letter or digit.

The [`ask-kit-improve` skill](https://github.com/temet-ai/ask-kit/blob/main/bundle/skills/ask-kit-improve/SKILL.md)
and the [`ask-kit-tuner` agent](https://github.com/temet-ai/ask-kit/blob/main/bundle/agents/ask-kit-tuner.md)
follow the same steps when you ask an agent to tune ask. Paste
`Read ~/.config/ask-kit/AGENTS.md, then improve ask from the last week's journal.`

## Related

- [Make it better](../tuning.md): the whole loop from a bad answer to a fix.
- [Find and fix a bad answer](debug-a-bad-answer.md)
- [Investigator API reference](../reference/domain-api.md): the ready-made scripts as examples.
