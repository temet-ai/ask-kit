---
title: Kits self-review
created: 2026-11-21
summary: A critical look at the day the incubator kits and the mesh work were built, by the session that built them. Which claims are measured, which are not, which are wrong; the biases behind them; the gaps that follow from how LLMs behave; and what to measure before anything else is built.
---

# Kits self-review

Thirteen kits and a dozen host features were built in one day, and none of them has been run on a
real model. This note sets out where the judgement behind that work went wrong, which claims rest
on evidence, and what should happen before anything else is built. The only measured results are
in `bench/RESULTS.md`, for the built-in `sessions` and `code` kits.

## A claim that is already wrong

The proposal to check each agent's MCP servers when a kit is added rested on "a duplicate MCP
server costs its tool schemas on every request". Claude Code's documentation says otherwise
([MCP, "Scale with MCP tool search"](https://code.claude.com/docs/en/mcp), read 2026-11-21):

> Tool search keeps MCP context usage low by deferring tool definitions until Claude needs them.
> Only tool names and server instructions load at session start, so adding more MCP servers has
> minimal impact on your context window.

Tool search is on by default. The agents ask-kit plugs into change faster than what the model that
did this work knows about them, and the old belief was stated as fact. Whether Codex, Copilot CLI
and Gemini CLI defer tool definitions too is not checked.

## Claims and their evidence

| Claim | Status | Evidence |
|---|---|---|
| Delegating to a cheap model keeps the calling agent's context small at the same accuracy | Measured | For `sessions` and `code` only: 21 real questions, 20/21 and 21/21 against 21/21 by hand, 14 to 26 times fewer tokens |
| The 13 new kits answer well on a cheap model | Unmeasured | Every bench is a shot: the author's script, checked against the author's patterns, on the author's fixture |
| Kits replace subagents and skills | Unmeasured | No comparison with a subagent or a skill on the same task |
| Kits save time | Contradicted | The one measurement shows ask as slow or slower: 35 s against 25 s on dated session questions |
| A duplicate MCP server costs its schemas on every request | Wrong | Claude Code defers tool definitions by default |
| Routing holds up with all kits installed | Unmeasured | Only the keyword fallback was tested: 48 of 59 right. The router model was never run |
| Actions answer common questions with no model | Unmeasured | No count of how often a whole-question regex matches what agents really type |
| The shared library fits the kits | Unmeasured | No kit has moved onto it yet |
| The install preview went from 81 KB to 4.4 KB | Measured | The incubator pack, measured before and after |

## Biases shown

- **Building before measuring.** Thirteen kits and a dozen host features in a day, with no model
  run on any of them. The benches prove the code runs, not that a cheap model answers well with it
  or that anyone is better off.
- **Agreeing too fast.** When the owner said kits should mesh, or that AGENTS.md should evaluate a
  new kit, the work called it the right frame and built it within the hour, without asking whether
  the problem was partly one the work had made.
- **Making the problem it then solved.** `procs` overlaps `systemd`; `net` overlaps `procs` and
  `web`; `logs` overlaps the journals and container logs; `files` overlaps `dotfiles` and `code`.
  The overlaps were created first, then `kit mesh` was built to manage them. Fewer, broader kits
  may be the better answer, and it was never weighed.
- **Grading its own work.** The builders, the reviewer and the researchers are the same model.
  They share blind spots, so "verified" often meant that the same kind of mind agreed.
- **Confident wording.** "The clearest saving", "most advantage", "kits replace agents and
  skills". Research figures taken from search snippets the researcher could not open were passed on.

## What has been measured

From `bench/RESULTS.md`, 2026-11-18: 21 real questions about one person's sessions and
repositories, a cheap model through `ask` against Claude Sonnet 5.5 digging by hand.

| Per question, median | ask, glm-5.3-flash | Sonnet 5.5 by hand |
|---|---|---|
| Score, 21 questions | 20/21, then 21/21 | 21/21 |
| Tokens added to the caller, session questions | 391 | 10,000 |
| Tokens added to the caller, code questions | 333 | 4,800 |
| Cost per question, as run | $0.002 to $0.008 | $0.06 to $0.15 |
| Time, session questions naming a date | 35 s | 25 s |
| Time, session questions naming no date | 111 s | 172 s |
| Time, code questions | 12 s | 11 s |

The evidence supports this: delegation pays when much is read and little comes back. Nothing
supports it yet for the new kits.

## Gaps that follow from how LLMs behave

1. **The handoff loses meaning.** The calling agent squeezes its intent into one question, and the
   investigator does not know why it was asked. A short, confident answer hides how unsure it is.
   Agents also tend to check delegated answers by digging anyway; when they do, the saving becomes
   a double cost. `ask-kit gaps` could measure this, and nothing acts on it.
2. **Small jobs get slower.** "What is on port 3000" is one `lsof`. An ask adds a routing step and
   a model round-trip. Regex actions are meant to remove the model, but the calling agent words its
   questions differently every time, so a regex that must match the whole question will rarely
   fire. The hit rate was never measured.
3. **Every kit adds context.** The kits' instructions and API files gave investigator prompts of
   13,000 to 26,000 characters in the end-to-end runs, and every kit adds its `says` line to the
   `ask` description in every session. Small models do worse with long instructions, and routing
   gets harder as kits multiply.
4. **Answers carry unvetted text.** Kits read web pages, logs, issues and notes, and their answers
   reach an agent that holds every tool, with nothing marking where they came from. The `act` gate
   protects the investigator, not the caller. Letting an agent turn off a person's MCP servers or
   edit their `CLAUDE.md` would widen what can change on the strength of analysis that read
   unvetted text.
5. **Heuristics read as orders.** `kit commons` and `kit mesh` work by pattern and similarity. An
   agent treats tool output as authoritative, so steps marked `agent` invite it to act on a guess.
6. **Self-tuning on a few examples overfits.** A tuner that rewrites a kit's instructions from a
   handful of asks will overfit them, and scoring a kit by its own lifecycle numbers invites
   Goodhart's law.
7. **A project file of learned facts repeats a known failure.** Facts a model wrote down for itself
   go stale and collect errors, which is the familiar trouble with `CLAUDE.md`. Projects already
   state most of these things in `package.json` scripts, Makefiles and their existing `AGENTS.md`;
   reading those beats inventing a new file.
8. **The shared library couples kits to releases.** `lib` ties every kit that uses it to ask-kit's
   release cycle. No kit has moved onto it, so whether it fits real kits is untested, and the
   release that ships it does not exist yet.

## What to do differently

1. **Stop adding kits and features until these are measured** on the owner's machine, which has
   the real sessions and an API key:
   - each new kit on 5 to 10 real questions from `ask-kit mine`, against the main agent doing the
     same by hand, counting tokens, time and correctness as `bench/RESULTS.md` did;
   - routing with the router model and every kit enabled;
   - how often the calling agent digs again after an ask;
   - how often actions match what agents really type.
2. **Keep only the kits that clearly win.** Big inputs and small answers make tests, logs, deps and
   web the likely ones. Merge the overlapping kits rather than meshing them.
3. **Give each kit a context budget:** a short `says`, and a cap on the size of its instructions
   and API.
4. **Treat every evaluator finding as a lead:** no `agent` step that changes anything, and the
   person's yes for every change.
5. **Drop the MCP-schema saving for Claude Code**, and check whether Codex, Copilot CLI and Gemini
   CLI defer tool definitions before claiming it anywhere.

## Built, and what it rests on

Built and pushed on `ccr-ebbfe5fc-om33ql`, all with offline tests (36 test files pass): the shared
library (`src/kitlib/`), `kit commons`, `kit mesh`, the AGENTS.md steps for adding a kit, and
installing, updating, removing, setting and copying kits. Not run anywhere: any kit or command on
a real model.
