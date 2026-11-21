export const meta = {
  purpose:
    "What this API is and what it offers: its title and version, where requests go, how the credential is sent and whether one is set, how many operations read and how many change things, and the groups (tags) of operations with a few examples each. The first call for 'what is this API' and 'what can it do'. It reads the document only.",
  params: { spec: "another OpenAPI document (a URL or file path) to read instead of the configured one, optional" },
  returns: "{verdict, name?, title, version, document, about?, baseUrl, auth:{sentAs, from, credentialSet}, operations, reads, changes, tags:[{tag, operations, reads, changes, about?, examples?:[text]}], readingPosts?, remoteReferences?}; a document that cannot be read: {verdict, ok: false}",
  example: 'await scripts.run("overview")',
};

export default async function ({ api }, { spec } = {}) {
  const a = spec ? api.document(String(spec)) : api;
  const problem = await a.ready();
  if (problem) return { verdict: problem, ok: false };
  const info = await a.info();
  const tags = info.tags.filter((t) => t.operations);
  // A few operations of each group, while the whole stays small.
  const each = tags.length > 25 ? 0 : Math.max(2, Math.min(6, Math.floor(36 / Math.max(tags.length, 1))));
  if (each)
    for (const t of tags) {
      const ops = await a.find("", { tag: t.tag, max: each });
      t.examples = ops.map((o) => `${o.op} (${o.id})${o.changes ? " [changes things]" : ""}${o.does ? `: ${o.does.slice(0, 70)}` : ""}`);
      if (t.operations > ops.length) t.examples.push(`+${t.operations - ops.length} more`);
    }
  const cred = info.auth.credentialSet === undefined ? "" : info.auth.credentialSet ? `; the credential is set and sent as ${info.auth.sentAs}` : `; no credential is set (it would be sent as ${info.auth.sentAs})`;
  return {
    verdict: `${info.name ? `${info.name}: ` : ""}${info.title || "an API"}${info.version ? ` ${info.version}` : ""}, ${info.operations} operations in ${tags.length} group${tags.length === 1 ? "" : "s"} (${info.reads} read, ${info.changes} change things)${info.baseUrl ? `; requests go to ${info.baseUrl}` : ""}${cred}`,
    ...info,
    ...(each ? {} : { next: "the operations script lists one group (tag) or finds operations from words" }),
  };
}
