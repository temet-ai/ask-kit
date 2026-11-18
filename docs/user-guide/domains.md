# Domains: add, write, share

A domain is something `ask` can answer about. ask-kit ships two, `sessions` and `code`. You can
add one someone shared, write your own, or share yours. The `ask-kit-domain` skill walks an agent
through all three.

## What a domain is

A folder with:

- `domain.mjs`: the REPL's globals, the prompts and the words the router knows it by,
- `api.d.ts`: a typed description of what the domain lets the investigator's programs reach,
- `instructions.md`: how to investigate, what counts as evidence and how to cite it,
- `scripts/`: ready-made scripts for the common questions.

Your own go in `~/.config/ask-kit/domains/<name>/`. One there wins over a built-in of the same
name. The contract is in `src/domains.mjs`, and `domains/code` is a short example.

## Add one someone shared

```
Read ~/.config/ask-kit/AGENTS.md, then add this domain: github.com/<owner>/<repo>
```

or from the shell:

```sh
ask-kit gallery                  # shared domains: GitHub repos with the topic ask-kit-domain
ask-kit add <owner>/<repo>       # fetch it and show its files, without enabling it
ask-kit add <owner>/<repo> --yes # install and enable it
```

A domain is code that runs in the investigator's REPL with your rights. `ask-kit add` always
shows the files first, and the agent tells you what the domain reads and runs before it asks
for your yes.

## Write one

1. Copy the shape of `domains/code`. Keep the globals read-only and narrow: a client for the
   thing, with methods that return plain data.
2. Write `api.d.ts` with every global and method, its parameters and what it returns. The
   investigator writes code from this file alone.
3. Write `instructions.md`: what the data holds, how to search it narrowly, how to cite.
4. Add two or three scripts for the questions people will ask most.
5. Enable it under `domains` in the config, ask it three real questions, and fix what it got
   wrong ([Tune it from the journal](tuning.md)).

## Share one

Put the domain folder and a `RECIPE.md` in a public GitHub repository and give it the topic
`ask-kit-domain`. The recipe says what the domain answers, what it needs (programs, keys,
access), what it reads and runs, and a brief another agent could rebuild it from in an empty
folder. It then shows in `ask-kit gallery`, and others add it with one line.
