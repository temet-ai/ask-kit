---
title: Mesh - a kit joins the system, not just the folder
status: draft
created: 2026-11-21
summary: Installing a kit today copies a folder and enables it; nothing checks how it fits. Meshing makes adding, updating and removing a kit change the system around it - shared code, routing, who answers what, which kits call which - so that kits build on each other instead of each carrying its own copy of everything.
---

# Mesh: a kit joins the system, not just the folder

## The problem, measured

`ask-kit kit install` copies a kit's folder and turns it on. It checks two things: what the kit
reaches, changes and runs (the preview a person reads), and whether its `[[provides]]` tie with
an installed kit's. Nothing else looks at how the kit fits with the kits already there.

So every kit has written its own copy of what the others already have. `src/commons.mjs` parses
every kit's code and compares it, by job and by token similarity. On 2026-11-21, over the 22 kits
built so far (1,209 functions and long regular expressions, compared in about a second):

| Job | Kits with their own copy | What the host already has |
|---|---|---|
| finding files that hold credentials | 18 | `exclude` globs, for folder sources only |
| running a program with a timeout, journaled | 14 (9 near-identical wrappers, similarity 0.7) | `makeCli`, not given to modules |
| refusing a call, "not in this ask" | 8 | `notInThisAsk`, not given to modules |
| redacting secrets | 7, each with its own rules | `scrubSecrets`, used for transcripts only |
| ask-kit's state folder | 5 (4 byte-identical) | `stateDir`, new |
| HTTP through `HTTPS_PROXY` | 4 (web and api 0.95 alike; only api's sends bodies) | nothing: the host's own requests ignore the proxy |
| sizes and ages as text | 4 | nothing |
| a concurrency pool | 4 (0.9 alike) | nothing |
| walking folders with a skip list | 3 | nothing |

The copies drift. The api kit took the web kit's HTTP client and extended it; the web kit does not
get the extension. Seven redaction rule sets catch different secrets. A fix to one reaches no
other. And no kit uses another: `uses` and `ask.kit` are built, and no kit calls either.

## What meshing is

A kit meshes at five joints. Each is checked when a kit is added, updated or removed, and each can
change the system, not only the kit.

1. **Code: the shared library.** The host gives every module's `make()` a `lib` (redaction,
   credential paths, a command runner with the act guard, HTTP through a proxy, refusals, a pool,
   folder walking, sizes and ages, the kit's own state folder). When a kit arrives, the evaluator
   compares its code with `lib` and with every other kit. Three outcomes:
   - **use**: the kit has its own copy of something `lib` does. The preview names it, and the kit
     should move onto `lib`.
   - **contribute**: the kit's copy does something `lib`'s does not (the api kit's HTTP client
     sends bodies). That difference is a proposal to `lib`, with both copies side by side.
   - **promote**: two or more kits have the same code and `lib` has none. That is a proposal for a
     new `lib` function.

   This is how the library builds up: each kit added either uses what is there or brings
   something worth keeping.
2. **Routing.** The kit's bench questions must route to it, and every installed kit's bench
   questions must still route to their kit, by patterns, actions and keywords, with the new kit
   there. Questions it takes from a neighbour are named (`claims`, built). A neighbour whose
   `route_hint` should now point somewhere else ("ports are procs") gets a proposed line.
3. **Who answers what.** Where two kits answer the same thing (procs and systemd both know which
   process holds a port), the overlap is declared with `[[provides]]` and a priority, so the router
   chooses the same way every time. A tie stops the install (built).
4. **Composition.** The kit says what it offers other kits (`[[provides]]` with a capability other
   kits name) and what it would use (`uses`, `ask.kit`). The evaluator also finds code in a kit that
   another installed kit already answers for: a kit that parses log files could ask the logs kit.
5. **Measurement.** `replaces` (the commands the kit answers for) ties the kit into `ask-kit gaps`
   and `kit suggest`: before install, the digging it would have saved here; after, whether agents
   still go around it.

Removing a kit reverses what is the kit's (its routes, its capabilities, its proposals) and keeps
what became the system's: code it contributed to `lib` stays in `lib`.

## Where shared code lives

In the host, as `lib`, passed to `make()` and versioned with ask-kit. A kit that uses it sets
`min_ask_kit` to the version that has what it uses; an older host does not offer the kit and says
why (built). One place means one set of tests (`test/kitlib.mjs`), one fix reaching every kit, and
the host itself using the same HTTP client for its own requests.

The alternative, a shared kit that others `uses`, would let the library move faster than ask-kit,
but `uses` merges globals into the REPL, not into a module's `make()`, and a second release train
for the same code is more to keep in step.

## How it is used

- `ask-kit kit commons [<kit>]`: the evaluation, for one kit or all installed kits, by job and by
  similar code, with the three outcomes above.
- `ask-kit kit install`: the preview gains a short mesh section (uses its own copy of: http, redact;
  takes these questions from: systemd; overlaps: none).
- `ask-kit kit test`: the same evaluation, so an author sees it before publishing.
- The kits page: which kits use `lib`, and how much of each kit is its own code.

## Built (2026-11-21)

- `lib` (`src/kitlib/`, `test/kitlib.mjs`): for each job, the best of the kits' copies with what the
  others did better merged in. Redaction is the host's transcript shapes with the shell kit's name
  rules; HTTP is the api kit's client with the web kit's private-address guard; the runner is the
  nine kits' wrapper with the host's act guard, which none of them had.
- `ask-kit kit commons` (`src/commons.mjs`, `test/commons.mjs`), and `repeats` in the install preview.
- `ask-kit kit mesh <kit or source>` (`src/mesh.mjs`, `test/kit-mesh.mjs`): all five joints for one
  kit against the installed ones, with steps marked `agent` (the agent may take it), `ask` (the
  person decides) and `author` (for the kit's author or for `lib`). It changes nothing.
- The "Add a kit and work it into the system" steps in the AGENTS.md guide ask-kit writes
  (`src/agentsmd.mjs`): preview, read, mesh, tell the person, install on their yes, settle the
  decisions, prove it, report the author steps. This is what an agent follows when a person pastes
  "Read ~/.config/ask-kit/AGENTS.md, then add this kit: ...".

## Order of work

1. The evaluator, `lib`, `kit mesh` and the AGENTS.md steps: built (above).
2. Decisions the person makes in `kit mesh` that the config cannot hold yet: a neighbour's
   `route_hint` or `keywords` overridden locally (today only priority and actions are config).
3. The incubator kits moved onto `lib` (api, logs, notes, net, files, shell); the kits that moved to
   their own repositories next, each with `min_ask_kit` raised.
4. The routing joint: every installed kit's bench routed with the new kit present.
5. The composition joint: capabilities kits offer each other.
