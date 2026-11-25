---
name: ask-kit-improve
description: Improve a kit from its own journal and from what agents dug for by hand instead of asking it, or review every kit in the per-kit queue. Trace failed, slow, repeated or poorly reviewed results to their cause, make a measured change, verify it and record the outcome so the next review starts with new evidence.
---

# Improving kits from their journals

The command is `{{ASK_KIT}}` (below: `ask-kit`). Read {{AGENTS_MD}} for this machine's paths.

## 1. Take one kit's evidence

For one kit, run `ask-kit improve <name>`. For all kits, start with `ask-kit improve --json`.
The queue includes each installed kit and domain, using its real journal since its last completed
review (30 days on the first run). Tests and benchmarks are excluded. `--since 7d` overrides the
window. A kit with no new evidence needs no changes.

Evidence is of two kinds, and a review covers both: the kit's journal (what it was asked), and
`chains`, the runs of lookups agents made by hand that this kit should have answered. `afterAsk`
marks a chain that followed an ask in the same turn.

When the user requests a fleet, assign each pending kit its own task and repository ownership.
Each task reads `ask-kit improve <name>`, then the kit's instructions, roles, skills and scripts.
Do not use one kit's failures to rewrite another. Keep host fixes in a separate task when several
kits share the same defect. Otherwise work through the same queue one kit at a time.

The brief names journals and timestamps, and includes a completion-record template. It shows
at most 30 entries per evidence section; `ask-kit report --kit <name> --real --since <date> --json`
gives the full report. Read the selected rows and the investigator's cells. Ask the sessions
investigator what the caller did next when the answer's quality is unclear. Treat a re-ask as a
lead to inspect, not proof that the answer was wrong.

Start from `questions`: what was this kit's to answer, counted. Name the ones a change answers in the
record's `addresses`, in their words; `dugSince` shows whether it worked. `ask-kit improve --label`
gives new chains their questions first. Store the question and cause of every chain the brief shows
(`gap`, `not-reached`, `fell-short`, `before-edit`, `own-output`, `not-this-kit`) in the record's
`questions`. That record is the one place a kit finding is kept: a note, lesson or issue about it
points there, and `elsewhere` lists those that do not yet; cite them as `{finding: id}`.

For each chain shown, work out its question from `prompt`, `says` (what its calls were for) and
`found` (what the agent said after). Then find why the kit did not answer it: no script or source
covers it; the kit's `says` and patterns do not claim it; or the ask before it left something out.
A chain that only looked around before doing the work, or that repeats a status check, needs no
change. `turnOutcome` and `sessionVerdict` speak of the whole
turn or session: match what went unmet to the chain's own question.

A script's successful execution can still return `review.status: needs_review` or `unverified`.
These are recorded separately from execution errors. Background jobs may also write `outcome`
rows when they finish; inspect those even if the submitting ask succeeded.

## 2. Fix the cause

Select up to three supported problems **per kit**, with journal evidence for each.

- A missed step or misunderstanding: replace a line in `instructions.md`, the matching role or
  skill. Keep the instructions specific and remove obsolete advice.
- Repeated hand-written cells: improve or add a script. Check the journal's `drafts/` first.
- A search that reads too much: narrow the script's default scope or make independent reads
  together. Preserve the result and its evidence.
- A model/backend failure: distinguish credentials, unavailable sources and limits from a kit
  defect. Change a backend only within the user's requested scope.
- A saved result that fails review: fix the generation, validation or delivery step responsible;
  preserve the review verdict in the script's structured return.

If the evidence does not justify a change, record `no-change` with the reason. If a needed source
or decision is missing, or supported issues remain unresolved after the selected fixes, record
`blocked` with the remaining work; its evidence stays in the next queue.

## 3. Verify and record

Reproduce the problem with a small synthetic offline fixture and run the repository's required
checks. Follow its local test instructions. Run paid `kit test` or benchmark suites only when the
maintainer asks for that specific run. A model replay, when requested, uses the original backend
and reports answer quality, steps, time and cost. An offline regression proves the code behavior;
it does not establish a model-quality or latency improvement.

Commit verified changes in the kit's repository when the user requested commits. Fill in the
brief's `record` object with `since`, `through`, `outcome`, `summary`, `evidence` (`journal`, `ts`,
or `chain`),
`changes`, `checks` (`command`, observed `result`, `ok`) and the commit sha for `changed`. Save it
outside the repository: it names private journals. Run:

```sh
ask-kit improve <name> --record <record.json>
```

A changed record needs changed paths, passing checks and a commit. A completed record advances
only this kit's review cutoff; new asks and job outcomes form its next review. A blocked record
does not advance it. If commits were not requested, keep the brief open and report the verified
working-tree change rather than marking it completed.

Run the queue again after new real use. Compare the next questions and result reviews with the
previous evidence before claiming improvement. This workflow runs when invoked; it does not
start a daemon, schedule work, call a model or edit kits by itself.
