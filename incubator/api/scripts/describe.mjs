export const meta = {
  purpose:
    "One operation in full: its method and path, each parameter with where it goes, its type, whether it is required and what it means, the shape of the request body, the shape of the successful answer, the other statuses it gives, and whether it changes things. Call it before calling an operation you have not used, and for 'what does this endpoint take or return'. It reads the document only.",
  params: { op: "the operation: its operationId (exact, else part of it), `METHOD /path`, or a path such as /guards/7", depth: "how many levels of nested objects to spell out in the shapes, default 3", spec: "another OpenAPI document (a URL or file path) to read instead of the configured one, optional" },
  returns: "{id, op, matched?, summary, description, tags, changes, runs, auth, parameters:[{name, in, required, type, default?, about?}], body?:{required, contentType, shape}, response:{status, about, contentType, shape}, otherResponses}; a shape is text written like a type, `?` marks an optional field; a document that cannot be read: {verdict, ok: false}",
  example: 'await scripts.run("describe", { op: "createIncident" })',
};

export default async function ({ api }, { op, depth, spec } = {}) {
  if (!op) throw new Error("describe needs `op`: an operationId or `METHOD /path`; the operations script finds one from words");
  const a = spec ? api.document(String(spec)) : api;
  const problem = await a.ready();
  if (problem) return { verdict: problem, ok: false };
  return a.describe(String(op), { depth });
}
