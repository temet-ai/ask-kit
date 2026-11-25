# Make it better

ask-kit saves every question it answers, with its time, cost and every step. When an answer is
wrong or slow, you fix the cause and ask the same question again to check the fix worked.

## Review one kit or all kits

Paste into your coding agent:

```
Read ~/.config/ask-kit/AGENTS.md, then improve the kits from their own journals.
```

The ask-kit-improve skill and ask-kit-tuner agent use a separate review for each kit. Start with:

```sh
ask-kit improve
ask-kit improve imagegen
```

The first command lists the installed kits and domains with new evidence. The second prints one
kit's brief: its source folder, flagged asks, script use, result reviews and a completion-record
template. It reads real use since that kit's last completed review, or the last 30 days for its
first review. `--since 7d` overrides the inspection window. A completion record after an earlier
review cannot skip an unreviewed gap; use the default brief window when recording. No kit code or model runs while reading a brief.

Each review traces a failure to its cells and the caller's follow-up before making a change.
Instructions, roles and skills can need a corrected step; repeated raw cells can become a script;
a slow script can search a narrower scope. A kit with no evidence for a defect can be reviewed
without a change. When you request a fleet, each kit has its own task and repository ownership.

## Inspect the evidence

```sh
ask-kit report --kit imagegen --real --since 7d
```

`--kit` filters all report sections to that kit. `--real` excludes kit tests and benchmark
sessions, including their linked investigator cells. Older cells that cannot be attributed to a
caller are listed separately and excluded from real-use counts. Without these options, `report` retains its
combined view. The improvement brief shows at most 30 entries per evidence section; the report
has the full entries and their journal paths.

A successful script can still return a result that needs review. When its return object has
`review.status` of `needs_review` or `unverified`, the host keeps that verdict and bounded notes
in its journal even with trajectories off. These are quality signals, separate from execution
errors. A background kit can also journal an `outcome` when a detached job finishes, so a caller
that never polls the result does not hide its review verdict. Outcomes are counted separately
from asks.

The brief's `chains` section lists the lookup chains agents ran by hand since the last review that
this kit should have answered, from the same scan as [`ask-kit gaps`](#find-what-agents-look-up-by-hand):
the prompt, what the shell calls said they were for, what the agent answered after, and the ask
made earlier in the turn if there was one. A kit that nobody asked but that agents dug around is
pending too. The queue's `signals` leave out asks that were only slow or costly.

Each chain carries what is known of it: `ask`, the journal row of the ask made before it in the turn
(`answeredBefore: false` when it was still running); `nudged`, when the plugin's hook named a kit
during it; and, where an enabled kit provides `chain-outcomes`, how the turn and session ended. The
brief's `elsewhere` lists what a kit that provides `kit-findings` found written about this kit in
notes, lessons and threads; citing one as `{finding: id}` in a record takes it off the list. A source
that fails is named in the brief.

## Questions

`ask-kit improve --label [kit] [--max 400]` gives each chain of the last 30 days its question and
cause, in batches, with the model in the config's `labeller` (default: `claude -p --model haiku`,
signed in on this machine; `{ "command": [...] }` is any program that reads a prompt on stdin and
prints the reply). A question another kit answers goes to that kit, and an answer that fell
short to the kit that gave it. Each kit with chains waiting gets a share of `--max`. The causes are `gap` (the kit has
nothing that answers it), `not-reached` (it does, and was not asked), `fell-short` (an ask before it
left it out, or had not answered yet), `before-edit`, `own-output` and `not-this-kit`.

A brief's `questions` are the ones that were this kit's to answer, counted: how often and in how many
sessions each was dug for. A review names those its change answers in `addresses`; `dugSince` then
counts the digging after it, and a question dug for again is open again. A chain is closed only by
having a question: what a brief has no room for waits. `ask-kit gaps` and `ask-kit mine` use the
questions too, and count every machine.

A label is a model's reading. Recording the chain again with another cause corrects it.

## Other machines

Name them in the config as ssh hosts, and give each key-based ssh access:

```json
"machines": ["mac", { "host": "infra", "command": "node /opt/ask-kit/bin/ask-kit.mjs" }]
```

`ask-kit improve` then copies each one's journals, action logs and review records to the state
folder's `machines/<host>/`, and runs `ask-kit gaps --chains` there for its lookup chains (0.7.1 or
later; the Claude Code plugin's copy, else `ask-kit` on PATH). It prints a line per machine and says
when one was not read in full; what an earlier run copied is still used. `--offline` skips it. Nothing
is written on the other machine, beyond its own `gaps` cache and a temporary file list.

## Verify and finish the review

Use a synthetic offline regression for the problem and run the repository's required checks.
Follow its rules for paid model tests; `improve` never runs them. If you request a model replay,
use the same backend and compare answer quality, steps, time and cost. An offline test checks the
code behavior and does not establish a model-quality or latency improvement.

After verified changes have been committed, fill in the brief's `record` template and save it
outside the repository. It includes the review window, journal paths and timestamps or chain ids, changed
paths, the check commands and their observed results, and the commit sha. For router evidence,
use the record's `at` value as the evidence timestamp. Then run:

```sh
ask-kit improve imagegen --record /path/to/review.json
```

`changed` requires changed paths, passing checks and a commit. `no-change` records why the
reviewed evidence needed no patch. Both advance only that kit's cutoff to the brief's `through`
time; new asks and job completions remain for its next review. `blocked` records missing
information or unfinished work and keeps the same evidence pending. If some fixes are committed
but supported issues remain unresolved, use `blocked` and name the remaining work.

Records live in the state folder's `improvements/<kit>.jsonl`. They preserve the agent's
verification report; saving one does not execute the listed commands. Run `ask-kit improve`
after more use to review the next evidence and compare it with the preceding changes. This is
an invoked workflow, with no daemon or schedule installed.

## Find what agents look up by hand

The journal shows the questions `ask` was given. It can't show the ones it never got, when an
agent read files or ran `gh` itself instead. `ask-kit gaps` finds those in your agents'
transcripts:

```sh
ask-kit gaps --since 30d
```

- A kit under **Installed but skipped** covers the sources an agent read by hand instead of
  calling `ask`. Read its example prompts. If they are questions the kit answers, make the kit's
  `says` and `keywords` name them, so the rule and the router send them to `ask`.
- A source under **No kit** with many sessions and tokens is a candidate for a kit. Its example
  prompts are the first questions for the kit's `bench/questions.json`.

Before a change, run `ask-kit gaps --since 7d` and note the coverage line. A week after it, run
the same command and compare.

## Habits that give better answers

- Put what you already know in the question.
- Ask a related question as a follow-up. A new question searches from zero.
- If one domain keeps doing badly on one model, give that domain a different model
  ([Choose the model](models.md)).
