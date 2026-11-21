# ask-kit-api

An [ask-kit](https://github.com/temet-ai/ask-kit) kit that lets your coding agent's `ask` tool
use one HTTP API through its OpenAPI (Swagger) document: an internal service, a SaaS product,
your project's own backend on localhost. No MCP server and no SDK. A cheap model finds the
operation, reads what it takes, calls it and answers with the fields that matter, outside your
agent's context. Your agent gets three lines instead of a spec of thousands of lines and whole
JSON responses.

It does the job an agent otherwise does by reading the spec and chaining `curl` calls:

- Can this API export invoices, and which endpoint does it?
- What does `POST /incidents` need in its body, and what does it return?
- How many open incidents are there, and who is assigned to WATCH-12?
- Is the staging API up, and is my token still accepted?
- Create an incident "A stolen horse" at the Yard. (Only when you ask for a change.)

## Install

You need [ask-kit](https://github.com/temet-ai/ask-kit#set-it-up) 0.3 or later. The kit has no
dependencies.

Paste this into your agent:

```
Read ~/.config/ask-kit/AGENTS.md, then add this kit: github.com/temet-ai/ask-kit-api
```

Or run it yourself:

```sh
ask-kit kit install temet-ai/ask-kit-api        # shows what it reads, changes and runs
ask-kit kit install temet-ai/ask-kit-api --yes  # installs and enables it
```

One installed copy serves one API. Give it the API in the environment or under
`domains.api.settings` in `~/.config/ask-kit/config.json`:

| Setting | What it is |
|---|---|
| `API_SPEC` | The API's OpenAPI or Swagger document: a URL or a file path, JSON or YAML. Required: until it is set, `ask-kit kit list` shows the kit as not available and says why. |
| `API_BASE_URL` | Where to send requests, when it differs from the document's `servers` (a local or staging copy). |
| `API_TOKEN` | The credential. It is sent the way the document's security scheme says. |
| `API_AUTH` | How to send the token when the document is wrong or silent: `bearer`, `basic` (the token is `user:password`), `header:<Name>` or `query:<name>`. Without it and without a scheme in the document: bearer. |
| `API_READ_POSTS` | POST operations that only read (a search, a query endpoint), as operationIds or path patterns such as `/search/*`, comma-separated. They then run without a request for a change. |
| `API_NAME` | What this API is, in a few words. Used in answers. |
| `WORKDIR` | The folder a relative `API_SPEC` path starts at. Detected: the folder your agent runs in. |

```json
{ "domains": { "api": { "settings": {
  "API_SPEC": "https://billing.example.com/openapi.json",
  "API_TOKEN": "...",
  "API_NAME": "the billing service"
} } } }
```

Restart your agents so `ask` lists `api`. `ask-kit run api health` says whether the API answers
and the credential is accepted.

**Two APIs.** Copy the kit's folder, change the kit's `name` (the second line of `ask-kit.toml`)
and its `id`, and write the API's own words into `says`, so the router can tell the copies
apart. Leave `name = "api"` under `[[sources]]` as it is: that is the global the scripts use.
Then `ask-kit kit link <the copy>` and give each copy its settings under
`domains.<name>.settings`. An environment variable applies to every copy, so with two copies use
the config.

## What it reads

- The document: OpenAPI 3.0 and 3.1 and Swagger 2.0, JSON or YAML. YAML is read by the kit's own
  reader (`yaml.mjs`), which covers block and flow maps and lists, quoted and plain scalars,
  block scalars, anchors, aliases and merge keys. `$ref` is followed inside the document; a
  reference to another file or address is reported and not fetched. A document from a URL is
  fetched without the credential and kept for an hour; a large YAML document's parsed form is
  kept under ask-kit's state folder (`api/cache/`), named after the hash of its text.
- The API, with requests to its own address only: 30 seconds for a request (120 at most), 16 MB
  for an answer. `HTTPS_PROXY`, `HTTP_PROXY` and `NO_PROXY` are honoured, and addresses on this
  machine never go through a proxy.
- Lists through their pages, whichever way the API pages: a `Link` header with `rel="next"`, a
  next link or a cursor in the answer, `page` with `per_page`, or `offset` with `limit`. It says
  which it used, stops after 5 pages unless told otherwise (50 at most), and says when pages
  were left unread.

## What it can change

`GET`, `HEAD` and `OPTIONS` operations always run. `POST`, `PUT`, `PATCH` and `DELETE` run only
when the caller asked for a change (`act`); otherwise the call is refused with `not in this ask`.
Many APIs read with a POST: an operation the document marks `x-readonly: true`, or one named in
`API_READ_POSTS`, runs without `act`. The module is the gate: the host cannot tell a reading call
from a changing one by its name. `ask-kit run api call ...` from a shell is you asking, so it
may change things.

What the investigator reads goes to a model, and what an API answers is text nobody vouched for.
So `api.mjs` keeps these rules:

- The credential is added to each request by the module and is never returned: not in a result,
  an error, `describe` or `info`, and not in the journal. Request headers are not echoed, and a
  caller cannot set `Authorization`, `Cookie` or the API's key header.
- Requests go only to the API's own address (scheme, host and port). A call to another address
  is refused, a redirect that leaves the API is not followed, and a next-page link to another
  host ends the paging. An answer's text therefore cannot send the credential elsewhere.
- In an answer, fields named like a credential (`password`, `secret`, `token`, `api_key`,
  `private_key`, `access_key`, `credential`) are replaced with `<redacted>` at any depth and in
  any letter case, and the result says which. Paging tokens and token counts are left alone.
  The response headers `set-cookie`, `authorization` and any whose name holds token, key or
  secret are redacted too, and the configured credential is replaced wherever an answer echoes it.
- A document given to a script through its `spec` param is only read. Nothing is sent to its
  servers.

## How well it works

`bench/questions.json` holds 14 checks that run with no model against two saved documents,
`bench/fixture/watch-api.yaml` (OpenAPI 3.1, YAML) and `bench/fixture/clacks-api.json` (Swagger
2.0, JSON). `ask-kit kit test api` on 2026-11-21, run from the kit's folder: 14/14, all answered
with no model. The bench cannot start a server, so `call`, `list` and `health`, paging, the act
gate, the redaction and the refusal of other hosts were proved by hand against
`bench/fixture/server.mjs` on 127.0.0.1, and reads were tried against api.github.com through a
proxy. The YAML reader was compared with the JSON twins of Stripe's and GitHub's published API
descriptions (6.6 MB and 11 MB, 0.3 and 0.6 seconds to read): Stripe's is equal, GitHub's
differs in one value, which its YAML writes as a number and its JSON as a string.

No model run has been made yet: the bench has no questions from real sessions, so there is no
score for an investigator model.

## What is in it

`api.mjs` is the `api` global (find, describe, call, get, pages, info, and the rules above),
`spec.mjs` loads a document and turns it into operations, shapes and a ranking by words,
`yaml.mjs` is the YAML reader and `http.mjs` the HTTP client (methods, bodies, timeout, size cap,
proxy tunnel). Its scripts are `operations` (which operations do something), `describe` (one
operation in full), `call` (one request, with the fields to keep), `list` (a collection through
its pages, with filters and a count), `overview` (what the API is and offers) and `health`
(reachable, credential accepted). [RECIPE.md](RECIPE.md) says what it reads and runs, and how to
rebuild it.

MIT licence.
