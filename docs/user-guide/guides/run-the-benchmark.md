# Run the benchmark

The benchmark in `bench/` asks a fixed set of questions through ask-kit's real MCP server, grades
the answers, and compares backends with each other and with an agent that digs by itself. Use it to
choose a model, to check that a change to the instructions or scripts did not make answers worse,
and to reproduce the numbers in
[`bench/RESULTS.md`](https://github.com/temet-ai/ask-kit/blob/main/bench/RESULTS.md).

The questions are about particular repositories and transcripts. The public set can be rerun only
where you have the same data: the four questions about ask-kit's own code can be rerun by anyone.
For anything else you write questions about your own work, in the same format. Step 2 shows how.

## The files

| File | What it does |
|---|---|
| [`bench/questions.json`](https://github.com/temet-ai/ask-kit/blob/main/bench/questions.json) | The public questions, with the expected answers and the facts an answer must contain. |
| [`bench/paths.mjs`](https://github.com/temet-ai/ask-kit/blob/main/bench/paths.mjs) | `loadQuestions()` and the result folders. Loads `bench/questions.json`, or the file in `BENCH_QUESTIONS`. |
| [`bench/run-ask.mjs`](https://github.com/temet-ai/ask-kit/blob/main/bench/run-ask.mjs) | Runs the questions through `ask-kit serve` on one backend and writes one JSON line per question. |
| [`bench/run-baseline.mjs`](https://github.com/temet-ai/ask-kit/blob/main/bench/run-baseline.mjs) | Runs the same questions through `claude -p` with its own read tools and no `ask`, for comparison. |
| [`bench/grade.mjs`](https://github.com/temet-ai/ask-kit/blob/main/bench/grade.mjs) | Grades each answer against the expected answer with a model as judge. |
| [`bench/hand-grades.json`](https://github.com/temet-ai/ask-kit/blob/main/bench/hand-grades.json) | Verdicts changed by hand after reading an answer. They win over the judge. |
| [`bench/report.mjs`](https://github.com/temet-ai/ask-kit/blob/main/bench/report.mjs) | Turns results and grades into Markdown tables. |
| [`bench/redact.mjs`](https://github.com/temet-ai/ask-kit/blob/main/bench/redact.mjs) | Copies raw results into `bench/results/` with home paths and private words replaced. |
| `bench/results/` | The published runs: `<name>.jsonl` and `<name>.graded.jsonl`. |
| [`bench/RESULTS.md`](https://github.com/temet-ai/ask-kit/blob/main/bench/RESULTS.md) | The write-up. Its tables are pasted from `report.mjs`. |
| `bench/private/` | A git-ignored folder for questions about private work. When it exists the scripts load its questions too. Nothing in it is published, and this guide does not describe it. |

The judge and the baseline run `claude -p`, so they need Claude Code installed and signed in.

## 1. Set up a scratch ask-kit

The benchmark must not touch your real config or state. `run-ask.mjs` refuses to start unless
`ASK_KIT_CONFIG` and `ASK_KIT_STATE` are both set. Set them in the shell you run everything in,
before any other command:

```sh
export ASK_KIT_CONFIG=$(mktemp -d) ASK_KIT_STATE=$(mktemp -d)
```

Write the answers for a config with every backend you want to compare, no agents (`clients` is
empty, so nothing is registered anywhere) and the sources your session questions need. A source
list that is missing or empty gives the sessions domain no sources:

```json
{
  "sources": ["claude-code", "codex"],
  "clients": [],
  "investigator": "openrouter:z-ai/glm-5.3-flash",
  "extras": ["openrouter:deepseek/deepseek-v4.1-flash-1017", "claude-cli:haiku"],
  "domains": ["sessions", "code"],
  "keys": { "openrouter": { "env": "OPENROUTER_API_KEY" } }
}
```

```sh
ask-kit apply bench-answers.json --dry-run
ask-kit apply bench-answers.json
ask-kit doctor
```

With the two variables set, `apply` writes only into the scratch folders. `doctor` prints
`config: <the scratch folder>/config.json` as a check. Its backend list shows the names to pass to
`--backend`: `glm-5.3-flash`, `deepseek-v4.1-flash-1017`, `claude-haiku`.

## 2. Choose the questions

`bench/questions.json` has this shape:

```json
{
  "about": "free text",
  "repos": { "ask-kit": "b6c1e5f" },
  "sessionsNote": " (Ignore session 96f346df, which is the benchmark asking these questions.)",
  "questions": [
    {
      "id": "k01-loop-limits",
      "domain": "code",
      "repo": "ask-kit",
      "question": "...",
      "expected": "the reference answer",
      "facts": ["each", "fact the answer must contain"],
      "source": "where the expected answer was read, for people"
    }
  ]
}
```

| Question field | Meaning |
|---|---|
| `id` | Unique. Result rows, grades and hand grades match on it. |
| `domain` | `sessions` or `code`. |
| `repo` | Code questions: a key of `--repos`. One server runs per repository. |
| `question` | What is asked. For a sessions question, `sessionsNote` is added at the end. |
| `expected`, `facts` | What the judge compares an answer against. |
| `followupOf` | The `id` of a question this one follows up. It runs straight after its parent, with `continue: true`, in the same caller session. |
| `tier` | `"undated"` puts a sessions question in its own table in the report. |
| `excluded` | `true` keeps the question in the file and leaves it out of the report. |
| `agent`, `source`, `pairsWith` | Notes for people. No script reads them. |

`sessionsNote` is text added to every sessions question. The public file uses it to tell the
investigator to ignore the session that holds the answers. Do the same for yours: the benchmark's
own transcript would otherwise contain every expected answer.

To use your own questions, write a file in this shape and point `BENCH_QUESTIONS` at it. When
`BENCH_QUESTIONS` is set, the private set is not loaded:

```sh
export BENCH_QUESTIONS=$PWD/my-questions.json
```

Write each `expected` after reading the source it came from, and put the source in `source`. A
question whose expected answer is wrong makes every backend look wrong.

## 3. Run ask on a backend

Code questions run against a clone, not your working copy, because `bench/questions.json` holds the
expected answers and the investigator could read them. Clone from a commit that does not have
`bench/`, or delete it in the clone:

```sh
git clone https://github.com/temet-ai/ask-kit $TMPDIR/ask-kit-clone
git -C $TMPDIR/ask-kit-clone checkout b6c1e5f
```

Then run one backend:

```sh
mkdir -p raw
node bench/run-ask.mjs --backend glm-5.3-flash --set code --run 1 \
  --repos ask-kit=$TMPDIR/ask-kit-clone --out raw/glm-5.3-flash.jsonl
```

| Flag | Default | Meaning |
|---|---|---|
| `--backend` | required | A backend name in the scratch config. |
| `--out` | required | The results file. Rows are appended. |
| `--set` | `all` | `sessions`, `code` or `all`. |
| `--run` | `1` | A run number, written to each row. Use `2` for a repeat. |
| `--repos` | none | `name=path,name=path`: the clone for each `repo`. |
| `--only` | all | Comma-separated ids. A question whose `followupOf` is listed also runs. |
| `--timeout` | `600` | Seconds per question, passed as `timeoutSeconds`. |

Each run prints one line per question, for example `glm-5.3-flash r1 k01-loop-limits ok 12s $0.0028 6 cells`.
It starts one `ask-kit serve --domain <d>` per domain (and per repository for `code`), with the caller
session `bench-<time>-<backend>-r<run>-<repo or domain>`, so every run has its own follow-up state.
The sessions server runs in your current directory.

A row holds:

| Field | Meaning |
|---|---|
| `id`, `domain`, `repo`, `backend`, `run`, `position`, `continued` | Which question, and where it ran in the run. `position` 0 of run 1 is the cold question. |
| `ok`, `partial`, `atLimit`, `error` | Whether the ask finished, ran out of steps or time, and the error if any. |
| `wallMs` | Time as the caller saw it. |
| `ms`, `costUsd`, `cells`, `turns`, `usage`, `warm`, `missteps` | The numbers from ask-kit's own [journal](../reference/journal.md#ask-record). |
| `callerChars`, `toolChars` | The question plus answer size, and the size of the `ask` tool's description and schema. The report turns them into tokens added to the caller's context. |
| `answer` | The answer text without the footer line. |

A run needs a working model and costs money on a priced backend. The public set takes roughly 15
minutes on the default model and costs under a dollar (see `bench/RESULTS.md`).

To compare backends, run the command again with another `--backend` and another `--out`.

## 4. Run the baseline

The baseline gives the same question to Sonnet running `claude -p` with Read, Grep, Glob and Bash,
no MCP servers, no `ask`, user settings turned off and a per-question budget:

```sh
node bench/run-baseline.mjs --set code --repos ask-kit=$TMPDIR/ask-kit-clone \
  --out raw/baseline-sonnet.jsonl
```

| Flag | Default | Meaning |
|---|---|---|
| `--out` | required | The results file. |
| `--set`, `--repos`, `--only` | as above | |
| `--cwd-sessions` | none | A neutral folder to run sessions questions in. Required for them. |
| `--model` | `sonnet` | Passed to `claude --model`. The backend name becomes `baseline-<model>`. |
| `--budget` | `0.75` | Dollars per question (`--max-budget-usd`). |

A row has the same identifying fields, plus `stop` (how the run ended), `toolCalls`, `tools`,
`contextFirst` and `contextPeak` (tokens in the first and largest request: their difference is
what the digging added to the agent's context), `turns` and `costUsd`. This is the baseline the
report compares with `ask`.

## 5. Grade

```sh
node bench/grade.mjs raw/glm-5.3-flash.jsonl raw/baseline-sonnet.jsonl --cwd $TMPDIR
```

For each file it writes `<name>.graded.jsonl` next to it, one line per result row in the same
order: `{ hash, id, backend, run, verdict, reason }`. The judge is Sonnet through `claude -p`, with
no tools and its own system prompt, twelve answers a call. The verdicts:

| Verdict | Meaning |
|---|---|
| `correct` | Every required fact is present and right. Wording and extra detail do not matter. |
| `partial` | At least one required fact is right and another is missing. Counts as half. |
| `wrong` | No required fact is present, or one is contradicted, or the answer is about something else. "Could not find it" is wrong. |
| `ungraded` | The judge returned nothing for the row. Run grade again. |

A row is graded again only when its answer, its question's `expected` or its `facts` changed, so a
rerun grades only new rows. `--model` changes the judge. `--cwd` is the folder the judge starts in; use a
neutral one, because project files in it are loaded as context.

A judge can be wrong in either direction. Read every answer that is not `correct` against its
source. When the judge is wrong, add an override to `bench/hand-grades.json`:

```json
{
  "id": "k01-loop-limits",
  "backend": "glm-5.3-flash",
  "run": 1,
  "verdict": "correct",
  "reason": "States the 20-step limit and the 60 s cell limit; the judge wanted the 4000-character clip, which the question did not ask for."
}
```

The file is `{ "about": "...", "overrides": [ ... ] }`. `report.mjs` applies the overrides over the
judge's verdicts and counts them.

## 6. Make the tables

Put the result and graded files of the runs you want to compare in one folder and give it to the
report:

```sh
node bench/report.mjs raw > tables.md
```

With no argument it reads `bench/results/`. It pairs each results file with its `.graded.jsonl`
by line number, so never reorder or edit one without the other. It prints, in Markdown:

- one table per question set (`sessions`, `sessions-undated`, `code`): per backend and run, the
  counts of correct, partial and wrong answers, a score (a partial is half), the median and total
  time, the cost per question and in total, the mean number of cells and the number of answers that
  ran out of steps or failed;
- the calling session with `ask` on `glm-5.3-flash` against the baseline: score, time, cost and the
  tokens each way adds to the caller's context;
- an estimate of the cost inside a session that already holds 50 000 or 150 000 tokens;
- cold against warm, and follow-ups against fresh questions;
- a grid of the questions against the backends, one letter per run (`C` correct, `p` partial,
  `x` wrong);
- the number of graded answers and of verdicts changed by hand.

The comparison tables name `glm-5.3-flash` and `baseline-sonnet`, and backends not in the fixed
order list in `report.mjs` sort first. If you compare other backends, edit those constants in the
script.

A second result for the same backend, question and run number counts as a further run.

## 7. Compare a change

To check that a change to instructions, scripts or the API did not make things worse:

1. Run the affected questions on the same backend before the change: `--only <ids> --run 1`.
2. Make the change.
3. Run them again: `--only <ids> --run 2`, writing to the same file or to a second one in the same
   folder.
4. Grade both and make the report. The grid shows `C` and `x` per run side by side.

Provider speed varies between runs, so compare cells and correctness before seconds. One run of
one question is weak evidence: look at the whole set.

## 8. Publish a run

`redact.mjs` copies raw results into `bench/results/`:

```sh
node bench/redact.mjs --terms ~/private-terms.txt raw/glm-5.3-flash.jsonl raw/glm-5.3-flash.graded.jsonl
```

It replaces the folder this checkout sits in with `<projects>/` and any `/home/<user>` or
`/Users/<user>` path with `~`. A terms file kept outside the repository adds more: one rule per
line, `regular expression => replacement`, case-insensitive. Rows for questions in the private set
go to `bench/private/results/` and never to `bench/results/`. It prints how many rows went to each.

Check the copies for names and paths you did not think of before you commit them. Then paste the
tables from `report.mjs` into `bench/RESULTS.md` with the method and the date. Do not commit
anything from `bench/private/`.

## Related

- [Run a question on one backend](debug-a-bad-answer.md#5-isolate-the-model-from-the-instructions)
- [Add a model or provider](add-a-backend.md)
- [Testing](testing.md)
