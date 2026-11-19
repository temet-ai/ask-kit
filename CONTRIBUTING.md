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
npm test                 # every test/*.mjs through test/run.mjs; no model, no network
node test/run.mjs router # only the test files whose names contain "router"
npm run test:machine     # reads this machine's real transcripts; not run in CI
node bin/ask-kit.mjs --help
```

A new test file under `test/` runs by being there: there is no list to add it to. CI runs
`npm test` on Linux, macOS and Windows with Node 22 and 24.

After changing a file in `bundle/` (skills, the tuner agent, the rule), run
`node bin/ask-kit.mjs plugin build` to refresh the Claude Code plugin's copies in `plugin/`;
`test/plugin.mjs` fails until you do. The kits page is `site/`: `node site/build-index.mjs`
writes `site/kits.json` from GitHub, and any static server in `site/` shows it. The `kits-site`
workflow rebuilds and deploys it on a push and every six hours. After changing a dependency,
regenerate the notices with `node scripts/notices.mjs > THIRD-PARTY-NOTICES.md`.

## Rules every change keeps

- Test data uses made-up names, never a real organisation, person, project or ticket. New test
  data takes its names from Terry Pratchett's Discworld (`Sam Vimes`, `ankh-morpork/watch`,
  `WATCH-12`). Hosts are `example.com` or `.invalid`.
- Real transcripts never enter the repository; write a synthetic fixture under `test/fixtures/`.
- The investigator acts in its domain, not only reads: a domain's globals carry the actions that
  domain needs. It never writes to another agent's transcript files.
- A change to what ask-kit stores or sends updates "What it stores and sends" in the README in
  the same commit.

## Pull requests

Keep a pull request to one change, with tests for it. Say in the description what it does for
someone using ask-kit and how you checked it.
