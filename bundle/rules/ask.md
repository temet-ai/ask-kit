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
- A slow `ask` may come back as a background task instead of an answer. The investigator is still
  digging, and its answer is delivered to you when it is ready. While it digs, do the work
  that does not depend on its answer: read the files you are about to change, prepare what the
  answer will not alter, send your other asks. Don't wait for it, poll it or ask the same thing
  again, and start on an answer as soon as it arrives, without waiting for the others. End your
  turn only when every step left needs an answer that has not arrived; it will be delivered.
- With more than one question, send each with `wait: false`: they come back as tasks at once and
  run side by side. To follow up on a task's answer, pass its task id (it starts with `ask-`) as
  `continue`; `continue: true` means only your last ask.
- Leave `backend` at its default unless a question is hard and the default fell short.
- If an answer looks wrong, follow up and say what is missing before searching yourself.
- ask-kit's own guide, for changing what it uses or adding to it: {{AGENTS_MD}}
