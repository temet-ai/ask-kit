# Internals

This section tells a contributor where things are in the code and what to read before changing
them. Each page names the files, the functions and constants to look for, how the part works, and
the tests that cover it. Paths are relative to the repository root, and the links go to the files
on GitHub. The pages describe the code on the `main` branch.

## The processes

An `ask` passes through up to six processes. Each one is a Node.js program from this repository,
except the agent and, for some backends, the investigator.

```
your agent (Claude Code, Codex, ...)
  └─ node bin/ask-kit.mjs serve          MCP server "ask", one tool: ask
       └─ src/router.mjs                 picks a domain; starts one child per domain
            └─ node src/server.mjs       outer face of one domain; tool: ask (src/ask.mjs)
                 └─ the investigator     claude -p, codex exec, copilot -p, or an API loop in ask.mjs
                      └─ node src/server.mjs   inner face, ASK_KIT_INNER=1; tools: repl, help, reset, load
                           └─ node:vm context holding the domain's globals and scripts
```

| Process | Started by | What it does | Code |
|---|---|---|---|
| Agent | you | Calls the `ask` tool over MCP (stdio). | The agent's own config, written by `ask-kit setup` (`REGISTER` in `src/setup/register.mjs`). |
| `ask-kit serve` | the agent | Writes the guide (`writeAgentsMd`), then runs the router. With `--domain d` it skips the router and loads `src/server.mjs` for that one domain. | `case "serve"` in `bin/ask-kit.mjs` |
| Router | `serve` | Exposes one `ask` tool for every enabled domain. Chooses the domain, starts that domain's server on first use and forwards the call. | `makeRouter`, `serveRouter` in `src/router.mjs` |
| Domain server, outer face | the router | Exposes `ask` with the domain's own description, runs the backend and keeps the journal. | `registerAsk` in `src/ask.mjs`, called from the end of `src/server.mjs` |
| Investigator | `registerAsk` | The model that digs. For `claude-cli`, `codex-cli` and `copilot-cli` backends it is that CLI running headless with the REPL as its only MCP server. For an `api` backend `ask.mjs` runs the loop itself. | `src/ask.mjs`, `src/providers.mjs`, `src/ollama.mjs` |
| Domain server, inner face | the investigator (or `ask.mjs` for an API backend) | The REPL: `repl`, `help`, `reset` and `load` tools over a `node:vm` context with the domain's globals, a toolkit and the scripts. | `src/server.mjs` with `ASK_KIT_INNER=1` |

The same file, `src/server.mjs`, is both faces. `ASK_KIT_INNER=1` selects the inner one. The
inner face never registers `ask`, and the outer face never registers the REPL tools (the
`replTool` constant near the middle of the file).

## Source map

Every file in the repository except `docs/`, `package-lock.json` and the notices file.

### bin/

| File | What it holds |
|---|---|
| [bin/ask-kit.mjs](https://github.com/temet-ai/ask-kit/blob/main/bin/ask-kit.mjs) | The `ask-kit` command: `serve`, `detect`, `questions`, `apply`, `setup` (terminal wizard), `init`, `doctor`, `ask`, `report`, `gallery`, `add`, `lines`, `uninstall`. Every command imports what it needs on demand. |

### src/

| File | What it holds |
|---|---|
| [src/server.mjs](https://github.com/temet-ai/ask-kit/blob/main/src/server.mjs) | One domain's MCP server, both faces. The REPL: script registry (`refreshScripts`, `scripts`), `vm` context, cell runner (`runCell`), snapshots (`snapshot`, `restoreFrom`) and the per-cell journal. |
| [src/ask.mjs](https://github.com/temet-ai/ask-kit/blob/main/src/ask.mjs) | `registerAsk`: the `ask` tool of a domain. The four backend kinds, the warm session and its fingerprint, follow-ups, the API loop, cost and step accounting. |
| [src/router.mjs](https://github.com/temet-ai/ask-kit/blob/main/src/router.mjs) | The `ask` tool agents see: domain routing (`about`, follow-up, router model, keyword `RULES`) and one child server per domain. |
| [src/domains.mjs](https://github.com/temet-ai/ask-kit/blob/main/src/domains.mjs) | `domainDirs`, `listDomains`, `loadDomain`: where domains are found. See [domains.md](domains.md). |
| [src/gallery.mjs](https://github.com/temet-ai/ask-kit/blob/main/src/gallery.mjs) | `ask-kit gallery` and `ask-kit add`: shared domains from GitHub. See [domains.md](domains.md). |
| [src/config.mjs](https://github.com/temet-ai/ask-kit/blob/main/src/config.mjs) | Folder locations (`CONFIG_DIR`, `STATE_ROOT`), `loadConfig`/`saveConfig`, key storage and lookup (`storeKey`, `resolveKey`), `callerSession`, `slug`. |
| [src/platform.mjs](https://github.com/temet-ai/ask-kit/blob/main/src/platform.mjs) | `which`, `spawnCli`, `runCli` (Windows `.cmd` shims) and `rgPath` (system or bundled ripgrep). |
| [src/providers.mjs](https://github.com/temet-ai/ask-kit/blob/main/src/providers.mjs) | The tables `API_PRESETS`, `AGENT_CLIS` and `AGENTS`: every model source and every coding agent ask-kit knows. |
| [src/ollama.mjs](https://github.com/temet-ai/ask-kit/blob/main/src/ollama.mjs) | `ollamaChat` and `ollamaContextLength`: Ollama through `/api/chat` so the context size can be set. |
| [src/report.mjs](https://github.com/temet-ai/ask-kit/blob/main/src/report.mjs) | `report`: what `ask-kit report` prints from the journals. See [setup.md](setup.md). |
| [src/agentsmd.mjs](https://github.com/temet-ai/ask-kit/blob/main/src/agentsmd.mjs) | `agentsMd`, `writeAgentsMd`: the per-machine guide, `~/.config/ask-kit/AGENTS.md`. See [setup.md](setup.md). |
| [src/quotes.mjs](https://github.com/temet-ai/ask-kit/blob/main/src/quotes.mjs) | Quoted rows: the REPL's `quote` global (`makeQuote`), the `{{quote:<id>}}` marker, and `insertQuotes`, which writes the kept rows into an answer. See [repl.md](repl.md#quoted-rows). |
| [src/core/rewrite.mjs](https://github.com/temet-ai/ask-kit/blob/main/src/core/rewrite.mjs) | `rewriteCell`: turns a REPL cell into a script whose top-level names stay global. See [repl.md](repl.md). |
| [src/core/toolkit.mjs](https://github.com/temet-ai/ask-kit/blob/main/src/core/toolkit.mjs) | The helpers every cell and script can use: `clip`, `shape`, `pick`, `omit`, `table`, `top`, `groupBy`, `countBy`, `sumBy`, `since`, `minutes`. |
| [src/setup/detect.mjs](https://github.com/temet-ai/ask-kit/blob/main/src/setup/detect.mjs) | `detect`: what the machine has. |
| [src/setup/questions.mjs](https://github.com/temet-ai/ask-kit/blob/main/src/setup/questions.mjs) | `questions`, `investigatorChoices`, `keyQuestion`: the setup conversation. |
| [src/setup/apply.mjs](https://github.com/temet-ai/ask-kit/blob/main/src/setup/apply.mjs) | `plan`, `apply`, `backendName`: answers to config and registrations. |
| [src/setup/register.mjs](https://github.com/temet-ai/ask-kit/blob/main/src/setup/register.mjs) | `REGISTER`: adds and removes the `ask` MCP server in each agent. |
| [src/setup/bundle.mjs](https://github.com/temet-ai/ask-kit/blob/main/src/setup/bundle.mjs) | `TARGETS`, `installBundle`, `uninstallBundle`: skills, agent and rule per coding agent, with hash tracking. |
| [src/transcripts/index.mjs](https://github.com/temet-ai/ask-kit/blob/main/src/transcripts/index.mjs) | `makeHistory` (the `history` global), `ADAPTERS`, `cite`. See [transcripts.md](transcripts.md). |
| [src/transcripts/common.mjs](https://github.com/temet-ai/ask-kit/blob/main/src/transcripts/common.mjs) | The event shape, the session index cache (`indexed`), `fileMayMatch` and small readers. |
| [src/transcripts/claude-code.mjs](https://github.com/temet-ai/ask-kit/blob/main/src/transcripts/claude-code.mjs) | Claude Code adapter. |
| [src/transcripts/codex.mjs](https://github.com/temet-ai/ask-kit/blob/main/src/transcripts/codex.mjs) | Codex adapter. |
| [src/transcripts/copilot-cli.mjs](https://github.com/temet-ai/ask-kit/blob/main/src/transcripts/copilot-cli.mjs) | GitHub Copilot CLI adapter. |
| [src/transcripts/gemini-cli.mjs](https://github.com/temet-ai/ask-kit/blob/main/src/transcripts/gemini-cli.mjs) | Gemini CLI adapter. |
| [src/transcripts/opencode.mjs](https://github.com/temet-ai/ask-kit/blob/main/src/transcripts/opencode.mjs) | opencode adapter (SQLite). |

### domains/

| File | What it holds |
|---|---|
| [domains/code/domain.mjs](https://github.com/temet-ai/ask-kit/blob/main/domains/code/domain.mjs) | The `code` domain: repository root, `repo` global, the words of its `ask` tool. |
| [domains/code/repo.mjs](https://github.com/temet-ai/ask-kit/blob/main/domains/code/repo.mjs) | `makeRepo`: the `repo` client (ripgrep, file reads, writes and edits, any program, git). |
| [domains/code/lib.mjs](https://github.com/temet-ai/ask-kit/blob/main/domains/code/lib.mjs) | `NOISE`, `spellings`, `escape`, `definitionPattern`: shared by the code scripts. |
| [domains/code/api.d.ts](https://github.com/temet-ai/ask-kit/blob/main/domains/code/api.d.ts) | The typed API the investigator reads for `code`. |
| [domains/code/instructions.md](https://github.com/temet-ai/ask-kit/blob/main/domains/code/instructions.md) | The investigator's system prompt for `code`. |
| [domains/code/scripts/where.mjs](https://github.com/temet-ai/ask-kit/blob/main/domains/code/scripts/where.mjs) | Script: where a name is defined and used. |
| [domains/code/scripts/knobs.mjs](https://github.com/temet-ai/ask-kit/blob/main/domains/code/scripts/knobs.mjs) | Script: settings, env vars, flags and constants about a topic. |
| [domains/code/scripts/history.mjs](https://github.com/temet-ai/ask-kit/blob/main/domains/code/scripts/history.mjs) | Script: when and why something changed (`git log -S`). |
| [domains/code/scripts/outline.mjs](https://github.com/temet-ai/ask-kit/blob/main/domains/code/scripts/outline.mjs) | Script: top-level definitions of a file or folder. |
| [domains/code/scripts/overview.mjs](https://github.com/temet-ai/ask-kit/blob/main/domains/code/scripts/overview.mjs) | Script: the repository at a glance. |
| [domains/sessions/domain.mjs](https://github.com/temet-ai/ask-kit/blob/main/domains/sessions/domain.mjs) | The `sessions` domain: `history` and `cite` globals, the words of its `ask` tool. |
| [domains/sessions/api.d.ts](https://github.com/temet-ai/ask-kit/blob/main/domains/sessions/api.d.ts) | The typed API for `sessions`: `Session`, `Event`, `history`. |
| [domains/sessions/instructions.md](https://github.com/temet-ai/ask-kit/blob/main/domains/sessions/instructions.md) | The investigator's system prompt for `sessions`. |
| [domains/sessions/scripts/find-sessions.mjs](https://github.com/temet-ai/ask-kit/blob/main/domains/sessions/scripts/find-sessions.mjs) | Script: which sessions discussed a topic. |
| [domains/sessions/scripts/session-digest.mjs](https://github.com/temet-ai/ask-kit/blob/main/domains/sessions/scripts/session-digest.mjs) | Script: one session, compactly. |
| [domains/sessions/scripts/grep.mjs](https://github.com/temet-ai/ask-kit/blob/main/domains/sessions/scripts/grep.mjs) | Script: exact text across transcripts. |
| [domains/sessions/scripts/recent.mjs](https://github.com/temet-ai/ask-kit/blob/main/domains/sessions/scripts/recent.mjs) | Script: sessions in a time window. |
| [domains/sessions/scripts/session-tools.mjs](https://github.com/temet-ai/ask-kit/blob/main/domains/sessions/scripts/session-tools.mjs) | Script: tool calls of a session, failures, token use. |
| [domains/sessions/scripts/session-changes.mjs](https://github.com/temet-ai/ask-kit/blob/main/domains/sessions/scripts/session-changes.mjs) | Script: files a session edited. |

### bundle/

| File | What it holds |
|---|---|
| [bundle/rules/ask.md](https://github.com/temet-ai/ask-kit/blob/main/bundle/rules/ask.md) | The rule that tells an agent when to call `ask`. |
| [bundle/agents/ask-kit-tuner.md](https://github.com/temet-ai/ask-kit/blob/main/bundle/agents/ask-kit-tuner.md) | The `ask-kit-tuner` agent. |
| [bundle/skills/ask-kit-setup/SKILL.md](https://github.com/temet-ai/ask-kit/blob/main/bundle/skills/ask-kit-setup/SKILL.md) | Skill: the setup conversation. |
| [bundle/skills/ask-kit-improve/SKILL.md](https://github.com/temet-ai/ask-kit/blob/main/bundle/skills/ask-kit-improve/SKILL.md) | Skill: improve `ask` from its journal. |
| [bundle/skills/ask-kit-domain/SKILL.md](https://github.com/temet-ai/ask-kit/blob/main/bundle/skills/ask-kit-domain/SKILL.md) | Skill: add, write and share a domain. |

### scripts/

| File | What it holds |
|---|---|
| [scripts/notices.mjs](https://github.com/temet-ai/ask-kit/blob/main/scripts/notices.mjs) | Generates `THIRD-PARTY-NOTICES.md` from the production dependency tree. |

### bench/

| File | What it holds |
|---|---|
| [bench/run-ask.mjs](https://github.com/temet-ai/ask-kit/blob/main/bench/run-ask.mjs) | Runs the question set through `ask`, one MCP server per domain, and writes one JSONL row per question. |
| [bench/run-baseline.mjs](https://github.com/temet-ai/ask-kit/blob/main/bench/run-baseline.mjs) | Runs the same questions with the agent digging for itself (`claude -p` with its read tools, no `ask`). |
| [bench/grade.mjs](https://github.com/temet-ai/ask-kit/blob/main/bench/grade.mjs) | Grades result rows with an LLM judge; writes `<in>.graded.jsonl`. |
| [bench/report.mjs](https://github.com/temet-ai/ask-kit/blob/main/bench/report.mjs) | Builds the tables for `RESULTS.md` from the graded files, applying `hand-grades.json`. |
| [bench/redact.mjs](https://github.com/temet-ai/ask-kit/blob/main/bench/redact.mjs) | Copies raw results into `bench/results/` with home paths and private terms replaced. |
| [bench/paths.mjs](https://github.com/temet-ai/ask-kit/blob/main/bench/paths.mjs) | Folder constants and `loadQuestions` (public set plus the git-ignored `bench/private/` set). |
| [bench/questions.json](https://github.com/temet-ai/ask-kit/blob/main/bench/questions.json) | The public question set with expected answers and sources. |
| [bench/hand-grades.json](https://github.com/temet-ai/ask-kit/blob/main/bench/hand-grades.json) | Verdicts corrected by hand over the judge's. |
| [bench/RESULTS.md](https://github.com/temet-ai/ask-kit/blob/main/bench/RESULTS.md) | The written benchmark results. |
| [bench/.gitignore](https://github.com/temet-ai/ask-kit/blob/main/bench/.gitignore) | Ignores `bench/private/`. |
| [bench/results/](https://github.com/temet-ai/ask-kit/tree/main/bench/results) | Result rows and graded rows per backend: `baseline-sonnet`, `claude-haiku`, `codex`, `copilot`, `deepseek-v4.1-flash-1017`, `glm-5.3-flash`, `qwen3.5-9b` (each as `.jsonl` and `.graded.jsonl`). |

### test/

| File | What it holds |
|---|---|
| [test/fixtures.mjs](https://github.com/temet-ai/ask-kit/blob/main/test/fixtures.mjs) | Every transcript adapter, and `makeHistory`, against made-up stores. |
| [test/setup.mjs](https://github.com/temet-ai/ask-kit/blob/main/test/setup.mjs) | The setup questions, `plan`/`apply` and the Codex and Copilot registrations, in throwaway folders. |
| [test/bundle.mjs](https://github.com/temet-ai/ask-kit/blob/main/test/bundle.mjs) | `installBundle`/`uninstallBundle` and the guide, in throwaway agent homes. |
| [test/repl.mjs](https://github.com/temet-ai/ask-kit/blob/main/test/repl.mjs) | The two faces of `src/server.mjs` over MCP with no model: scripts, cells, snapshot restore. |
| [test/adapters.mjs](https://github.com/temet-ai/ask-kit/blob/main/test/adapters.mjs) | The adapters against this machine's real transcripts. Run with `npm run test:machine`; not run in CI. |
| [test/fixtures/](https://github.com/temet-ai/ask-kit/tree/main/test/fixtures) | Synthetic stores, one folder per agent: `claude-code/projects/-work-shop-api/` (`cc-0001.jsonl`, `cc-warm.jsonl`), `codex/sessions/2026/11/17/`, `copilot-cli/session-state/cp-0001/events.jsonl`, `gemini-cli/tmp/a1b2c3d4e5f60718/chats/`. opencode's database is built inside `test/fixtures.mjs`. |

### Other top-level files

`package.json` (the `test` script, the `files` list, dependencies), `AGENTS.md` (the install
instructions an agent reads), `CONTRIBUTING.md`, `SECURITY.md`, `LICENSE`, `README.md`, and
`.github/workflows/ci.yml` (runs all test files on Linux and macOS, Node 26).

## Reading order for a new contributor

1. [How it works](../how-it-works.md): what an ask does, in plain terms.
2. This page's process list, then `bin/ask-kit.mjs` (`serve` and `ask` commands) and
   `src/router.mjs`.
3. [ask-lifecycle.md](ask-lifecycle.md): one question from the router to the answer, through
   `src/ask.mjs`.
4. [repl.md](repl.md): `src/server.mjs`, `src/core/rewrite.mjs` and `src/core/toolkit.mjs`.
5. [domains.md](domains.md): the domain contract, then `domains/code` (small) as a
   worked example.
6. [transcripts.md](transcripts.md): the adapters, if you work on the `sessions` domain.
7. [backends.md](backends.md): the four backend kinds and `src/providers.mjs`.
8. [setup.md](setup.md): `init`, `setup`, `apply`, `doctor` and the bundle, if you work on
   installation.
9. `test/` and [testing](../guides/testing.md), before your first change.

## Pages in this section

| Page | Covers |
|---|---|
| [ask-lifecycle.md](ask-lifecycle.md) | One question, from the router to the journal. |
| [repl.md](repl.md) | The REPL server: cells, scripts, snapshots, journal. |
| [backends.md](backends.md) | The investigator backends. |
| [domains.md](domains.md) | The domain contract, the two built-in domains and the gallery. |
| [transcripts.md](transcripts.md) | The five transcript adapters and the `history` API. |
| [setup.md](setup.md) | `init`, `questions`, `apply`, `setup`, `doctor`, `detect`, `uninstall`, the bundle, the guide and `report`. |

Related reference pages: [config](../reference/config.md), [the ask tool](../reference/ask-tool.md),
[the domain API](../reference/domain-api.md), [files and environment](../reference/files-and-env.md)
and [the journal](../reference/journal.md). How-to pages: [write a domain](../guides/write-a-domain.md),
[add a script](../guides/add-a-script.md), [add an agent](../guides/add-an-agent.md),
[add a backend](../guides/add-a-backend.md), [debug a bad answer](../guides/debug-a-bad-answer.md)
and [run the benchmark](../guides/run-the-benchmark.md).
