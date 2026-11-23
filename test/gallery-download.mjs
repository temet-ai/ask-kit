import assert from "node:assert/strict";
import { publicFile } from "../site/github.mjs";

const repo = "ankh-morpork/watch";
const originalToken = process.env.GITHUB_TOKEN;
process.env.GITHUB_TOKEN = "watch-fixture-token";
try {
  const text = await publicFile(repo, "main", "ask-kit.toml", {
    fetchImpl: async (url, options) => {
      assert.equal(url, "https://raw.githubusercontent.com/ankh-morpork/watch/main/ask-kit.toml");
      assert.equal(options.headers.authorization, undefined);
      return new Response('version = "0.3.1"');
    },
  });
  assert.equal(text, 'version = "0.3.1"');
} finally {
  if (originalToken === undefined) delete process.env.GITHUB_TOKEN;
  else process.env.GITHUB_TOKEN = originalToken;
}

assert.equal(await publicFile(repo, "main", "missing.md", { fetchImpl: async () => new Response(null, { status: 404 }) }), null);
for (const status of [429, 503]) {
  let calls = 0;
  const text = await publicFile(repo, "main", "ask-kit.toml", {
    fetchImpl: async () => ++calls < 3 ? new Response(null, { status }) : new Response("recovered manifest"),
    sleep: async () => {},
  });
  assert.equal(calls, 3);
  assert.equal(text, "recovered manifest");
}
for (const status of [401, 403, 500]) {
  await assert.rejects(publicFile(repo, "main", "ask-kit.toml", {
    fetchImpl: async () => new Response(null, { status }), sleep: async () => {},
  }), new RegExp(`HTTP ${status}`));
}
let calls = 0;
await assert.rejects(publicFile(repo, "main", "ask-kit.toml", {
  fetchImpl: async () => { calls++; throw new Error("network unavailable"); }, sleep: async () => {},
}), /download failed/);
assert.equal(calls, 3);
console.log("ok");
