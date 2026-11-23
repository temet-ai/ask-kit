// A scripted OpenAI-compatible chat backend on 127.0.0.1 for tests: no network, no model.
// Steps are replayed in order: { code } is a `repl` tool call, { tool, args } a call of another
// tool (early_answer), { answer } the final reply, { status, error } a refusal; { delayMs } holds the reply; a function
// (body) => step answers from what the loop sent. Every request body is kept in `requests`.
import http from "node:http";

export async function fakeBackend(steps) {
  const requests = [];
  const at = [];
  let i = 0;
  const server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    const body = JSON.parse(raw || "{}");
    requests.push(body);
    at.push(Date.now());
    let step = steps[Math.min(i++, steps.length - 1)];
    if (typeof step === "function") step = step(body);
    if (step.delayMs) await new Promise((r) => setTimeout(r, step.delayMs));
    // { status, error }: the provider refuses the request, as OpenRouter does past a key's limit.
    if (step.status) {
      res.statusCode = step.status;
      res.setHeader("content-type", "application/json");
      return res.end(JSON.stringify({ error: step.error ?? { message: "refused", code: step.status } }));
    }
    const call = step.code != null ? { name: "repl", args: { code: step.code } } : step.tool ? { name: step.tool, args: step.args ?? {} } : null;
    const message = call
      ? { role: "assistant", content: null, tool_calls: [{ id: `call-${i}`, type: "function", function: { name: call.name, arguments: JSON.stringify(call.args) } }] }
      : { role: "assistant", content: step.answer ?? "" };
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ choices: [{ message, finish_reason: call ? "tool_calls" : "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0 } }));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}/v1`;
  return {
    url,
    requests,
    at,
    backend: { kind: "api", preset: "custom", baseUrl: url, model: "fake", noKey: true },
    close: () => new Promise((r) => server.close(r)),
  };
}
