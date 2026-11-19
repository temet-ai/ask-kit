// A scripted OpenAI-compatible chat backend on 127.0.0.1 for ask-kit tests: no network, no model.
// Copy the parts you need into your own test file (test/<name>.mjs); tests do not import from .claude/.
//
//   const fake = await fakeBackend([
//     { code: "await scripts.run('greet', { name: 'Vimes' })" },   // a `repl` tool call
//     { answer: "Vimes was greeted (cell 1)." },                    // the final answer
//   ]);
//   config.backends = { default: "fake", list: { fake: fake.backend } };
//   ...
//   fake.requests  // every request body the loop sent (messages, tools), for assertions
//   fake.close()
//
// A step may also be { delayMs, ...step } to hold the reply (for timing tests) or a function
// (body) => step to answer from what the loop sent.
import http from "node:http";

export async function fakeBackend(steps) {
  const requests = [];
  let i = 0;
  const server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    const body = JSON.parse(raw || "{}");
    requests.push(body);
    let step = steps[Math.min(i++, steps.length - 1)];
    if (typeof step === "function") step = step(body);
    if (step.delayMs) await new Promise((r) => setTimeout(r, step.delayMs));
    const message = step.code
      ? { role: "assistant", content: null, tool_calls: [{ id: `call-${i}`, type: "function", function: { name: "repl", arguments: JSON.stringify({ code: step.code }) } }] }
      : { role: "assistant", content: step.answer ?? "" };
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ choices: [{ message, finish_reason: step.code ? "tool_calls" : "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0 } }));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}/v1`;
  return {
    url,
    requests,
    // `noKey` because a local server needs none; preset "custom" has no baseUrl of its own.
    backend: { kind: "api", preset: "custom", baseUrl: url, model: "fake", noKey: true },
    close: () => new Promise((r) => server.close(r)),
  };
}
