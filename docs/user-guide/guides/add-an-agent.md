# Support a new coding agent

A coding agent touches ask-kit in three places:

1. A **transcript adapter** lets the sessions domain read the agent's past sessions.
2. A **registration** puts the `ask` tool into the agent's MCP configuration.
3. A **bundle target** puts ask-kit's skills, tuner agent and when-to-ask rule into the agent's own
   folders.

You can do the first without the others: an agent whose transcripts ask-kit reads does not have to
get the `ask` tool. This guide adds an imaginary agent, `acme-cli`, that keeps one JSONL file per
session in `~/.acme/sessions/`. It touches the files below. For how they fit together, see
[Transcripts](../internals/transcripts.md) and [Setup](../internals/setup.md).

| Step | File |
|---|---|
| Adapter | [`src/transcripts/acme-cli.mjs`](https://github.com/temet-ai/ask-kit/tree/main/src/transcripts) (new), [`src/transcripts/index.mjs`](https://github.com/temet-ai/ask-kit/blob/main/src/transcripts/index.mjs) |
| Agent list | [`src/providers.mjs`](https://github.com/temet-ai/ask-kit/blob/main/src/providers.mjs) (`AGENTS`) |
| Registration | [`src/setup/register.mjs`](https://github.com/temet-ai/ask-kit/blob/main/src/setup/register.mjs) (`REGISTER`) |
| Bundle | [`src/setup/bundle.mjs`](https://github.com/temet-ai/ask-kit/blob/main/src/setup/bundle.mjs) (`TARGETS`, `agentFile`) |
| Session id | [`src/config.mjs`](https://github.com/temet-ai/ask-kit/blob/main/src/config.mjs) (`callerSession`), [`src/ask.mjs`](https://github.com/temet-ai/ask-kit/blob/main/src/ask.mjs) (`childEnv`) |
| Sessions domain | `domains/sessions/api.d.ts`, `domains/sessions/scripts/recent.mjs` |
| Tests | `test/fixtures.mjs`, `test/fixtures/acme-cli/` |

## Before you start

- Node 22.13 or newer, and a clone of ask-kit with `npm ci` run.
- A real transcript file from the agent. Read it before you write code: you need to know where it
  stores the working directory, the start time, the first prompt, tool calls and their results,
  and token usage.
- Test data in this repository uses made-up names, never real transcripts
  ([CONTRIBUTING](https://github.com/temet-ai/ask-kit/blob/main/CONTRIBUTING.md)). You will write a
  small synthetic file in the agent's format.

## 1. Write the adapter

An adapter is an object with this shape. Each member is used by the sessions domain.

| Member | Returns |
|---|---|
| `name` | The source name. It goes in `config.sources` and in the `source` field of every session. |
| `label` | The name shown to people. |
| `where()` | A path, shown by `detect` and `doctor`. |
| `available()` | Whether this machine has the agent's store. |
| `sessions()` | `[{ source, id, file, size, updatedAt, cwd, project, startedAt, title, ... }]`. May be async. |
| `events(session)` | The session's events. May be async. |
| `usage(session)` | Tokens by model. May be async. |
| `noPrefilter` | Optional. `true` when sessions are not one file with one event per line (opencode's database). A search then parses every session. |

An event is `{ i, ts, role, text, tool?, toolId?, input?, ok?, model? }`:

| Field | Rule |
|---|---|
| `i` | Position in the session, from 0. It is the citation, so it must be stable. |
| `role` | `user` for what the person typed. `assistant` for the agent's text. `tool_call` and `tool_result` for tools, paired by `toolId`. `system` for text the agent injected (instruction files, reminders, environment blocks). Keep injected text out of `user`: titles and prompts come from it. |
| `text` | The text. For a `tool_call`, the arguments as a JSON string. |
| `ok` | On a `tool_result`: `false` when the tool failed. |

[`src/transcripts/common.mjs`](https://github.com/temet-ai/ask-kit/blob/main/src/transcripts/common.mjs)
has the helpers: `indexed` (caches each file's metadata by modification time and size, and adds
`source`, `file`, `size` and `updatedAt`), `head` (the first 256 KB of a file, cut at a line),
`parseLines`, `walk`, `textOf`, `titleOf`, `clip` and `fileMayMatch`.

Save as `src/transcripts/acme-cli.mjs`:

```js
// Acme CLI: one JSONL file per session in ~/.acme/sessions/<session id>.jsonl (ACME_HOME moves ~/.acme).
// A line is {at, kind, ...}: session, user, assistant, tool, result, usage.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { head, indexed, parseLines, titleOf, walk } from "./common.mjs";

const base = () => path.join(process.env.ACME_HOME || path.join(os.homedir(), ".acme"), "sessions");
const files = () => walk(base(), /\.jsonl$/, 1);

// Metadata from the top of the file: id, working directory, start time, first prompt.
function meta(file) {
  let id = path.basename(file, ".jsonl");
  let cwd = null;
  let startedAt = null;
  let title = null;
  for (const line of head(file).split("\n")) {
    if (!line) continue;
    let r;
    try {
      r = JSON.parse(line);
    } catch {
      continue;
    }
    if (r.kind === "session") {
      id = r.id ?? id;
      cwd = r.cwd ?? null;
      startedAt = r.at ?? null;
    }
    if (!title && r.kind === "user") title = titleOf(r.text);
    if (startedAt && title) break;
  }
  if (!startedAt) return null; // not a session file: left out of the list
  return { id, cwd, project: cwd ? path.basename(cwd) : null, startedAt, title };
}

function events(s) {
  const out = [];
  const push = (e) => out.push({ i: out.length, ...e });
  for (const r of parseLines(s.file)) {
    const ts = r.at;
    switch (r.kind) {
      case "user":
        push({ ts, role: "user", text: r.text });
        break;
      case "assistant":
        push({ ts, role: "assistant", text: r.text, model: r.model });
        break;
      case "tool":
        push({ ts, role: "tool_call", tool: r.name, toolId: r.id, input: r.args, text: JSON.stringify(r.args ?? {}) });
        break;
      case "result":
        push({ ts, role: "tool_result", toolId: r.id, ok: r.ok !== false, text: String(r.output ?? "") });
        break;
    }
  }
  return out;
}

function usage(s) {
  const byModel = {};
  for (const r of parseLines(s.file)) {
    if (r.kind !== "usage") continue;
    const u = (byModel[r.model ?? "unknown"] ??= { calls: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0 });
    u.calls++;
    u.input += r.in ?? 0;
    u.output += r.out ?? 0;
  }
  return byModel;
}

export const adapter = {
  name: "acme-cli",
  label: "Acme CLI",
  where: () => base(),
  available: () => fs.existsSync(base()),
  sessions: () => indexed("acme-cli", files(), meta),
  events,
  usage,
};
```

Points to carry over to a real agent:

- Read the cheap metadata (`meta`) from the top of the file with `head`, so listing thousands of
  sessions does not parse each file in full.
- Return `null` from `meta` for a file that is not a session. `indexed` leaves it out.
- Where the agent records no working directory (Gemini CLI), set `cwd: null` and make `project` a
  label such as `gemini:<hash prefix>`.
- Keep one transcript's tool results paired with their calls by `toolId`. The `session-tools` and
  `session-digest` scripts count failures through that pairing.
- A store that is a database or one JSON document is read in `events` and `sessions` directly:
  see `opencode.mjs` and `gemini-cli.mjs`.

Register the adapter in `src/transcripts/index.mjs`:

```js
import { adapter as acmeCli } from "./acme-cli.mjs";
// ...
export const ADAPTERS = Object.fromEntries([claudeCode, codex, copilotCli, geminiCli, opencode, acmeCli].map((a) => [a.name, a]));
```

Add the agent's home variable to the list of variables in
[Files and environment variables](../reference/files-and-env.md).

## 2. Check the adapter against a file

Put a synthetic session at `~/.acme/sessions/ac-0001.jsonl` or, without touching your home
folder, in a throwaway folder:

```json
{"at":"2026-11-17T10:00:00Z","kind":"session","id":"ac-0001","cwd":"/work/shop-api"}
{"at":"2026-11-17T10:00:01Z","kind":"user","text":"List the failing tests"}
{"at":"2026-11-17T10:00:02Z","kind":"tool","id":"t1","name":"shell","args":{"command":"npm test"}}
{"at":"2026-11-17T10:00:03Z","kind":"result","id":"t1","ok":false,"output":"2 failing"}
{"at":"2026-11-17T10:00:04Z","kind":"assistant","text":"Two tests fail: retry and cursor.","model":"acme-1"}
{"at":"2026-11-17T10:00:04Z","kind":"usage","model":"acme-1","in":120,"out":18}
```

From the ask-kit folder, with that file in `$TMP/sessions/`:

```sh
ACME_HOME=$TMP ASK_KIT_STATE=$(mktemp -d) node --input-type=module -e '
const { ADAPTERS, makeHistory } = await import("./src/transcripts/index.mjs");
const a = ADAPTERS["acme-cli"];
const [s] = await a.sessions();
console.log(s);
console.log((await a.events(s)).map((e) => [e.i, e.role, e.tool ?? "", e.text.slice(0, 30)].join(" | ")));
console.log(await a.usage(s));
console.log((await makeHistory({ sources: ["acme-cli"] }).grep("cursor")).map((x) => `${x.source} ${x.session} #${x.i}`));
'
```

You should see one session with `project: 'shop-api'` and the title `List the failing tests`, four
events (`user`, `tool_call`, `tool_result`, `assistant`) with the tool result paired to its call,
usage of 120 input and 18 output tokens, and one search hit: `acme-cli ac-0001 #3`.

## 3. Add the agent to the list

In `src/providers.mjs`, add a line to `AGENTS`:

```js
"acme-cli": { label: "Acme CLI", bin: "acme", source: "acme-cli", client: "acme-cli" },
```

| Field | Meaning |
|---|---|
| key | The name `detect`, bundle targets and `config.clients` use. |
| `label` | What setup prints. |
| `bin` | The program `detect` looks for on `PATH` and runs with `--version`. An agent counts as installed when that works. |
| `source` | The adapter's `name`. |
| `client` | The key of its `REGISTER` entry, or `null` when ask-kit cannot register `ask` in it. With `null`, setup does not offer the agent for the `clients` question. |

After this, `ask-kit detect` lists the agent with its session count, and `ask-kit questions`
offers its transcripts as a source.

## 4. Register the `ask` tool

`REGISTER[client]` returns `{ client, what, run(), remove() }`. Setup prints `what` before it
changes anything, then calls `run()`. `ask-kit uninstall` calls `remove()`.

When the agent keeps its MCP servers in a JSON file, the `jsonServer(client, file, keyPath, entry)`
helper in `register.mjs` does the work. `SERVE` holds the command and arguments that start the
server (`node <ask-kit>/bin/ask-kit.mjs serve`). Add to `REGISTER`:

```js
"acme-cli": () =>
  jsonServer("acme-cli", path.join(process.env.ACME_HOME || home(".acme"), "mcp.json"), "mcpServers", { ...SERVE, timeout: 600_000 }),
```

Use what the agent's own documentation says about the entry's shape. Two things matter:

- **Tool timeout.** An investigation can take minutes. Codex stops a tool call at 60 seconds
  unless told otherwise, so its entry sets `tool_timeout_sec = 600`. Find the equivalent for your
  agent. If it has none, an ask can be dropped by the client before it finishes. If the agent sets
  `MCP_TOOL_TIMEOUT` in the server's environment, ask-kit ends the ask early enough to answer.
- **Re-running.** The entry must replace an earlier one, not add a second.

An agent with its own `mcp add` command, as Claude Code has, is registered through it (see
`claudeCode()`).

## 5. Install the skills and rule

`TARGETS` in `src/setup/bundle.mjs` says where the agent reads skills, subagents and instructions:

```js
"acme-cli": {
  label: "Acme CLI",
  base: () => process.env.ACME_HOME || path.join(H(), ".acme"),
  skills: "skills",
  agents: null,
  rule: { file: "AGENTS.md", mode: "block" },
  verified: false,
},
```

| Field | Meaning |
|---|---|
| `base` | The agent's own folder. `init` skips an agent whose folder does not exist. |
| `skills` | The sub-folder holding `<name>/SKILL.md`. |
| `agents` | `{ dir, format }` for a subagent folder, or `null` when there is none. A new `format` needs a case in `agentFile`, which rewrites the front matter. |
| `rule` | The when-to-ask rule. `mode: "file"` writes its own file (add `front` for required front matter). `mode: "block"` adds a marked block to a file the user owns. |
| `verified` | `false` marks a format taken from documentation and not checked on a real install. `init` says so. |

Each file is recorded with its hash in `installed.json`. A file the user edited is left alone, and
`uninstall` removes only what ask-kit wrote.

## 6. Handle the session id

ask-kit keeps a follow-up's state per calling session. It takes the session id from the first of
`ASK_KIT_SESSION`, `CLAUDE_CODE_SESSION_ID`, `CODEX_THREAD_ID`, `CODEX_SESSION_ID` and
`COPILOT_SESSION_ID` that is set, and from the parent process id when none is. If your agent puts
its session id in the environment of its MCP servers, add the variable name to the list in
`callerSession` in `src/config.mjs`, and to the list of variables `childEnv` removes in
`src/ask.mjs`. The two lists have to match. If the agent sets none, nothing is needed: follow-ups
work per agent process.

## 7. Update the sessions domain's lists

The investigator learns the sources from these:

- `type Source` in `domains/sessions/api.d.ts`.
- The `source` parameter text in `domains/sessions/scripts/recent.mjs`.
- Optionally, the line in `domains/sessions/instructions.md` that names each agent's tools (Claude
  Code `Bash`, Codex `exec_command`). Add yours if its tool names differ and a question might name
  them.

## 8. Test it

The adapter tests are in `test/fixtures.mjs`. They copy `test/fixtures/<agent>/` into a temporary
folder, point the agent's home variable there and import the adapters afterwards.

1. Put the synthetic file under `test/fixtures/acme-cli/sessions/ac-0001.jsonl`. Use `__CWD__` where
   the working directory goes: the test replaces it with a real path on the system running it.
   Names come from Terry Pratchett's Discworld or `shop-api`, as in the other fixtures.
2. In `test/fixtures.mjs`, add the agent to `homes` (`"acme-cli": "acme"`) and set
   `process.env.ACME_HOME = path.join(tmp, "acme")`.
3. Add a block like the others: the session is found, `cwd`, `project` and `title` are right,
   the roles come out in order, every tool call has one result with the same `toolId`, a failed tool
   has `ok: false`, and `usage` equals the totals in the file.
4. Update the `makeHistory` block: the sorted id list and `all.total` now include `ac-0001`.
5. Run `npm test`.

If you added a registration or bundle target, also extend `test/setup.mjs` (the registration is
written twice into a throwaway home and must replace, not duplicate) and `test/bundle.mjs`
(the agent's folder is created in a temporary home, and a reinstall changes nothing). See
[Testing](testing.md).

## 9. Check on a real machine

With a real install of the agent:

```sh
npm run test:machine    # reads this machine's transcripts through every adapter
ask-kit detect          # the agent, its version and its session count
ask-kit doctor          # "source acme-cli: N sessions" (after the config lists it)
```

`test:machine` fails when a store exists but yields no sessions, or none of the five newest has a
user event. Then ask a question that names the agent:

```sh
ask-kit ask --domain sessions "what did my last acme-cli session do?"
```

Open a pull request with the adapter, the fixture and the tests. Say in the description whether
the format was checked against a real install or only against its documentation.
[Troubleshooting](../troubleshooting.md) lists the formats that are not checked yet.

Related: [Transcripts](../internals/transcripts.md), [Setup](../internals/setup.md),
[Investigator API reference](../reference/domain-api.md#the-sessions-domain).
