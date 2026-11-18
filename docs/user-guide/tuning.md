# Make it better

ask-kit saves every question it answers, with its time, cost and every step. When an answer is
wrong or slow, you fix the cause and ask the same question again to check the fix worked.

## The easy way

Paste into any agent:

```
Read ~/.config/ask-kit/AGENTS.md, then improve ask from the last week's journal.
```

The agent finds the bad answers, works out the cause, makes a small change, asks the question
again and shows you the before and after. It changes nothing without your yes.

## By hand

### 1. Find the bad answers

```sh
ask-kit report --since 7d
```

It marks each question that failed, ran out of steps or time, was cut off, was slow or costly,
or was asked again soon after (a sign the first answer wasn't enough). At the end it lists the
searches the investigator kept writing by hand. Each of those could be a script.

### 2. Fix the cause

| What went wrong | Fix |
|---|---|
| It misread the question or skipped a step | One sentence in the domain's `instructions.md`. Replace a line instead of adding one where you can. |
| It wrote the same search by hand again and again | A script in the domain's `scripts/`. Check its saved drafts first, because one may already do it. |
| It was slow because a search read too much | Make the script search less by default: a time window, one source, one project. |
| The model itself failed (malformed calls, cut off, empty replies) | Try another model for that domain. |

Your changes take effect on the next question. Nothing needs restarting.

### 3. Check it

```sh
ask-kit ask --domain sessions --backend <name> "<the same question>"
```

Compare the answer, steps, time and cost with the report. Then ask two or three other questions
that use what you changed, to make sure you didn't break something else.

## Habits that help without tuning

- Put what you already know in the question. It is the cheapest fix there is.
- Follow up instead of asking again from scratch. Each new question searches from zero.
- If one domain keeps doing badly on one model, give that domain a different model
  ([Choose the model](models.md)).
