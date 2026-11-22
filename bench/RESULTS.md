---
session_id:
  - 96f346df-32ec-4e11-9157-e9e8b51f6244
  - 9ab9c8fc-ddc2-406a-960d-e0cf6e0b5306
---

# ask-kit benchmark, 2026-11-18

This benchmark asks three things about ask-kit's `ask`: how accurate it is, how fast, and how
cheap, on each backend. It also measures what `ask` saves the calling agent, compared with that
agent digging through transcripts and code itself.

Everything here is real. The questions are real questions about real work: the sessions on
**omarchy**, one person's desktop-config repo (Hyprland, the bar and dock, Herdr layouts and mods,
keyboard setup), that repo's code, and ask-kit's own code. Each expected answer was checked by
hand against the transcript or source line it came from. The answers, times and costs are what
each run returned. Nothing was made up.

## Headline

On 21 published questions, ask on its default cheap model (glm-5.3-flash, via OpenRouter) scored
20/21 on the first run and 21/21 on the second. Claude Sonnet 5.5, digging with Read, Grep and Bash,
scored 21/21. Accuracy came out the same. The difference is in the calling agent:

| Run 1, per question (median) | ask → glm-5.3-flash | Sonnet 5.5 digs itself |
|---|---|---|
| Score (21 questions) | 20/21 | 21/21 |
| Tokens added to the calling agent's context, session questions | **391** | **10,000** |
| Tokens added to the calling agent's context, code questions | **333** | **4,800** |
| Tokens added over all 21 questions | **8.3k** | **225k** |
| Cost per question, as run | $0.002–0.008 | $0.06–0.15 |
| Cost per question inside a session already holding 50k tokens (estimate) | $0.014–0.020 | $0.044–0.122 |
| Time, session questions that name a date | 35 s | 25 s |
| Time, session questions that name no date | 111 s | 172 s |
| Time, code questions | 12 s | 11 s |
| A follow-up with `continue: true` | 3 s, $0.0006 | (resumes its session) |

The saving is context, not accuracy. Per question, the calling agent takes in 14 to 26 times fewer
tokens with ask. It also pays a fifth to a third as much, even inside a session that is already
open.

## Rerun, 22 November 2026

The 21 public questions were run again on 22 Nov, once each. Three ways answered them:
- ask on deepseek-v4.1-flash, the default since 18 Nov;
- ask on glm-5.3-flash;
- Sonnet 5.5 digging itself with Read, Grep, Glob and Bash.

The scripts, the clones (ask-kit b6c1e5f, omarchy a8f0d21) and the method are the ones described below. Both API backends are pinned to DeepInfra, as in daily use.

Between 18 and 22 Nov, ask gained:
- kit routing;
- early answers;
- time as the only budget, in place of the step limit;
- replies without footers;
- background tasks for slow asks.

The question note also asks the investigator to ignore the session that ran the rerun. The rows are in `results/2026-11-22/`, and `python3 bench/results/2026-11-22/tables.py` prints these tables from them.

| Questions | Way | Score | Median time | Cost / question (median) | Total cost | Context added / question (median) | Context added (total) |
|---|---|---|---|---|---|---|---|
| dated sessions | ask → deepseek-v4.1-flash | 10/10 | 45 s | $0.0027 | $0.029 | 541 | 5.6k |
| dated sessions | ask → glm-5.3-flash | 9/10 | 32 s | $0.0069 | $0.092 | 579 | 5.3k |
| dated sessions | Sonnet 5.5 digs itself | 10/10 | 27 s | $0.1281 | $1.179 | 9,478 | 94.0k |
| undated sessions | ask → deepseek-v4.1-flash | 2/3 | 195 s | $0.0129 | $0.028 | 889 | 2.2k |
| undated sessions | ask → glm-5.3-flash | 3/3 | 83 s | $0.0129 | $0.050 | 681 | 2.1k |
| undated sessions | Sonnet 5.5 digs itself | 1.5/3 | 255 s | $0.1463 | $0.518 | 15,511 | 63.8k |
| code | ask → deepseek-v4.1-flash | 8/8 | 21 s | $0.0015 | $0.013 | 496 | 4.5k |
| code | ask → glm-5.3-flash | 7.5/8 | 18 s | $0.0027 | $0.046 | 439 | 3.8k |
| code | Sonnet 5.5 digs itself | 8/8 | 12 s | $0.0573 | $0.481 | 5,642 | 46.7k |
| all 21 | ask → deepseek-v4.1-flash | 20/21 | 34 s | $0.0020 | $0.071 | 507 | 12.3k |
| all 21 | ask → glm-5.3-flash | 19.5/21 | 23 s | $0.0047 | $0.188 | 564 | 11.2k |
| all 21 | Sonnet 5.5 digs itself | 19.5/21 | 16 s | $0.1092 | $2.178 | 7,186 | 204.5k |

| Question | ask → deepseek-v4.1-flash | ask → glm-5.3-flash | Sonnet 5.5 digs itself |
|---|---|---|---|
| s03-quickshell-crash | C | C | C |
| s03f-pinned-items | C | C | C |
| s04-mac-keyboard | C | C | C |
| s09-herdr-vs-orca | C | C | C |
| s10-herdr-sounds | C | C | C |
| n01-hypr-pairs | C | C | C |
| n02-herdr-icon | C | C | C |
| n02f-herdr-mods-css | C | x | C |
| n03-tab-label | C | C | C |
| n04-dock-clocks | C | C | C |
| h05-karabiner | C | C | C |
| h06-herdr-editor | C | C | x |
| n05-agent-crashed-shell | x | C | p |
| k01-loop-limits | C | C | C |
| k02-claude-fork | C | C | C |
| k03-router | C | C | C |
| k04-env-strip | C | C | C |
| o01-sync-commands | C | C | C |
| o02-sync-excludes | C | C | C |
| o03-sync-map | C | p | C |
| o04-pairs-load-order | C | C | C |

Over the 21 questions, ask on deepseek added 12.3k tokens to the caller against Sonnet's 204.5k, about 17 times fewer. It cost $0.071 against $2.18 and scored 20/21 against 19.5/21. On 18 Nov, glm against Sonnet was 8.3k against 225k. ask's answers are longer now: the median on dated session questions went from 391 to 579 tokens. The undated session questions show the largest gap. Per question, Sonnet added 15.5k tokens and took 255 s, against 700–900 tokens and 83–195 s for ask.

**Read by hand.** Two verdicts differ from the judge's:
- k01 counts as correct for all three. Its expected answer was rewritten on 19 Nov (d03b82e) for code newer than the pinned b6c1e5f, which still has `MAX_STEPS = 20`, and all three answered the pinned code correctly (#15).
- Sonnet's s10 counts as correct. Its recorded answer is its last message, a remark on a background search that timed out, and the full answer is the message before it (#16).

**Misses:**
- deepseek missed n05: it found a crash from 20 Nov and none of the three expected.
- glm missed n02f, which got the rest of n02's early answer instead of an answer to its own question (#13). Its o03 was partial: it left out the folder-versus-file rule.
- Sonnet missed h06, where it found no session (there are two), and its n05 was partial.

**Early answers:**
- glm answered early on n02 (19 s; the full run took 41 s), n03 (21 s / 42 s), o02 (14 s / 22 s), o03 (16 s / 30 s) and k04.
- Time in the table is what the caller waited.
- Cost is the full run's, taken from the run's later journal line (`runCostUsd` in the rows).
- k04's run never wrote that line, because the bench closes the server when it moves on, so glm's total is a little low (#16).
- deepseek sent no early answers.

**Spend:** ask runs $0.26, the Sonnet baseline $2.18, the LLM judge $0.42.

## What was asked

`bench/questions.json` holds the questions, the expected answer and where each answer came from.
There are 21:

- **10 session questions that name a date and an agent**, 2 of them follow-ups.
  - From Codex: what crashed quickshell (ODock's running-apps list) and how many dock items were
    left; the Mac keyboard fix (Karabiner, Keychron in Windows mode); why the bar was hard to read
    and had two clocks.
  - From Claude Code: Herdr vs Orca; the new alert sounds; where the Hyprland workspace-pair code
    moved; the Herdr folder icon, and what Herdr mods are built with; why two sidebar rows showed
    the same label.
- **3 session questions that name no date, agent or session**: which session fixed Karabiner;
  whether Herdr was ever looked at as a code editor; and whether an agent ever crashed the desktop
  shell while changing it.
- **8 code questions**:
  - 4 on ask-kit: loop limits, how claude-cli forks a warm session, routing order, which
    environment variables are stripped.
  - 4 on omarchy: the sync script's commands, the files it leaves out, how it maps `apps/` paths,
    and the Hyprland load order of `pairs.lua`.

**Left out: 18 more questions**, run the same way at the same time and kept in a git-ignored
`bench/private/`. They are about client work (a security ticket, scanner suppressions, a
merge-request review) and other private repositories (the capture proxy, the code-review tool,
the earlier version of ask). They can't be published. Their scores were in line with the public
ones (glm 9.5/10 on the dated session questions, 4/4 on code), but this page quotes no numbers from
them except where marked.

**The omarchy repo and its transcripts are private.** Readers can't rerun the 13 session questions
or the 4 omarchy code questions. The 4 ask-kit code questions can be rerun by anyone.

## Method

- **ask runs** (`bench/run-ask.mjs`). Each backend went through ask-kit's real MCP server
  (`ask-kit serve`), with a scratch config and state and no agents registered.
  - glm and deepseek ran every question twice.
  - Haiku, Codex and Copilot ran once. Codex and Copilot ran only the session questions.
  - Qwen (local) ran the session questions once.
  - Code questions ran on clean clones at fixed commits (ask-kit b6c1e5f, omarchy a8f0d21), so the
    investigator could not see `bench/`.
  - Session questions end with "ignore session 96f346df", the benchmark's own session, which holds
    every expected answer.
  - Time, cost, cells (REPL steps), partial answers and token usage come from ask-kit's own journal.
- **Baseline** (`bench/run-baseline.mjs`). The same questions went to `claude -p` on Sonnet 5.5
  with Read, Grep, Glob and Bash. It had no MCP servers (so no ask), user settings off, and a $0.75
  cap per question.
  - It was told where each agent keeps its transcripts.
  - It ran in a neutral folder for session questions and in the repo clone for code questions.
  - Follow-ups resumed its own session.
- **Context in the caller.**
  - With ask: the question plus the answer text, at about 4 characters a token. The tool's own
    description adds about 335 tokens once per session.
  - For the baseline: the largest request's input minus the first request's, plus output. That is
    what the digging added on top of the 24k tokens it started with.
- **Grading** (`bench/grade.mjs`). An LLM judge (Sonnet, no tools) graded each answer against the
  expected answer and required facts: correct, partial (counted as half) or wrong, with a one-line
  reason in `results/*.graded.jsonl`.
  - I read every verdict that was not "correct" against the source.
  - Two verdicts were changed by hand, listed in `bench/hand-grades.json`.
- **Tables** come from `bench/report.mjs`, run over `bench/results/`. `bench/redact.mjs` makes that
  folder: it replaces home paths and splits public rows from private ones.

To rerun on your own machine:

1. Set `ASK_KIT_CONFIG` and `ASK_KIT_STATE` to scratch folders.
2. Run `ask-kit apply` on a config with no clients.
3. Write questions about your own sessions in the same format.
4. Run `node bench/run-ask.mjs --backend <name> --set sessions|code|all --run 1 --out raw/<name>.jsonl --repos <name>=<clone>`.
5. Then run `run-baseline.mjs`, `grade.mjs` and `report.mjs`.

## Results per backend

Score counts a partial as half. "Out of steps" means the investigator hit its 20-step limit and
answered with what it had. Codex ran on a ChatGPT plan and Copilot on premium requests, so neither
has a price per question.

### Session questions that name a date and an agent (10, 2 of them follow-ups)

| Backend | Run | Correct | Partial | Wrong | Score | Median time | Total time | Cost / question | Total cost | Mean cells | Out of steps |
|---|---|---|---|---|---|---|---|---|---|---|---|
| glm-5.3-flash | 1 | 10 | 0 | 0 | 10/10 | 35 s | 364 s | $0.0024 | $0.024 | 4.6 | 0 |
| glm-5.3-flash | 2 | 10 | 0 | 0 | 10/10 | 54 s | 523 s | $0.0030 | $0.030 | 5.4 | 0 |
| deepseek-v4.1-flash | 1 | 10 | 0 | 0 | 10/10 | 93 s | 947 s | $0.0027 | $0.027 | 10.5 | 0 |
| deepseek-v4.1-flash | 2 | 9 | 1 | 0 | 9.5/10 | 57 s | 662 s | $0.0037 | $0.037 | 9.6 | 0 |
| claude-haiku (Claude Code) | 1 | 10 | 0 | 0 | 10/10 | 29 s | 612 s | $0.0046 | $0.046 | - | 0 |
| codex (ChatGPT plan) | 1 | 9 | 1 | 0 | 9.5/10 | 33 s | 363 s | plan | - | 3.3 | 0 |
| copilot (Copilot CLI) | 1 | 10 | 0 | 0 | 10/10 | 86 s | 1061 s | premium req. | - | 6.6 | 0 |
| qwen3.5:9b (Ollama, local) | 1 | 5 | 2 | 3 | 6/10 | 147 s | 2392 s | local | - | 4.7 | 1 |
| baseline: Sonnet 5.5 digs | 1 | 10 | 0 | 0 | 10/10 | 25 s | 565 s | $0.1179 | $1.179 | 6.0 tool calls | 0 |

### Session questions that name no date, agent or session (3)

| Backend | Run | Correct | Partial | Wrong | Score | Median time | Total time | Cost / question | Total cost | Mean cells |
|---|---|---|---|---|---|---|---|---|---|---|
| glm-5.3-flash | 1 | 2 | 0 | 1 | 2/3 | 111 s | 381 s | $0.0080 | $0.024 | 13.3 |
| glm-5.3-flash | 2 | 3 | 0 | 0 | 3/3 | 126 s | 306 s | $0.0078 | $0.023 | 11.3 |
| deepseek-v4.1-flash | 1 | 3 | 0 | 0 | 3/3 | 157 s | 572 s | $0.0037 | $0.011 | 13.3 |
| deepseek-v4.1-flash | 2 | 2 | 0 | 1 | 2/3 | 301 s | 758 s | $0.0063 | $0.019 | 15.7 |
| claude-haiku | 1 | 2 | 0 | 1 | 2/3 | 156 s | 527 s | $0.0069 | $0.021 | - |
| codex | 1 | 3 | 0 | 0 | 3/3 | 64 s | 183 s | plan | - | 3.3 |
| copilot | 1 | 2 | 0 | 1 | 2/3 | 192 s | 902 s | premium req. | - | 20.0 |
| qwen3.5:9b | 1 | 1 | 1 | 1 | 1.5/3 | 78 s | 264 s | local | - | 2.0 |
| baseline: Sonnet 5.5 digs | 1 | 3 | 0 | 0 | 3/3 | 172 s | 474 s | $0.1499 | $0.450 | 9.3 tool calls |

Deepseek ran two of these three questions a third time, both correct. That run is in the raw
results.

### Code questions (8: 4 in ask-kit, 4 in omarchy)

| Backend | Run | Correct | Partial | Wrong | Score | Median time | Total time | Cost / question | Total cost | Mean cells |
|---|---|---|---|---|---|---|---|---|---|---|
| glm-5.3-flash | 1 | 8 | 0 | 0 | 8/8 | 12 s | 120 s | $0.0028 | $0.022 | 6.3 |
| glm-5.3-flash | 2 | 8 | 0 | 0 | 8/8 | 10 s | 99 s | $0.0020 | $0.016 | 4.3 |
| deepseek-v4.1-flash | 1 | 7 | 0 | 1 | 7/8 | 21 s | 221 s | $0.0019 | $0.015 | 10.0 |
| deepseek-v4.1-flash | 2 | 8 | 0 | 0 | 8/8 | 22 s | 225 s | $0.0021 | $0.017 | 9.0 |
| claude-haiku | 1 | 8 | 0 | 0 | 8/8 | 22 s | 181 s | $0.0052 | $0.041 | - |
| baseline: Sonnet 5.5 digs | 1 | 8 | 0 | 0 | 8/8 | 11 s | 118 s | $0.0573 | $0.458 | 3.5 tool calls |

Over all 39 questions (public and private), Copilot used **27 premium requests**: one per
question, and two for each follow-up session. It ran on Copilot's default model.

### Per question

C correct, p partial, x wrong, one letter per run.

| Question | glm | deepseek | haiku | codex | copilot | qwen | baseline |
|---|---|---|---|---|---|---|---|
| s03 what crashed quickshell (Codex, 13 Nov) | CC | CC | C | C | C | x | C |
| s03f follow-up: pinned dock items | CC | CC | C | C | C | C | C |
| s04 Mac keyboard fix (Codex, 16 Nov) | CC | CC | C | C | C | x | C |
| s09 Herdr vs Orca (Claude Code) | CC | CC | C | C | C | C | C |
| s10 Herdr alert sounds (Claude Code, 17 Nov) | CC | CC | C | p | C | p | C |
| n01 where the workspace-pair code moved (16 Nov) | CC | Cp | C | C | C | x | C |
| n02 Herdr folder icon (16 Nov) | CC | CC | C | C | C | C | C |
| n02f follow-up: what Herdr mods are built with | CC | CC | C | C | C | C | C |
| n03 same label on two sidebar rows (17 Nov) | CC | CC | C | C | C | C | C |
| n04 bar hard to read, two clocks (Codex, 2 Nov) | CC | CC | C | C | C | p | C |
| h05 which session fixed Karabiner (undated) | CC | CCC | C | C | C | C | C |
| h06 Herdr as a code editor (undated) | CC | CCC | x | C | C | p | C |
| n05 did an agent crash the shell (undated) | xC | Cx | C | C | x | x | C |
| k01 ask-kit: loop limits | CC | CC | C | | | | C |
| k02 ask-kit: claude-cli warm fork | CC | CC | C | | | | C |
| k03 ask-kit: routing order | CC | CC | C | | | | C |
| k04 ask-kit: env vars stripped | CC | CC | C | | | | C |
| o01 omarchy: sync commands | CC | CC | C | | | | C |
| o02 omarchy: sync excludes | CC | CC | C | | | | C |
| o03 omarchy: sync path mapping | CC | CC | C | | | | C |
| o04 omarchy: pairs.lua load order | CC | xC | C | | | | C |

## In the calling session: with ask vs digging itself

All of these are run 1.

| Questions | Way | Score | Median time | Cost / question | Context added / question (median) | Context added (total) |
|---|---|---|---|---|---|---|
| dated sessions | ask → glm-5.3-flash | 10/10 | 35 s | $0.002 | 391 | 3.8k |
| dated sessions | Sonnet digs (Read/Grep/Bash) | 10/10 | 25 s | $0.118 | 10k | 119k |
| undated sessions | ask → glm-5.3-flash | 2/3 | 111 s | $0.008 | 667 | 1.6k |
| undated sessions | Sonnet digs | 3/3 | 172 s | $0.150 | 11k | 65k |
| code | ask → glm-5.3-flash | 8/8 | 12 s | $0.003 | 333 | 2.9k |
| code | Sonnet digs | 8/8 | 11 s | $0.057 | 4.8k | 41k |

The baseline started each question at a median of 24k tokens of context. Its median peak was 31k
and its largest 67k. It took a median of 5 turns and 4 tool calls, and no question hit its cap.

**Estimated cost inside a session that is already open.** Each baseline question ran in a fresh
`claude -p`, so its price includes writing its own 24k-token prefix. A real calling session has
that prefix cached already. The table below estimates the extra cost in an open session holding C
tokens:

- It is built from the measured turns, tokens added and output.
- Digging: every turn re-reads C.
- With ask: two turns (the call, then the answer), plus ask's own cost.
- Prices are Sonnet 5.5's: $0.10/M cache read, $2.50/M cache write, $10/M output.

| Questions | C | Digging itself, per question | With ask (glm), per question |
|---|---|---|---|
| dated sessions | 50k | $0.075 | $0.014 |
| dated sessions | 150k | $0.145 | $0.034 |
| undated sessions | 50k | $0.122 | $0.020 |
| undated sessions | 150k | $0.222 | $0.040 |
| code | 50k | $0.044 | $0.015 |
| code | 150k | $0.089 | $0.035 |

This is an estimate, not a measurement. What is measured is the context the digging adds, and that
context stays in the session, so every later turn pays to re-read it.

## Follow-ups and cold starts

| Backend | Fresh questions: median time, cost | Follow-ups: median time, cost | Fresh: median cells | Follow-ups: median cells |
|---|---|---|---|---|
| glm-5.3-flash | 54 s, $0.0024 | 3 s, $0.0006 | 4 | 0.5 |
| deepseek-v4.1-flash | 63 s, $0.0036 | 7 s, $0.0007 | 12 | 1.5 |
| claude-haiku | 29 s, $0.0040 | 11 s, $0.0020 | - | - |
| codex | 34 s | 14 s | 4 | 0.5 |
| copilot | 87 s | 21 s | 6 | 0 |
| qwen3.5:9b | 125 s | 145 s | 2 | 3.5 |

A follow-up reaches an investigator that still holds what it found. On glm it answered in 3 s for
$0.0006, usually with no new code.

No cold-start penalty was measurable on the API backends. The provider's prompt cache serves the
fixed prefix from the second call on, and the first question's time depends on which question it
is. Haiku pays a one-off warm-up of about $0.003. Qwen's first question took 15 minutes, mostly
loading the model with a 32k-token context.

## Findings

1. **Same accuracy, a fourteenth to a twenty-sixth of the context.** On 21 questions, ask on its
   default cheap model scored 20 and 21 (two runs), and Sonnet 5.5 digging by itself scored 21.
   With ask, the calling agent took in about 330–670 tokens per question. Digging took
   4,800–11,000, or 8.3k against 225k over the set.
2. **Much cheaper per question.** As run, a glm ask cost $0.002–0.008 and a Sonnet dig $0.06–0.15.
   Costed against a session that already holds 50k tokens, the dig is $0.04–0.12 and ask
   $0.014–0.020. The gap widens as the session grows.
3. **When the question names a date, digging is as fast. When it names nothing, ask is
   faster.** Given a date and an agent, Sonnet went straight to the right transcript folder (25 s
   against 35 s). Given no date, it needed 172 s and 11k tokens of reading; ask on glm took 111 s.
4. **Follow-ups are almost free.** With `continue: true`, the investigator still holds what it
   found: 3 s and $0.0006 on glm.
5. **Subscriptions work, but slowly.** Codex on a ChatGPT plan scored 12.5/13 on the session
   questions, the best of the ask backends, and was quick (34 s median). Copilot CLI scored 12/13
   but was the slowest, at 87 s median. On one question it spent 10 minutes and 46 steps and
   returned only its progress note ("Searching the session transcripts…") as the answer. Claude
   Code with haiku matched glm at about twice the price.
6. **The benchmark found a bug in ask-kit.** Ollama cut every prompt at its default 4,096-token
   context, and `ask-kit doctor` still reported the backend ok. It was fixed during the benchmark
   (commit 738b42d). A second problem showed up on a count question in the private set: the session
   grep script searched only the last 14 days. That cut off two sessions from earlier in the month,
   and glm answered 9 where the right number was 12. With the fix (30-day default, and every
   result names its window), glm answered 12 on both reruns, in about 20 s for $0.002.
7. **A small local model isn't good enough yet.** After the fix, qwen3.5 9B on Ollama scored
   7.5/13 on the session questions. It answered "could not find" or "no such thing happened" where
   the answer was there, and took a median of over two minutes. It is private and free, but its
   answers need checking.

## Caveats

- **One machine, one person, a small set.** The machine holds about 1,500 sessions (1,250 Claude
  Code, 62 Codex, 149 Copilot CLI, 3 opencode). There are 21 published questions, written by the
  same person (me, an agent session) who checked them. The good backends differ by a question or
  two, which is noise at this size. "The same accuracy" is the honest reading.
- **My expected answers were too narrow on 4 of the 21 published questions.** The investigators
  or the baseline found real sessions or code I had missed:
  - **n03:** a second session the same day fixed a different cause of the same symptom.
  - **h06:** two more sessions looked at Herdr as an editor.
  - **n05:** a third time an agent crashed the shell.
  - **o04:** the code contradicts its own comment about load order. I had taken the comment at its
    word; haiku and the baseline read the code.

  I widened n03, h06 and n05 and re-graded every backend. I rewrote o04 and re-ran it on every
  backend that runs code questions. On undated questions especially, an expected answer has to be
  checked against everything on disk, not just the session you had in mind. In the private set, one
  undated count question was dropped for the same reason: its answers ranged from 4 to 7, and the
  transcripts support more than one reading.
- **Grading.** A Sonnet judge, with every verdict that was not "correct" read by hand. Two were
  overturned. Both were baseline answers marked partial for wording, and one had more correct
  detail than the reference.
- **The baseline is one setup.** It is Sonnet 5.5 through `claude -p`, with
  Read/Grep/Glob/Bash, user settings off, and told where the transcripts live. A different agent,
  model or prompt would dig differently. Its dollar cost includes writing its own prefix, hence the
  in-session estimate.
- **Runs overlapped.** Backends ran in parallel on one machine, and the local model shared it.
  Times are wall-clock and include provider latency, which varies between runs, so compare cells
  more than seconds.
- **ask-kit changed during the run.** Commit 738b42d (Ollama through its own API; the loop
  accepts any tool call carrying `code`) landed between runs, and b94700d (the 30-day grep) landed
  after them. Qwen's numbers all come after 738b42d. The count reruns are the only numbers after
  b94700d.
- **Questions are quoted as asked.** Session ids are the evidence and are left in. Home paths in
  the results are replaced by `~`.

## Spend

| What | Cost |
|---|---|
| ask, all API and Claude Code backends, public and private sets | $0.72 |
| Baseline, Sonnet 5.5 | $3.54 |
| Judge and test calls | $4.39 |
| **Total** | **about $8.65** |

On top of that, Copilot used 27 premium requests, and Codex ran on a ChatGPT plan.
