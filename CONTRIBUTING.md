# Contributing to ask-kit

The most useful contributions now are bug reports from real use, transcript formats that ask-kit
reads wrongly, and small fixes. For anything larger, open an issue first and say what you have in
mind, so we can agree on the shape before you spend time on it. A new domain usually belongs in
its own repository with the topic `ask-kit-domain` (see the README), not here.

## Licence

ask-kit is MIT licensed. By sending a pull request you agree that your contribution is licensed
under the MIT licence too. There is no contributor licence agreement to sign.

## Building and testing

Node.js 22.13 or newer and git. From the repository root:

```sh
npm ci
npm test                 # fixtures for every transcript format, setup, the REPL, the bundle
npm run test:machine     # reads this machine's real transcripts; not run in CI
node bin/ask-kit.mjs --help
```

CI runs `npm test` on Linux, macOS and Windows with Node 22 and 24. After changing a dependency,
regenerate the notices with `node scripts/notices.mjs > THIRD-PARTY-NOTICES.md`.

## Rules every change keeps

- Test data uses made-up names, never a real organisation, person, project or ticket. New test
  data takes its names from Terry Pratchett's Discworld (`Sam Vimes`, `ankh-morpork/watch`,
  `WATCH-12`). Hosts are `example.com` or `.invalid`.
- Real transcripts never enter the repository; write a synthetic fixture under `test/fixtures/`.
- The investigator only reads. A change that gives it a way to write, run a shell command or
  reach the network other than its model provider needs an issue first.
- A change to what ask-kit stores or sends updates "What it stores and sends" in the README in
  the same commit.

## Pull requests

Keep a pull request to one change, with tests for it. Say in the description what it does for
someone using ask-kit and how you checked it.
