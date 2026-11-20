# Make it better

ask-kit saves every question it answers, with its time, cost and every step. When an answer is
wrong or slow, you fix the cause and ask the same question again to check the fix worked.

## Let an agent tune it

Paste into any agent:

```
Read ~/.config/ask-kit/AGENTS.md, then improve ask from the last week's journal.
```

The agent finds the bad answers, works out the causes, makes small changes, asks each flagged
question again once at the end and shows you the before and after. It changes nothing without your yes.

## Tune it by hand

### 1. Find the bad answers

```sh
ask-kit report --since 7d
```

It marks each question that failed, ran out of time or kept repeating a search, was cut off, was slow or costly,
or was asked again soon after (a sign the first answer wasn't enough). At the end it lists the
searches the investigator kept writing by hand. Each of those could be a script.

### 2. Fix the cause

| What went wrong | Fix |
|---|---|
| It misread the question or skipped a step | One sentence in the domain's `instructions.md`. Where you can, change an existing line. |
| It wrote the same search by hand again and again | A script in the domain's `scripts/`. Check its saved drafts first, because one may already do it. |
| It was slow because a search read too much | Make the script search less by default: a time window, one source, one project. |
| The model itself failed (malformed calls, cut off, empty replies) | Try another model for that domain. |

Your changes take effect on the next question. Nothing needs restarting.

### 3. Check it

```sh
ask-kit ask --domain sessions --backend <name> "<the same question>"
```

Compare the answer, steps, time and cost with the report. When you change several things, make
them all first and ask each flagged question once at the end.

Whether a change broke other questions shows in real use. A few days after it, run
`ask-kit report --since <the date of the change>` and compare its flags with the report you
started from.

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
