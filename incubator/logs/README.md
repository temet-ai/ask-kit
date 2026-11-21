# ask-kit-logs

An [ask-kit](https://github.com/temet-ai/ask-kit) kit that lets your coding agent's `ask` tool
answer questions about log files: an app's `logs/` folder, `/var/log/*.log`, an nginx access log,
a CI log someone saved, a JSON-lines log from a service. A cheap model streams the files outside
your agent's context and answers with the kinds of error, their counts, and the file, line and
time of each example, so your agent does not pull thousands of lines in with `tail -500`,
`grep -i error` and `sort | uniq -c`.

Questions it is built for:

- What went wrong in logs/app.log in the last hour, and is any of it new?
- When did the "timeout after" error first appear, and what happened just before?
- What happened to request req-7f3a across the logs in this folder?
- Which endpoint returns the 502s in access.log, and when did they start?
- What does today's log hold that yesterday's did not?

## Install

You need [ask-kit](https://github.com/temet-ai/ask-kit#set-it-up) 0.3 or later and Node.js 22.13
or newer. The kit has no dependencies and runs no program; it works on Linux, macOS and Windows.

Paste this into your agent:

```
Read ~/.config/ask-kit/AGENTS.md, then add this kit: github.com/temet-ai/ask-kit-logs
```

Or run it yourself:

```sh
ask-kit kit install temet-ai/ask-kit-logs        # shows what it reads, changes and runs
ask-kit kit install temet-ai/ask-kit-logs --yes  # installs and enables it
```

Restart your agents so `ask` lists `logs`. `ask-kit kit list` says whether it can run on this
machine, and why not. Settings, all optional:

- `WORKDIR`: the folder questions are about; detected as the folder your agent runs in.
- `LOGS_DIRS`: folders or files to look in when a question names no log, comma-separated. The
  default is the `logs` and `log` folders under `WORKDIR`, and `/var/log` on Linux and macOS.
- `LOGS_UTC_OFFSET`: the zone of timestamps written without one, such as `+02:00`. The default is
  UTC.

## What it can change

Nothing. The kit only reads: it has no `acts`, writes no file, keeps no state and runs no program.

`logs.mjs` guards what the model reads:

- Credentials are replaced with `<redacted>` before a line is parsed, so no result, signature or
  search can show them: the values after `password=`, `token=`, `secret=`, `api_key=` and similar
  keys (in text, in URL queries and in JSON fields), `Authorization`, `Cookie` and `Set-Cookie`
  headers, `Bearer` tokens, the password in a URL, private key blocks, and tokens of well-known
  shapes (JWT, GitHub, AWS, Slack).
- Files named like credentials are refused: `.env`, `.npmrc`, `.netrc`, key files,
  `credentials.*`, `secrets.*`, shell histories, and anything under `.ssh`, `.aws` or `.gnupg`.
- Everything is bounded: reading stops after 100 seconds and says so, lists are capped and say
  how many were left out, a message is clipped at 400 characters and a stack trace at 12 lines.

Redaction works on names and shapes. A secret printed with no key beside it and no known shape
(a bare password in a sentence) is not recognised.

## How well it works

The bench, `bench/questions.json`, holds 22 shots: a script and its params, run with no model
against the logs in `bench/fixture/`. `ask-kit kit test logs` on 2026-11-21, run from the kit's
folder, passed 22 of 22, all answered with no model. That checks the scripts, not an
investigator: no model run has been made yet, and the bench has no model questions, because those
come only from real sessions.

The scripts were also run on the logs of one Linux machine: `/var/log` (dpkg, apt, alternatives
and bootstrap logs), a 600 KB application debug log, a JSON-lines service log with nanosecond
times, and npm's debug logs. No real nginx, Apache, Java or syslog file was on that machine; those
formats were run on the fixture and on hand-written lines only.

On a generated 1 GB JSON-lines log (5.6 million lines) on the same machine, `errors` over the
whole file took 11 seconds, about 500000 lines a second, with a peak memory of 135 MB, and its
counts matched `grep -c`. A window at the end of that file (`since: "last-10m"`) took 0.7 seconds
in `timeline`, because the part before the window is skipped by position. A gzip file is read at
about 380000 lines a second. Windows and macOS are written for and not tested.

## What is in it

`logs.mjs` gives the investigator a `logs` global that streams files: `errors`, `timeline`,
`firstSeen`, `around`, `requests`, `compare`, `overview`, `scan`, `each`, `tail`, `files` and
`signature`; `parse.mjs` holds the formats, the timestamps, the error signature and the
redaction. Its scripts are `errors` (the kinds of error in a window, most frequent first, each
with an example and whether it is new), `timeline` (entries per bucket of time, with the
stretches that stand out), `first-seen` (when a text or an error first appeared, how often since,
and what came before), `around` (the entries around a time, a line or a request id, merged across
logs), `requests` (an access log by status, path and time), `compare` (two logs or two periods by
kind of entry) and `overview` (the logs found: format, span, lines, share of errors).
[RECIPE.md](RECIPE.md) says what it reads and runs, and how to rebuild it.

MIT licence.
