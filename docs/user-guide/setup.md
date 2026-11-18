# Set it up

Paste this into Claude Code, Codex, Copilot CLI, Gemini CLI or opencode, on Linux, macOS or
Windows:

```
Read https://github.com/temet-ai/ask-kit/blob/main/AGENTS.md, then set up ask-kit for me.
```

The agent then:

1. **Checks** that you have Node.js 22.13 or newer and git. It offers to install anything that's
   missing, and installs it only if you say yes.
2. **Installs** ask-kit and runs `ask-kit init`. That adds the `ask` tool, a rule for when to
   use it, and three skills to every coding agent on the machine. It writes no file that you've
   already edited.
3. **Asks you**, one question at a time, with a suggested answer:
   - whose past sessions to read (it shows how many each agent has),
   - which agents get `ask`,
   - which model does the digging ([Choose the model](models.md)),
   - whether `ask` answers about sessions, code or both.

   If you choose an API and it can't find the key, it asks where the key is. It shows what it
   will change, and changes it only if you say yes.
4. **Checks** everything with `ask-kit doctor`, asks one question from the shell and shows you
   the answer.

Then restart your agents so they load `ask`, and [use it](asking.md).

## Change it later

Start any agent with a line like these:

```
Read ~/.config/ask-kit/AGENTS.md, then switch ask's default model to codex.
Read ~/.config/ask-kit/AGENTS.md, then answer code questions with deepseek.
Read ~/.config/ask-kit/AGENTS.md, then add this domain: github.com/<owner>/<repo>
```

`ask-kit lines` lists them all. `init` wrote that file, and it has this machine's paths in it.

## Set it up without an agent

```sh
npm install -g --allow-git=root github:temet-ai/ask-kit
ask-kit init
ask-kit setup     # the same questions, in the terminal
```

If npm can't install packages globally, clone the repository, run `npm install` in it, and run
`node <folder>/bin/ask-kit.mjs` wherever this guide says `ask-kit`.

[Command line and files](command-line.md) lists where each agent's files go.
