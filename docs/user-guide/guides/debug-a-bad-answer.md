# Find and fix a bad answer

This guide takes one wrong, slow or empty answer from the first look to a checked fix. It is the
manual version of what the `ask-kit-improve` skill does. [Make it better](../tuning.md) gives the
short form, and the [journal reference](../reference/journal.md) lists every field used here.

You need `jq` for the commands that read journals. Everything else is `ask-kit`.

## 1. Write down the question and what was wrong

Copy the question exactly, and note what the answer should have said and what it said instead.
You will ask the same question again at the end, and a change you cannot measure against the
original is a guess.

## 2. Find the ask in the report

```sh
ask-kit report --since 24h
```

Each flagged ask shows the time, domain, backend, duration, its signals and the journal file. If
your ask is listed, note its signals and the journal path. If it is not listed, the ask ran
without a problem the report can see, and only its answer was wrong. Find it by its text:

```sh
grep -rl "part of your question" ~/.local/state/ask-kit --include='*.jsonl'
```

Use `--json` for a record you can filter:

```sh
ask-kit report --since 24h --json | jq '.flaggedAsks[] | {ts, backend, ms, signals, journal}'
```

## 3. Read the ask record

```sh
jq -c 'select(.type=="ask") | {ts, backend, kind, ok, continued, ms, turns, cells, costUsd, partial, missteps, error, answerChars}' <journal file>
```

This tells you which backend answered, how long it took, how many steps it used and whether it
finished. The signal it carries points at a likely cause:

| Signal or field | Usual cause | Where to look |
|---|---|---|
| `failed: <error>` | The backend: a missing key, a provider error, a CLI that is not signed in | [`ask-tool` errors](../reference/ask-tool.md#errors); run `ask-kit doctor` |
| `out of steps or time` (`partial`) | The investigator searched without converging | Its cells (step 4); a script that narrows the search |
| `answered near the time limit` | It converged late | Same |
| `cut off` (`cutAtLength`) | The model's replies hit the length limit | The instructions ask for long output, or the model is too small |
| `<n> missteps` | The model wrote tool-call markup or an empty reply instead of calling the tool | The backend: try `nativeTools: false` or another model |
| `slow` | Many cells, or one cell that read a lot | Cell `ms` and `calls` (step 4) |
| `costly` | Many steps on a priced backend | Same |
| `re-asked` | The caller was not satisfied and asked again within three minutes | The first answer, which is the bad one |
| `empty answer` | The model ended without text | The backend |
| none | The investigation looked normal and the answer was wrong | The cells: what did it read before it answered? |

## 4. Read the investigator's cells

Every cell the investigator ran is a record in the investigator's own journal file, in the same
domain folder. List the files by time and read the cells that ended just before the ask record:

```sh
ls -t ~/.local/state/ask-kit/<domain>/*.jsonl | head -5
```

The ask record's `ts` is when the ask ended and `ms` is how long it ran, so its cells have a `ts`
between `ts - ms` and `ts`. Filter on that range, with the two times from the ask record:

```sh
jq -r --arg from "2026-11-18T09:31:00Z" --arg to "2026-11-18T09:31:25Z" '
  select(.code and .ts >= $from and .ts <= $to)
  | "\(.ts)  ok=\(.ok)  \(.ms)ms  \(.resultChars) chars  scripts=\([.scripts[].name] | join(","))\n\(.code)\n\(.error // "")\n"
' ~/.local/state/ask-kit/<domain>/*.jsonl
```

For the `code` domain the folder is one level deeper: `~/.local/state/ask-kit/code/<repository>/`.

Read the cells the way the investigator did, in order, and ask of each one:

| Look for | What it means |
|---|---|
| The first cell is a raw `repo.rg` or `history.grep`, and a script exists for it | The instructions or `openWith` do not steer it to the script. |
| `scripts` is empty for several cells that look alike | A route worth a script. `ask-kit report` counts these. |
| `ok: false` and an `error` | It guessed wrong about a function or a result's shape. The error holds the shapes of the values it had. Check that `api.d.ts` says what the function really returns. |
| `repeat` is set | It ran the same cell again. It is stuck. |
| `resultChars` is large, or `calls[].size` is large | A search read too much. A script that narrows by default fixes it. |
| A cell that found the right line and a later cell that ignored it | A reading error. The answer rules or instructions need a sentence about reading before stating. |
| The cells never searched the place the answer was | The instructions do not say where such things live. |
| `snapshot.dropped` lists names | A variable could not be saved, so a follow-up lost it. |

The answer's text is not in the journal: only `answerChars` is. The text is what the caller
received. Keep the wrong answer from your own record of it (step 1).

## 5. Isolate the model from the instructions

Ask the same question on each backend you have:

```sh
ask-kit ask --domain code --backend <name> "<the same question>"
```

`ask-kit doctor` lists the backend names. The result tells you where to look:

- Wrong on every backend: the instructions, the scripts or the domain's API are at fault.
- Right on one backend and wrong on another: the model. Give the domain a different backend with
  `domains.<name>.backend`, or fix the instructions only if the weaker model can follow them.
- Right on a second run with the same backend: the investigator's path varies from run to run.
  Ask it twice more and judge the pattern before you change anything.

Each run is journaled and shows in the next report.

## 6. Make the smallest fix

Pick the layer the evidence points at, and change one thing. The paths are in the domain's
folder: `domains/<name>/` in the install for the built-in domains, or
`~/.config/ask-kit/domains/<name>/` for your own.

| Evidence | Fix |
|---|---|
| It misread the question or skipped a step | One sentence in `instructions.md`. Replace a line where you can; do not grow the file. |
| It skipped a script that fits | The script's `meta.purpose` and `params` (that is what the investigator reads), or the `openWith` line in `domain.mjs`. |
| It rebuilt the same search by hand | A [script](add-a-script.md), or promote a draft. |
| A search read too much | Make the script narrow by default: a time window, one source, a cap on rows. |
| It guessed a function's shape | Correct `api.d.ts`: every parameter and every field of what it returns. |
| The wrong thing is the model's habit | The backend: `nativeTools`, another model for that domain ([config reference](../reference/config.md#backends)). |
| It could not find what exists | The tool is missing a capability. Add a method to the client, and declare it in `api.d.ts`. |

Instructions are read on every question, so a long file costs every ask. A script is read only when
it runs. Prefer a script over a longer instruction.

Changes take effect on the next question: editing instructions, scripts or `api.d.ts` changes the
investigator's fingerprint, and it re-warms. Nothing needs a restart.

## 7. Ask the question again

```sh
ask-kit ask --domain <name> --backend <same backend as the bad ask> "<the exact question>"
```

Compare with what you wrote down in step 1: the answer, and in the new ask record the `ms`,
`turns` or `cells`, and `costUsd`. The investigator now should start from the script or follow the
sentence you added.

Then ask two or three other questions that go through what you changed. A fix for one question
that breaks another is a common result.

```sh
ask-kit report --since 1h
```

The new asks should carry no signals, and the script you added or changed should show under
`Scripts`.

## 8. Keep what you learned

If the fix is a rule that applies to every domain (cite evidence, read before stating), it belongs
in the built-in instructions in the ask-kit repository, as a pull request that includes the
question and the before and after. If it is specific to your data, it stays in your domain.

An agent can do steps 2 to 7: paste
`Read ~/.config/ask-kit/AGENTS.md, then improve ask from the last week's journal.` It changes
nothing without your yes.

## Related

- [Make it better](../tuning.md)
- [Journal reference](../reference/journal.md)
- [Add a script to a domain](add-a-script.md)
- [Run the benchmark](run-the-benchmark.md): the same loop over a fixed set of questions.
