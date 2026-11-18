# Tune it from the journal

ask gets better by changing the layer that caused a bad answer, then asking the same question
again. The `ask-kit-improve` skill walks an agent through this; the `ask-kit-tuner` agent does
the work. To start it:

```
Read ~/.config/ask-kit/AGENTS.md, then improve ask from the last week's journal.
```

## 1. Find what went wrong

```sh
ask-kit report --since 7d
```

The report lists every ask with its signals: failed, out of steps or time, cut off, slow,
costly, many missteps (the model wrote markup instead of calling the tool), and re-asked (the
same session asked again soon after, often a sign the first answer fell short). It ends with the
scripts used and the cells that ran most often without a script: routes worth a script.

For one flagged ask, its cells are in the journal the report names, one JSON line per cell.

## 2. Fix it where it went wrong

- **The investigator misread the question or skipped a step**: one sentence in the domain's
  `instructions.md`, aimed at that failure. Replace a line rather than adding one where you can.
- **It rebuilt the same search in raw cells**: a script in the domain's `scripts/`. Check the
  investigator's drafts first; one may already be the script.
- **It was slow because a search read too much**: make the script narrow by default (a time
  window, a source, a project).
- **The model itself** (missteps, cut off, empty replies): try another backend for that domain.

Any change re-warms the investigator on the next question.

## 3. Prove it

Ask the flagged question again through the same backend:

```sh
ask-kit ask --domain sessions --backend <name> "<the question>"
```

Compare the answer, steps, time and cost with the journal's row. Then ask two or three other
questions that use what you changed, so a fix for one question did not break another.
