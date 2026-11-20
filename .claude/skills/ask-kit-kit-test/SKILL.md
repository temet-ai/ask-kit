---
name: ask-kit-kit-test
description: Run ask-kit's `kit test` benchmark (real model calls, paid from Dawid's OpenRouter stipend) on an installed kit from a checkout, clone or worktree without rewriting the live ~/.config/ask-kit. Use only when Dawid starts that specific run himself; it runs once, on the questions he names or the change reaches. It is never a check a change waits on: changes are checked offline, land, and are measured from real use in `ask-kit report`.
---

# Scoring a kit from a checkout

`node bin/ask-kit.mjs kit test` asks each question in the kit's `bench/questions.json` through
`ask-kit ask`, which starts `serve`. `serve` rewrites `~/.config/ask-kit/AGENTS.md` with the
running checkout's paths, so a run from a clone or a worktree leaves every agent's ask-kit guide
pointing at a folder that will be deleted. Run it through the script instead:

```sh
bash .claude/skills/ask-kit-kit-test/scripts/kit-test.sh <kit> \
  --only <id,id> --out <scratch>/<kit>-<label>.json
```

It points `ASK_KIT_CONFIG` at a temp folder of symlinks to the live config, keys and kits, so the
run uses the installed kits and backends, and warns if the live guide changed anyway. The kits
themselves are only read.

## What a run costs and prints

- Real model calls, one question after another: a 5- to 7-question kit takes minutes per backend
  (github's median was 69 s per question). Run it in the foreground (timeout up to 600000 ms) or
  wait on it with Monitor. A subagent that backgrounds it and stops orphans the run, and nobody
  collects the result.
- stderr: one `pass|FAIL  <backend>  <id>  <s>s $<cost>  missing: ...` line per question.
  stdout: `<kit> · <backend>: <passed>/<of>, median <s>s, $<cost>` per backend. Exit 1 when any
  backend missed a question.
- `--out` writes `{kit, bench, at, summary, results}`; `--only id,id` limits the questions.
- Each question's ask row (`cells`, `turns`, `costUsd`, `ms`) is in
  `<state>/<kit>/kittest-<kit>-<time>-<backend>-<id>.jsonl`:
  `jq -c 'select(.type=="ask") | {cells, turns, costUsd}' <file>`. The code of its cells is in
  the `ask-<uuid>.jsonl` written at the same time in that folder.

The 2026-11-18 scores to hold: github 5/5 and docker 7/7 on deepseek-v4.1-flash-1017; docker 6/7
on glm-5.3-flash.

## When to run it

Only when Dawid starts the run himself. A change never waits on one: it is checked offline,
lands, and real use measures it (`ask-kit report --since <the commit's date>`). Don't offer a run
as the next step. On 2026-11-19 he stopped a build that iterated `kit test` in rounds on two
backends: "were wasting a lot of money and i said we do not do that". On 2026-11-20 he asked for the
run-per-change loop to stop: it makes him wait between every change.

When he does start one:

- One run, after the change, with no "before" run: the journal of real use and the last
  `--out` file are the before.
- Only the questions the change can reach: `--only id,id`. Five to eight real questions beat
  the full set.
- One backend: the one the kit runs on in the config (`domains.<kit>.backend`, else the
  default). A second backend only when the change is about backends.
- The run happens once. A question that failed, flaky or not, goes in the report as failed.
- A score below the one to hold is a regression: find which commit caused it
  (`git log --oneline -- src/`) before reporting.
