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

## Verify and finish the review

Use a synthetic offline regression for the problem and run the repository's required checks.
Follow its rules for paid model tests; `improve` never runs them. If you request a model replay,
use the same backend and compare answer quality, steps, time and cost. An offline test checks the
code behavior and does not establish a model-quality or latency improvement.

After verified changes have been committed, fill in the brief's `record` template and save it
outside the repository. It includes the review window, journal paths and timestamps, changed
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
