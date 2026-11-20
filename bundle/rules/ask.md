# Asking instead of digging

If you have the `ask` tool (ask-kit), use it before a run of searches whose purpose is to answer a
question. `ask` takes one plain-language question, hands it to a cheap investigator that digs
outside your context, and returns a short answer with its evidence. You pay for one call and the
answer, not for the lookups.

Call `ask` first when the answer lies in:

- **past work**: what an earlier session discussed, decided, tried, built or failed at, why, and
  in which session; which sessions worked on something; what a session changed. It reads every
  coding agent's own transcripts on this machine (`about: "sessions"`).
- **this repository's code**: where something is defined or used, how it works, which setting,
  flag or env var controls it, what calls it, when a line changed (`about: "code"`).

Then read the files yourself when you are about to edit them.

- `ask` can also make a change in its domain (edit, run, restart, send). It does only when your
  request asks for one: open with what to do ("fix the typo in ...", "restart ...") or pass
  `act: true`. Anything else gets an investigator that only reads.

- `ask` is a conversation: `continue: true` sends a follow-up to the same investigator, which
  still holds what it found. Use it to dig into something the answer named or to finish an answer
  that stopped short; it is quicker and cheaper than a new question.
- Leave `backend` at its default unless a question is hard and the default fell short.
- If an answer looks wrong, follow up and say what is missing before searching yourself.
- ask-kit's own guide, for changing what it uses or adding to it: {{AGENTS_MD}}
