# Search code and past work

Use `ask` wherever you would otherwise grep, scroll through old sessions, or open file after
file to find one thing.

## Search past sessions

Your agents already save every session to disk. `ask` searches all of them at once, across Claude
Code, Codex, Copilot CLI, Gemini CLI and opencode.

| Looking for | Type |
|---|---|
| A command you ran once | `ask what command I used to restore the staging database` |
| An error you've seen before | `ask whether we've hit "ECONNRESET during upload" before, and how it was fixed` |
| A decision | `ask what we decided about pagination in the API, and why` |
| Every session on a topic | `ask which sessions worked on the payment webhook in the last two weeks` |
| What a session did | `ask what session d15c0de1 changed, file by file` |
| Something you half remember | `ask about the session where we talked about moving off Redis, around early November` |

The more you pin down (dates, branch, project, agent), the faster and cheaper the search. "Last
week, in the api repo" is enough.

## Search the code

| Looking for | Type |
|---|---|
| Where something is | `ask where feature flags are read` |
| How something works | `ask how a request gets from the router to the database` |
| Every place that uses something | `ask everything that calls sendInvoice` |
| What controls behaviour | `ask which config keys and env vars change logging` |
| When and why a line changed | `ask when the timeout in client.ts changed, and the commit message` |

Answers cite `path:line`, so the agent can open the exact place.

## Search past work and code together

Past work and code go to different investigators. Ask them one after another:

```
ask which session added the rate limiter, and why
ask where the rate limiter is configured now
```

## When not to use it

- You know the file and line already: just open it.
- The answer is one `grep` away and you want to see every hit yourself.
- The question is about the internet or a library's docs. `ask` reads only this machine.
