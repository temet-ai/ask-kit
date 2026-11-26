---
title: Kits - ask-kit as a host
status: draft
created: 2026-11-18
updated: 2026-11-19
summary: ask-kit becomes a lean, generic host (router, investigator loop, REPL, journal, backends, install) and everything it knows or does comes from kits, folders with a TOML manifest that point at a source (a folder, a CLI, an MCP server, an HTTP API, a JS module). Modelled on herdr's plugin system and on what made coding agents good.
session_id:
  - 4e289079-da5f-498b-bd4d-facad52bf096
---

# Kits: ask-kit as a host

`ask` is one tool in every agent. A **kit** is what it knows about and what it can do. ask-kit is
the host: the router, the investigator loop, the REPL, the journal, the backends and install. It
stays small, and everything else is a kit.

## What this makes possible

- **Any MCP server becomes a kit in a few lines.** Its tools become functions in the
  investigator's REPL. The calling agent stops carrying the server's tool schemas in every
  request and carries one `ask` description in their place. The MCP ecosystem plugs in
  behind ask instead of in front of the agent.
- **Any CLI becomes a kit.** `gh`, `kubectl`, `docker`, `psql`, `herdr`, `mike`. herdr's lesson
  applies: the CLI is the API, and no SDK is needed.
- **Any folder becomes a kit with no code.** Docs, notes, logs, a vendored repository. mike-ask's
  `docs` domain is already the code domain pointed at a folder.
- **Kits that do work, not only answer.** A fleet kit defines and starts a fleet of sessions. An ops
  kit restarts a service. A GitHub kit triages issues. Each declares which of its calls change
  things.
- **Kits from anyone.** They install from GitHub, are discovered by topic, and work in every agent
  that ask serves: Claude Code, Codex, Copilot CLI, Gemini CLI and opencode.

Today ask-kit has domains, and writing one means following a 427-line guide and five files,
including a hand-written client, just to answer about a folder of notes. A herdr plugin is a
manifest and one script. Kits should be at least that easy.

## Why this shape: what made agents good

| What made coding agents good | The kit equivalent |
|---|---|
| A small loop with a few general tools beat bespoke pipelines | The investigator writes JS over a kit's globals. There is no endpoint per question. |
| Code instead of chains of tool calls (code mode, programmatic tool calling) | Four calls become one program (already measured in `docs/user-guide/how-it-works.md`) |
| Skills: the name and description are always loaded, the body only on demand | The caller and the router see only a kit's `says` line. Its instructions, API and scripts load only when a question is routed there. |
| Agents write their own tools | Drafts become scripts, and scripts become actions (below) |
| Evals drive every improvement | Every kit ships `bench/questions.json`, and `ask-kit kit test` runs it on each backend |
| Open formats and marketplaces (MCP, plugins, skills) | A TOML manifest is the contract; kits are discovered by GitHub topic |
| Good scaffolding makes cheap models do the work | The kit is the scaffolding, and the model is a setting |

herdr adds the host's lessons: keep the core lean, make the manifest the whole contract, accept any
language, use the existing CLI as the API, install from `owner/repo[/subdir]` with a preview, give
each plugin its own config and state folder, and let a GitHub topic be the marketplace.

## The manifest: `ask-kit.toml`

The smallest kit is two lines of meaning and no code:

```toml
id = "me.notes"
name = "notes"
version = "0.1.0"
says = "my markdown notes in ~/notes: what I wrote about something, when, which notes carry a tag"

[[sources]]
kind = "folder"
name = "notes"
path = "~/notes"
```

A kit that does work:

```toml
id = "temet.fleet"
name = "fleet"
version = "0.1.0"
min_ask_kit = "0.2.0"
platforms = ["linux", "macos"]
says = "mike fleets: define, start, watch, steer and review a fleet of agent sessions"
keywords = ["fleet", "seats?", "run a fleet"]
route_hint = "defining, starting, watching or reviewing a fleet is fleet; what a past session said about one is sessions"
patterns = ['^fleet-[a-z0-9-]+-[0-9a-f]{8}$']   # inputs this kit claims outright, like herdr's link handlers
uses = ["code"]                                 # this kit's REPL also gets the code kit's globals
instructions = "instructions.md"
scripts = "scripts"
bench = "bench/questions.json"

[[sources]]
kind = "mcp"
name = "mike"
command = ["mike-mcp", "--full"]
allow = ["get_fleet", "define_fleet", "get_fleet_record", "list_fleet_changes", "answer", "kill_session", "send_session_message"]
acts = ["define_fleet", "answer", "kill_session", "send_session_message"]   # shown at install, journaled, stamped with the calling session

[[sources]]
kind = "module"
name = "runs"
module = "runs.mjs"

[[settings]]
key = "MIKE_INSPECT_URL"
default = "http://127.0.0.1:9989"

[[actions]]
id = "status"
script = "status"
title = "Fleet status digest"

[[build]]
command = ["npm", "ci"]
```

| Field | Meaning |
|---|---|
| `id`, `name`, `version`, `min_ask_kit`, `platforms` | Package metadata, as in herdr. `name` is the value of `about`. |
| `says`, `keywords`, `route_hint`, `patterns` | Everything the router reads. Nothing is hard-coded in `router.mjs` any more. |
| `uses` | Other kits whose sources this kit's REPL also gets |
| `[[sources]]` | What the REPL can reach. Each one becomes a global with a generated `api.d.ts`. |
| `acts` | The calls that change things. The install preview lists them, the journal marks them, and they carry the caller's session id. |
| `reads` | The commands an agent runs by hand to read what the kit answers about (`mike fleet status`). The Claude Code plugin's nudge and `ask-kit gaps` count them as lookups for this kit. |
| `instructions`, `scripts`, `bench` | Optional. Without `instructions`, the host writes default instructions from the source kinds. |
| `[[settings]]` | Asked at setup and kept in the kit's config folder |
| `[[actions]]` | Scripts callable without a model (below) |
| `[[build]]` | Runs at install after the preview, as in herdr |
| `[warm]` | A script run with no model when a session starts (the plugin's async SessionStart hook), with its params and a one-line notice, and the warm session's first prompt (`prime`). The code domain builds its map this way. |

`domain.mjs` keeps loading: a `module` source plus fields mapped onto the manifest, so the
current domains and the gallery keep working while they move over.

## Sources: the host does the plumbing

| Kind | The global the investigator gets | How `api.d.ts` is made |
|---|---|---|
| `folder` | `rg`, `files`, `read`, `git`, scoped to the path (today's `repo`) | fixed |
| `cli` | `gh("issue", "list", "--json", "title")` through `execFile`, with no shell | from `--help`, read once when the kit warms |
| `mcp` | `mike.get_fleet({ fleet })`, one function per allowed tool | from the tools' JSON schemas (mike-ask `src/mcp.mjs` is the start of this) |
| `http` | a typed client | from an OpenAPI document |
| `transcripts` | `history` over every agent's transcripts (today's `sessions`) | fixed |
| `module` | whatever the JS module returns (today's `makeGlobals`) | the author's file |

The investigator always works in JS. The kit author doesn't have to: a Python tool, a Rust binary or
a shell script is a `cli` source.

## Two speeds: actions and asks

The cheapest ask uses no model. A kit's `[[actions]]` are named scripts that run directly:
`ask-kit run fleet status forge-g` from a shell or a hook, or `ask` with `do: "fleet.status"`.
A question matching a kit's `patterns` goes straight to that kit with no router call. The journal
shows which scripts investigators keep running unchanged, and those become actions. This is the
same path as draft, then script, then action, that turns repeated digging into a fast lookup.

**Built (commit a3202dc, 2026-11-19):** `do` and `params` on `ask` and the router,
`ask-kit run <kit> <script> [key=value]`, the shot held as `shots.<script>` for a `continue: true`
ask, and early answers (`early_answer`, the partial note, `continue: true` collects the rest). A
shot runs any script the kit's REPL lists (its own, the host's folder scripts, a used kit's). The
`[[actions]]` table that names and titles them, and picks one from the question, was built on
2026-11-19 (src/actions.mjs).

## Composition

**Built (commits 80f7da3 and 8c0413d):** `uses`, `ask.kit`, and the kit's own playbooks, which
this note had not listed: `skills` (a folder of Markdown) and `[[roles]]` (`name`, `when`,
`instructions`, `patterns`), read in the REPL with `skills.list()` and `skills.read(name)`.

- `uses` shares sources between kits. A missing or unavailable used kit makes this kit
  unavailable, and a cycle is refused.
- Inside a REPL, `ask.kit("sessions", "...")` asks another kit (depth 1, journaled). The fleet kit
  uses it to ask whether something was done before.
- A pack is one repository with several kits, installed by `owner/repo/subdir`. The mike pack
  holds `mike`, `ops`, `docs` (a folder kit, no code) and `fleet`.

## Commands

| Command | Does |
|---|---|
| `ask-kit kit new <name> --from folder:<path>\|cli:<cmd>\|mcp:<cmd>\|openapi:<url>` | Writes the manifest, generates `api.d.ts`, has the backend draft `instructions.md` and five bench questions by asking about the source |
| `ask-kit kit link <dir>` | Uses a working folder in place; changes reload on the next question |
| `ask-kit kit test <name> [--backends a,b]` | Runs the bench and reports score, time and price per backend |
| `ask-kit kit install <owner/repo[/subdir]> [--ref] [--yes]` | Shows a preview (sources, `acts`, build commands), then installs. This replaces `add`. |
| `ask-kit kit update`, `list`, `enable`, `disable`, `log`, `config-dir` | As in herdr |

Kits are discovered by the GitHub topic `ask-kit`, with `ask-kit-domain` still accepted, on
repositories whose default branch has a parseable `ask-kit.toml`.

## Improvement belongs to the host

Every kit gets the journal, `ask-kit report`, drafts and the tuner agent without writing any of
them. `ask-kit-tuner` becomes per-kit: it reads one kit's journal, fixes that kit's instructions,
scripts or actions, and proves the fix with that kit's bench.

## Trust

As in herdr: kits are code that runs as you. There is no sandbox. Installing shows a preview,
and `--ref` pins a version. The manifest also names every call that changes something
(`acts`), so the preview can show what a kit can do, not only what it runs.

## What is built and what remains (2026-11-19)

| Part | State |
|---|---|
| Manifest, `folder`, `cli`, `module`, `mcp` sources, `kit new --from folder\|cli`, `link`, `list`, `test`, `install`, `enable`, `disable`, `patterns` routing, `requires`, `platforms` | Built (see the user guide) |
| Shots, early answers, skills, roles, `uses`, `ask.kit` | Built, with offline tests: `test/shots.mjs`, `test/early.mjs`, `test/kits.mjs`, `test/kitcall.mjs` |
| `[[actions]]` (named, titled scripts matched from the question, guarded and shadowed) | Built, with an offline test: `test/actions.mjs`. The user guide's [Actions](../user-guide/kits.md#actions) |
| `roleFor` called by the `ask` tool | Not built |
| `http` source, `kit new --from mcp\|openapi`, `kit update`, `log`, `config-dir`, `id`, `min_ask_kit` | Not built |
| `code` and `sessions` as kits | Not built: both still load as `domain.mjs` domains |
| Fleet kit | Built, in the private repository `temet-ai/ask-kit-fleet`, on mike's MCP tools directly (no mike pack under it) |
| mike kit | Built (2026-11-19): `temet-ai/ask-kit-mike` (private). mike-ask is now a launcher that runs ask-kit's router with the mike kit, `ops` as a kit, `claude-code-docs` and the built-in `code` and `sessions` |
| Marketplace page | Built (2026-11-19): https://temet-ai.github.io/ask-kit/, from `site/` and the `kits-site` workflow, rebuilt every six hours from the topic |
| `[[settings]]` `about` | Built (2026-11-19): shown by `kit list` for a missing required setting, in the install preview and on the kits page |
| Claude Code plugin | Built (2026-11-19): `.claude-plugin/` makes the repository its own marketplace (`ask-kit@temet-ai`); `init` and `setup` skip Claude Code while it is installed. Its PostToolBatch hook (PostToolUse until 2026-11-26) nudges after the third lookup in a row, naming the question the lookups seem to be for, and its SubagentStart hook gives subagents the rule (built 2026-11-20, `src/nudge.mjs`) |
| Share of asks answered with no model, in `kit test` and `report` | Built (commit a17229c, 2026-11-19): cells per question and `noModel` in `kit test`, bench questions with `do` run as shots, `shots` and `noModelShare` in `ask-kit report` |

## What changes, in order, with the measure for each

1. **Manifest, plus the `folder`, `cli` and `module` sources.** Port `code` and `sessions`. The
   router reads manifests. Measure: a new folder kit takes two files and fewer than 15 lines, and
   the existing benches score the same.
2. **The `mcp` source**, from mike-ask's `src/mcp.mjs`. The mike kit is built from `mike-mcp` with
   no hand-written client. Measure: mike-ask's bench scores the same on the generated globals.
3. **`kit new --from` and `kit test`.** Measure: from nothing to a `gh` kit that passes a
   five-question bench, in one `kit new` and one `kit test`.
4. **Actions and `patterns`.** Measure: the share of asks answered with no model call, from the
   journal.
5. **mike-ask becomes the mike pack** on ask-kit, and the fleet kit (`temet-ai/ask-kit-fleet`) is
   built on it.
6. **A marketplace page**, indexed from the topic like herdr.dev/plugins.
