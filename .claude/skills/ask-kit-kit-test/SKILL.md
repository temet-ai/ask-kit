---
name: ask-kit-kit-test
description: Run ask-kit's `kit test` benchmark (real model calls) on an installed kit from a checkout, clone or worktree without rewriting the live ~/.config/ask-kit, and compare runs before and after a change on glm-5.3-flash and deepseek-v4.1-flash-1017. Use whenever you score a kit (github, docker, dotfiles...), prove a host or instruction change did not make a kit worse, or need kit test summaries or per-question cells for a report.
---

# Scoring a kit from a checkout

`node bin/ask-kit.mjs kit test` asks each question in the kit's `bench/questions.json` through
`ask-kit ask`, which starts `serve`. `serve` rewrites `~/.config/ask-kit/AGENTS.md` with the
running checkout's paths, so a run from a clone or a worktree leaves every agent's ask-kit guide
pointing at a folder that will be deleted. Run it through the script instead:

```sh
bash .claude/skills/ask-kit-kit-test/scripts/kit-test.sh <kit> \
  --backends deepseek-v4.1-flash-1017,glm-5.3-flash --out <scratch>/<kit>-<label>.json
```

It points `ASK_KIT_CONFIG` at a temp folder of symlinks to the live config, keys and kits, so the
run uses the installed kits and backends, and warns if the live guide changed anyway. The kits
themselves are only read.

## What a run costs and prints

- Real model calls, one question after another: a 5- to 7-question kit takes minutes per backend
  (github's median was 69 s per question). Start it in the background and wait for it; give each
  variant its own `ASK_KIT_STATE` when you run two at once.
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

## Before and after a change

1. Run the kit on both backends before the change, `--out <scratch>/<kit>-before.json`.
2. Make the change in the checkout, run again to `<kit>-after.json`.
3. Compare per backend: passes, then cells per question, then cost. Provider latency swings
   between runs, so seconds decide nothing. One run of a small bench is weak evidence: repeat a
   run whose result decides the change.
4. A score below the one to hold is a regression: find which commit caused it
   (`git log --oneline -- src/`) before reporting.
