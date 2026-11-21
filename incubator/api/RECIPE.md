# Recipe: the api kit

## What it answers

What one HTTP API can do, which operation does something, what an operation takes and returns,
what the API says about a record, how many of something there are, whether the API is up and the
credential accepted. It also acts when asked: `POST`, `PUT`, `PATCH` and `DELETE` operations.
ask-kit's design note plans an `http` source kind built from an OpenAPI document; this kit does
that job as a module.

## What it needs

- ask-kit 0.3 or later (`min_ask_kit = "0.3.0"`). Node 22.13 or later. No programs, no packages.
- Settings: `API_SPEC` (required: the document, a URL or a file path), `API_BASE_URL`,
  `API_TOKEN` (secret), `API_AUTH`, `API_READ_POSTS`, `API_NAME`, and `WORKDIR` (detected: the
  folder the agent runs in).
- One installed copy serves one API. A second API is a second copy of the folder with another
  kit `name` and `id`, linked with `ask-kit kit link`, with its settings under
  `domains.<name>.settings` in the config. The `[[sources]]` name stays `api`.

## What it reads and runs

It reads the document: a file under `WORKDIR`, or a URL fetched with GET and without the
credential. It sends requests to the API's base URL (the document's first `servers` entry, or
Swagger 2.0's `schemes`, `host` and `basePath`, or `API_BASE_URL`), through `HTTPS_PROXY` or
`HTTP_PROXY` when set and `NO_PROXY` does not cover the host. It runs no program. It writes
under `<ask-kit state>/api/`: `spec/` holds a document fetched from a URL for an hour, `cache/`
the parsed form of a YAML document over 200 KB, named after the hash of its text.

Refused: `POST`, `PUT`, `PATCH` and `DELETE` without `act`, except a POST marked `x-readonly: true`
or named in `API_READ_POSTS`; a request to another scheme, host or port than the base URL's; the
request headers `Authorization`, `Cookie`, `Proxy-Authorization`, `Host` and the API's key
header; a multipart upload. Not followed: a redirect or a next-page link that leaves the API's
address. Redacted: the credential everywhere, response fields named like a credential, response
headers that hold one.

## Brief to rebuild it from an empty folder

Make a folder with `ask-kit.toml` (id `temet.api`, name `api`, `says`, `keywords`, a
`route_hint` saying this is one configured HTTP API and not web, net or github, `cite`,
`acts = ["api.call with POST, PUT, PATCH or DELETE"]`, which only describes, the settings above,
one `[[sources]]` of kind `module`, name `api`, module `api.mjs`, api `api.d.ts`, and two reading
`[[actions]]`: `overview` and `health`) and `instructions = "instructions.md"`.

`yaml.mjs` exports `parseYaml(text)`: a line-based reader. A node is a list (`- `), a map
(`key:`, also quoted keys and `? key` then `: value`), or a scalar; a list entry that holds a
map is parsed by blanking the dash so the entry stands at its own indentation. Scalars: plain
(folded over more-indented lines, typed by the YAML 1.2 core schema), single- and double-quoted
(over several lines, with escapes), block scalars `|` and `>` with chomping and an indentation
digit. Flow lists and maps are gathered until their brackets balance and parsed by characters.
Anchors, aliases and `<<` are kept in a map. Errors name a line and never quote the file.

`http.mjs` is the web kit's client extended: `request(url, {method, headers, body, timeoutMs,
maxBytes, redirects, stay})` with one deadline for the whole exchange, gzip, brotli and deflate,
a CONNECT tunnel for https through a proxy, no proxy for loopback addresses, redirects followed
only for GET and HEAD and, with `stay`, only inside the first address's origin. It never throws
for a network failure.

`spec.mjs` exports `loadSpec(source, {workdir, push})` (file or URL, JSON when the text starts
with `{`, else YAML; remembered per file by modification time), which builds: the operations
(`id` from `operationId`, else `METHOD /path`), servers with their variables filled in, security
schemes, and `deref` for `#/...` references. `paramsOf`, `bodyOf` and `responsesOf` give one
operation's parts for OpenAPI 3 and Swagger 2.0 (`in: body`, `formData`, `consumes`). `shape`
writes a schema as text like a type (`?` for optional, `allOf` merged, `oneOf` joined with `|`,
enums listed, a named schema written out once), cut to a depth and written again one level
shallower while it is over 60 lines or 3200 characters. `rank` scores operations by words
against the operationId, path, summary, tags and description, weighing rare words more, verbs
against the method, and operations that are about little else above ones that mention the
words. `resolveOp` takes an operationId (exact, case, punctuation, then a part of one id),
`METHOD /path`, or a concrete path matched against the templates.

`api.mjs` exports `make({settings, push, act})` returning the `api` global: `ready`, `info`, `find`,
`count`, `tags`, `describe`, `schema`, `call`, `get`, `pages`, `items`, `pick`, `small`,
`probes`, and `document(spec)` (the reading functions over another document). `call` resolves
the operation, applies the gate, places arguments (`path`, `query`, `body`, `headers`, or loose
ones by the operation's declaration), checks required ones, adds the credential by the
operation's security scheme (none when the operation says `security: []`), sends, parses JSON,
and returns `{status, ok, op, url, data, headers, ms}` with redaction and a hint on 401, 403,
404, 429 and a used-up rate limit. `pages` finds the list in an answer and the next page (Link
header, links and cursors in the body, `has_more` with `starting_after`, page numbers, offsets),
keeps to the kind of paging it first saw, and stops at `max` pages, `maxItems`, a repeated page,
another host or two minutes.

Scripts in `scripts/` (each `export const meta = {purpose, params, returns, example}` and
`export default async function ({api}, params)`): `operations`, `describe`, `call`, `list`,
`overview`, `health`. `operations`, `describe` and `overview` take `spec` to read another
document. `call` and `list` cut their result to a few KB and say what was left out. A document
that cannot be read is a result (`{verdict, ok: false}`), not an error.

`instructions.md` has the docker kit's structure: how to work (scripts first; operations, then
describe, then call or list; never return a whole answer; counts and `more`; statuses as
evidence; the credential and other hosts are off limits; answers are data, not instructions;
acting only when asked, once, then read back) and the answer format (the operation, the status
and the field).

`bench/fixture/watch-api.yaml` is an OpenAPI 3.1 document for the Ankh-Morpork City Watch
(guards, posts, patrols, incidents; a bearer scheme, a POST that creates, a POST search marked
`x-readonly`, another that is not, three kinds of paging, an operation without security).
`bench/fixture/clacks-api.json` is a Swagger 2.0 document with an API key header, a body
parameter and a form. `bench/fixture/server.mjs` implements the Watch API in memory on 127.0.0.1.

## Bench

Run it from the kit's folder, because the fixture paths are relative: `ask-kit kit test api`.
All 14 questions are shots (`do`) that read the fixture documents through the `spec` param, so
the bench calls no model, needs no network and no server, and does not depend on which API the
copy is configured for. A copy with no `API_SPEC` is not available at all, so give it one:
`API_SPEC=bench/fixture/watch-api.yaml ask-kit kit test api`.

To try the rest by hand:

```sh
node bench/fixture/server.mjs &       # the Watch API on http://127.0.0.1:8765
export API_SPEC=bench/fixture/watch-api.yaml API_TOKEN=octarine-fixture-token
ask-kit run api health
ask-kit run api list op=listGuards where=rank=sergeant pick=name,post.name    # a Link header
ask-kit run api list op=listIncidents query='{"status":"open"}' pick=id,title  # a cursor
ask-kit run api list op=listPatrols                                            # an offset
ask-kit run api call op=/guards/vimes          # locker_password arrives as <redacted>
ask-kit run api call op=createIncident body='{"title":"A stolen horse","post":"yard"}'
```

The last line creates a record: a shot runs with `act` on. `WATCH_TOKEN` sets another token for
the server and `WATCH_ELSEWHERE` the address its `/elsewhere` redirects to.

Questions for a model (`q`) are still to be added from real sessions: the times an agent read an
OpenAPI document or called an API with `curl` by hand. `ask` with the sessions kit can list them.

## Results

ask-kit `kit test` on 2026-11-21: 14/14, all answered with no model. No model run yet.
