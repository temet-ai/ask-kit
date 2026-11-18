---
name: ask-kit-domain
description: Add something new for ask-kit's `ask` to answer about - install a domain someone shared (a GitHub repo with the topic ask-kit-domain), write a new domain (a REPL API, scripts and instructions for a service, a database, a docs folder, logs), or share one of yours with a RECIPE.md. Use when the user pastes "add this domain", asks for ask to answer about a new thing, or wants to publish a domain.
---

# Domains: add, write, share

The command is `{{ASK_KIT}}` (below: `ask-kit`). ask-kit's guide, with every path on this machine,
is {{AGENTS_MD}}: read it first.

A domain is a folder: `domain.mjs` (its globals and words), `api.d.ts` (the typed API the
investigator reads), `instructions.md` (how to investigate and cite), and `scripts/`. Your own go
in the `domains/` folder next to the config; one there wins over a built-in of the same name.

## Add one someone shared

`ask-kit add <github url or owner/repo>` fetches it and shows its files without enabling it.
A domain is code that runs in the investigator's REPL with your user's rights, so read
`domain.mjs` and the scripts and tell the user plainly what they read and run (files, commands,
network). Only when the user agrees: `ask-kit add <repo> --yes`. Then
`ask-kit ask --domain <name> "<a question it should answer>"`.

`ask-kit gallery` lists the shared domains (GitHub repos with the topic `ask-kit-domain`).

## Write one

1. Copy the shape of `domains/code` (a client for one repository: search, read, edit, run, git)
   from the ask-kit install named in the guide. Globals are a client for the thing, with methods
   that read it and methods that act on it, returning plain data, and every call reported through
   `push()` so the journal shows it.
2. `api.d.ts`: every global and method with its parameters and what it returns. The investigator
   writes code from this file alone, so make it exact.
3. `instructions.md`: what the data holds, how to search it narrowly, what counts as evidence and
   how to cite it, what never to do.
4. Two or three scripts for the questions people will ask most; each with `meta`.
5. Enable it under `domains` in the config, then ask it three real questions and fix what it
   got wrong (the ask-kit-improve skill).

## Share one

Write a RECIPE.md next to the domain: what it answers, what it needs (programs, keys, access),
what it reads and runs, and a brief another agent could rebuild it from with an empty folder.
Put the domain folder and the recipe in one repository, push it public, and add the topic
`ask-kit-domain`. It then shows in `ask-kit gallery`, and others add it with one line:
`Read <their ask-kit guide>, then add this domain: github.com/<you>/<repo>`.
