---
name: ask-kit-improve
description: Improve ask-kit's `ask` from its own usage - read the journal for asks that failed, ran out of steps, were slow, costly or wrong, find the layer that caused it (instructions, a script, the backend), fix it there and prove the fix by asking the same question again. Use when asked to improve, tune or speed up ask, when an ask answer was wrong or slow, or to turn a repeated investigation into a script.
---

# Improving ask from its journal

The command is `node "${CLAUDE_PLUGIN_ROOT}/bin/ask-kit.mjs"` (below: `ask-kit`). ask-kit's guide, with every path on this machine,
is ~/.config/ask-kit/AGENTS.md (Windows: %APPDATA%\ask-kit\AGENTS.md; `ask-kit doctor` prints where): read it first.

## 1. Find what went wrong

`ask-kit report --since 7d` lists every ask with its signals: failed, out of steps or time, cut
off, slow, costly, many missteps (the model wrote markup instead of calling the tool), and
re-asked (the same session asked again soon after, often a sign the first answer fell short). It
ends with which scripts were used and the cells that ran most often without a script: routes
worth a script.

For one flagged ask, read its cells in the journal it names (one JSON line per cell: code,
error, result size, scripts). What the caller did next is in its own transcript: ask the
sessions investigator ("what did session X do after its ask at 10:42?").

## 2. Fix it in the layer it points at

- **The investigator misread the question or skipped a step** → its instructions,
  `domains/<name>/instructions.md`, or the `openWith` list in `domain.mjs`. One sentence, aimed at
  the failure. Do not grow the file: replace a line where you can.
- **It rebuilt the same thing in raw cells** (the report's "routes worth a script") → a script
  in `domains/<name>/scripts/`. Copy the shape of an existing one: `meta` (purpose, params,
  returns, example) and a default export taking the domain's globals. Check for an investigator's
  draft first: drafts live under the state folder's `drafts/` and may already be the script.
- **It was slow because a search read too much** → make the script narrow by default (a time
  window, a source, a project).
- **The model itself** (missteps, cut off at length, empty replies) → try another backend for
  that domain: set `domains.<name>.backend` in the config.

Any change to instructions, scripts or the API re-warms the investigator on the next question;
nothing needs restarting.

## 3. Check it

Make all the fixes first, then check them together in one pass. Ask each flagged question again
once, through the same backend, from the shell:
`ask-kit ask --domain <name> --backend <backend> "<the question>"`. Compare the answer, steps,
time and cost with the journal's row. Don't ask after each fix, and don't stop to ask the user
before the pass. Report the before and after.

Whether a fix broke other questions shows in real use: run `ask-kit report --since <the date of
the change>` after a few days of use and compare its flags with the report you started from.
