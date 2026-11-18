# Write code with it

`ask` only reads. Use it to get your agent the context for a change before it writes code. The
agent's context gets the answers and none of what was read to find them. An agent that starts a
change with three asks usually needs fewer tries to get it right.

## Ask three questions before a change

```
ask how the existing exporters are structured, and which one is closest to a CSV exporter
ask where exporters are registered and which tests cover them
ask whether anyone tried adding a CSV export before, and what went wrong
```

1. **How the code does this already**, so the new code follows the existing style.
2. **Where it plugs in**, meaning registration, config and tests, so nothing gets missed.
3. **What was tried before**, so the agent doesn't repeat an approach that already failed.

Then the agent reads the files it is about to edit, and writes the change.

## Ask for it in the task

You can tell the agent up front:

```
Add a CSV exporter. Before writing anything, use ask to find how the other exporters
are built and registered, and whether a CSV export was tried before.
```

## Fix a bug

```
ask whether this error has come up in past sessions, and what fixed it
ask what changed in src/upload/ in the last week, and which session changed it
ask what calls retryUpload, and with what arguments
```

Past sessions often hold the fix already, or show the change that caused the bug.

## Review a change

```
ask why handleRefund checks the currency twice. Was that on purpose?
ask what else reads the order.status field that this change renames
```

The first finds the session where the code was written and the reason given. The second finds
every place the change could break.

## When to ask and when to read

- Ask before the agent starts reading files. Once it has read them, the context is already used.
- Let the agent read the exact files it will edit. An answer tells it where to look. The file
  shows what is really there.
- If an answer looks off, follow up (`follow up: show me the line`) before acting on it.
