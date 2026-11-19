---
session_id:
  - 7d7a0c06-050f-48c6-b029-e29f994712c2
---

# Composing kits

How many kits, from many authors, work together so that each one added makes `ask` faster and
more often right. That includes the case where two sources answer the same question and one knows
more (mike and the built-in `sessions` reader). Written on 2026-11-19 from four research passes.
Their reports, with the scripts and raw numbers behind every figure here, are listed at the end.

## What the measurements say

**Time goes to model steps.** In mike-ask's real use over seven days (199 asks, 250 minutes,
$2.87), the model and its provider took 87% of the time. Cells and sources took 13%. 80 of the
199 asks (40%) hit the step or time limit or came back partial, and they took 56% of all the
time, mostly on deepseek. Its median was 113 s; glm's was 40 s, or 19 s without the asks that hit
the limit. ask-kit has only 17 asks of real use in the same week. The other 117 are kit tests,
too few to read much into.

**Routing is mostly right, and its misses are invisible.** Of the 33 real mike-ask asks the
router decided, 3 went to the wrong investigator (9%). In two of them the caller re-asked with
`about: "mike"` within 80 s. The third was a router timeout that fell back to ops. Nothing
records a re-ask like that as a misroute.

**Every kit costs every ask a little.** About 110 router tokens per kit on each routed ask, and
about 140 tokens in the calling agent's context in ask-kit, which lists the kits twice: in the
tool description and in the server instructions. The github kit costs 854 ms at every load,
because its `detect` runs `gh repo view`. Most kits load in 4 to 55 ms.

**No router chooses between mike and `sessions`.** ask-kit has no mike domain, and mike-ask
never offers `sessions`. Claude Code is given both rule files, so the calling agent chooses, and
`about: "sessions"` sent to mike-ask fails its schema check. Neither source covers the other:

| | mike | `sessions` |
|---|---|---|
| Agents | Claude Code | Claude Code, Codex (66 sessions here), Copilot CLI (151), opencode (3), Gemini CLI |
| Machines | four (omit, the Mac, infra, deus) | this one |
| History | from 2026-07-18 | Claude Code from 2026-09-22, as far as the files go |
| Extra | costs, request bodies, lessons, notes, threads, fleets; acts through mike's tools | none |

**The fast tier is nearly empty.** In mike-ask 47% of cells already run a library script, but
only about 1.5% of asks are answered with no model at all. Real use shows no repeating questions
yet in ask-kit, only benchmark reruns.

**A faster program pays in one place today.** ask-kit's `history.grep` takes 15 to 40 s a call.
It reads and lower-cases 5.9 GB of transcripts in one thread; `rg -l` over the same files takes
0.45 s. Nothing else measured would gain from one. ripgrep over code is already 40 ms, and CLI
waits (gh, docker) and mike's API latency aren't CPU.

## How other plugin systems settle the same problems

The prior-art pass looked at game mods (LOOT load orders, Factorio, Fabric and Forge, RimWorld),
WoW's Lua addons, lazy.nvim, VS Code, Debian and Arch packages, and Nix. Four of their
mechanisms fit kits:

- **Provides, with a priority and a user pin.** Debian's alternatives, Arch's virtual packages
  and Fabric's `provides`: several packages offer one capability, the highest-priority one that
  is installed wins, the user can pin another, and a tie is an error at install time.
- **A cheap index, with code loaded on a trigger.** VS Code reads every extension's manifest and
  activation events at startup and loads an extension only when one fires. lazy.nvim does the
  same with `event`, `cmd` and `ft`, and `:Lazy profile` shows what each plugin costs.
- **Optional dependencies, declared by the one that extends.** WoW's `OptionalDeps`, Arch's
  `optdepends` with a reason string.
- **A profile of each addition's cost.** lazy.nvim's startup profile and LOOT's reports.

One mechanism is a warning: patching another mod's code (mixins, Harmony prefixes, Emacs
advice) causes the worst conflicts in every one of these systems. A kit never edits another
kit's instructions or scripts.

## The design

### 1. Kits declare what they provide

```toml
# mike's kit
[[provides]]
capability = "session-history"
covers = ["claude-code"]        # which agents' sessions
reach = "all-machines"
priority = 100

# the built-in sessions reader
[[provides]]
capability = "session-history"
covers = ["claude-code", "codex", "copilot-cli", "opencode", "gemini-cli"]
reach = "this-machine"
priority = 10
```

The router resolves a capability before it routes. For each capability, the providers that can
run here (`requires`, `required` settings and `detect` pass) are ranked by priority for the
scope of the question: Claude Code history to mike when mike is there, a Codex session to
`sessions` because mike doesn't cover Codex, and everything to `sessions` on a machine without
mike.

- **Fallback, once.** When the winner says it has no data for the question (a session it
  doesn't hold), the next provider gets the same question. It happens once, and the journal
  records it.
- **Pin.** `domains.<kit>.priority` in the config overrides the manifest.
- **Tie.** Two providers with the same capability, overlapping `covers` and the same priority
  are an error in `doctor` and `kit install`, naming both kits.
- **Hidden losers.** The router prompt and the tool description list the capability once, under
  its winner. A kit that loses every capability it provides adds nothing to any ask.

mike-ask's hard-coded `COVERED_BY` (ops hides systemd, docs hides claude-code-docs) becomes
`provides` entries on those kits.

### 2. Adding a kit costs a bounded amount, measured

- **Index first.** At startup the router reads only `name`, `says`, `keywords`, `patterns` and
  `provides`. Sources, scripts and `detect` commands run the first time a kit is chosen. That
  removes github's 854 ms from every load.
- **The kit list appears once** in the calling agent's context, not twice.
- **A prompt prefix that caches.** The router prompt starts with what doesn't change (the rules,
  the capability list) and ends with the working directory. Today it starts with the working
  directory, so the provider can't reuse the prefix between projects.
- **A shortlist past about 15 kits.** Keywords and patterns pick the candidates, and only those
  go to the router model.
- **`kit profile`.** For each kit, from the journal: how often it was chosen, its time, cost and
  steps, its misroutes and fallbacks, and the tokens it adds to every routed ask.

### 3. Routing learns from its misses

- **A misroute is recorded.** A re-ask within two minutes with an explicit `about`, or a
  fallback, is journaled as a misroute of the first route. Each one becomes a router bench row
  with the right answer.
- **Fixes the research already found:**
  - Past-work words are checked before kit keywords, so "which session restarted the docker
    container" goes to session history, not to docker.
  - A router timeout falls back to session history, not to ops.
  - A pattern claims a question outright only when no past-work words are in it. Otherwise it
    is a strong hint to the router.
  - Kit hints name domains through the enabled set, as `route.mjs:99` does in mike-ask.
  - `psql` comes off docker's keywords.

### 4. One engine: mike becomes a kit pack on ask-kit

mike-ask came first, and ask-kit was forked from it on 2026-11-18. About 1,600 engine lines now
exist twice, and they have drifted apart in routing order, follow-ups, patterns and early
answers. The two are reconciled by putting mike on ask-kit, as the agreed direction already says
(lesson 2773):

- `ask-kit-mike` holds mike-ask's mike-specific parts: `mike.mjs` (the inspect API client) as a
  `module` source, mike's MCP tools through the `mcp` source, `corpus.mjs` and the 24 scripts. It
  declares `provides` for session history (Claude Code, all machines, priority 100), past work,
  lessons and fleets. Its bench is mike-ask's 15 questions.
- mike-ask then becomes ask-kit with that pack installed: its server, router and `ask` tool are
  ask-kit's. The freeze on mike-ask's engine ends here, because there is no second engine left.
- Claude Code gets one rule and one `ask`. `about: "sessions"` and `about: "mike"` both resolve
  through capabilities.

**Measure:** mike-ask's 15-question bench scores the same on glm and deepseek through ask-kit as
it does today.

### 5. Faster comes from fewer model steps first

Because the model takes 87% of the time:

- **Backend per domain from the journal.** The 40% of asks that hit the limit are mostly
  deepseek. The journal already holds each domain's time, steps and limit hits per backend from
  real use; move a domain to the backend that finishes there. No benchmark rounds: a benchmark
  runs once, only when Dawid asks for that run. Done on 2026-11-19 from 14 days of journal: mike
  moved to glm (median 40 s and 35% limit or failure over 101 asks, against deepseek's 115 s and
  50% over 92; $0.011 against $0.008 an ask). The kits stay on the default: they have under five
  real asks on glm each, too few to move them.
- **Scripts that answer in one cell** for the questions that recur, so a run takes two steps
  instead of 18.

### 6. Promotion: from cells to scripts to actions

| Tier | Today | To build |
|---|---|---|
| Cells the model writes | Journaled with their code and each script's params; `report` lists repeated cell shapes, and its "Worth an action" section clusters real questions (kit tests and benchmarks left out) by kit, question template and the library script their cells ran, ranked by count times cost, with the params seen | Clustering by the chain of cells, for questions no one script answers |
| Library script | Written by hand (tuner, ask-kit-improve) | `smith promote` drafts one from a cluster's cells |
| Proven | `kit test` with hand-written regexes | A shadow run: the real clustered questions, with the model's answer as the reference, comparing answer, time and cost |
| Action, no model | Shots via `do` and `ask-kit run`. `[[actions]]` (src/actions.mjs, 2026-11-19): `match` patterns that must match the whole question, named captures and `params` defaults fill the script's params, run through the shot path. An enabled action claims the route ahead of kit patterns and the router model; the kit's server tries it before its investigator. It falls through to the model on no match, an error, empty output or output failing `expect`. An action whose script is in `acts`, or with `acts = true`, is off until `domains.<kit>.actions.<name> = true` | Writing `[[actions]]` from a "Worth an action" cluster (`smith promote`) |
| Guarded | Every run journaled in `<state>/actions/<kit>.jsonl` (params, ms, why it fell through). Of the last 20 runs, more than 3 that fell through on an error or the shape, or whose caller asked again within 120 s, turn the action off in state; `report` shows "turned off: why", `kit actions <kit> --enable` turns it on with a fresh window. One answered run in 20 (`actions.shadowEvery`) also runs the model in the background; `report` shows both answers side by side | Judging shadow pairs, and proving an action again (a bench of its real questions) before it is turned back on |

**Scripts stay JavaScript.** The investigator writes and edits them in its REPL, so promotion
ends at a script or an action; it never produces native code. A native program comes in as a
source the script calls, the way `history.grep` should hand its scan to `rg`. A kit declares the
program as a `cli` source with `requires`, like `gh` or `docker`.

**When to look for a faster program.** Promotion's data flags a hot path: roughly 50 or more runs
a day, or more than 2 s of CPU in one run. The first question is whether a fast program already
exists (`rg`, `fd`, `jq`, `duckdb`, a service's own CLI) for the script to call. Only when none
does is one worth building, by someone, outside the script system, and the kit then calls it the
same way. Today the one hot path is ask-kit's transcript search: an `rg -l` prefilter in
`history.grep` takes a call from 15 to 40 s to under a second (30 to 80 times faster).
mike-ask's slow sources are mike's API (request count and latency tails), which batching
endpoints on mike's side fix.

### 7. Coverage is the measure of all of it

`ask-kit gaps` reads local transcripts (Claude Code, Codex, Copilot CLI) for runs of three or more
hand lookups that ended in an answer without `ask`. It classifies them with mike-ask's
`corpus.mjs` rules and attributes each to a kit by what it touched: `requires` programs, folder
paths, MCP server names. It reports two lists: kits that are installed but skipped (a routing or
rule problem), and sources with no kit (what to build next), each with the real questions that
started the digging. It is smith's first and third steps, run over files every user has. The
same numbers on mike's capture (fleet-mcp-integration, 2026-11-19: 1,221 chains in 565
sessions, $285 at list price) put code first (331 sessions) and mike's tools second (251).

Built on 2026-11-19 (src/gaps.mjs). Its first 30-day run on omit read 1,545 sessions in 34 s
(0.4 s on the next run, 1,528 of the sessions from its cache). It found 753 chains answered by
hand in 429 sessions. By lookup family: file 284 chains in 222 sessions, mike's tools 320 in
204, git 53 in 47, web 39 in 17. By kit, code came first (281 chains in 199 sessions), then
fleet (176 in 115) and mike (70 in 59 from typed questions, plus 119 that weren't; code's and
fleet's counts include theirs, 111 and 122). It reads less than mike's
capture: this machine only, and no subagent transcripts (those add 316 to-answer chains, 264 of
them file). It also counts a forked seat's copied history once; without that, the to-answer
chains (counting the 2 that ended in an ask) were 1,002 instead of 755. 174 asks against the
753 by-hand chains put coverage at 19% by count and 5% by tokens. 336 of the 753 started from
mail or a fleet brief.

## Order of work

| Step | Section | Measure |
|---|---|---|
| 1. Misroute journal and router fixes | 3 | Misroutes on real use, from 9%, and the router bench built from them |
| 2. `provides`, fallback and pins, with `sessions` declared | 1 | In the router bench, Claude Code session questions go to mike and Codex ones to `sessions` |
| 3. `ask-kit-mike`, and mike-ask on ask-kit's engine | 4 | mike-ask's bench scores the same; the duplicated engine lines are gone |
| 4. Backends per domain and one-cell scripts | 5 | Share of asks that hit the limit, from 40%, and the median time |
| 5. Lazy index, one kit list, cacheable prompt, `kit profile` | 2 | Tokens and milliseconds added per kit |
| 6. `ask-kit gaps` | 7 | Coverage: the share of digging, weighted by tokens, that went to `ask` |
| 7. The `rg` prefilter in `history.grep` (small, can go first) | 6 | Seconds per call |
| 8. Promotion to actions, once real use shows repeating questions | 6 | Share of asks answered with no model, on real use only |
| 9. A faster program for a script to call, when a hot path passes the cost-times-frequency line and an existing one fits | 6 | Time per run, before and after |

## Sources

The four research reports, written on 2026-11-19, are in this session's scratchpad
(`research/A-prior-art.md`, `B-composition.md`, `C-slow-paths.md`, `D-tiering.md`), with their
measurement scripts. The gaps numbers come from fleet-mcp-integration's lookup-chains run over
mike's capture, mailed the same day.
