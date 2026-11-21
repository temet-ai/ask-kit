export const meta = {
  purpose:
    "Which operations of the API do something: give some words (\"refund a charge\", \"list guards by rank\") and get the operations that fit, best first, a line each; or a `tag` to list one group; or nothing to see the groups. The first call for 'can this API do X' and 'which endpoint does X'. It reads the document only and sends nothing to the API.",
  params: { words: "what the operation should do, in a few words; a path such as /guards also works; optional", tag: "only operations with this tag (exact, else part of it), optional", method: "only this method, such as GET, optional", max: "operations to show, default 15", spec: "another OpenAPI document (a URL or file path) to read instead of the configured one, optional" },
  returns: "{verdict, total, shown, operations:[{id, op: 'METHOD /path', does, changes?: true, deprecated?: true}], leftOut?} or, with nothing given, {verdict, total, tags:[{tag, operations, reads, changes, about?}]}; a document that cannot be read: {verdict, ok: false}",
  example: 'await scripts.run("operations", { words: "report an incident" })',
};

export default async function ({ api }, { words, tag, method, max = 15, spec } = {}) {
  const a = spec ? api.document(String(spec)) : api;
  const problem = await a.ready();
  if (problem) return { verdict: problem, ok: false };
  const n = Math.min(Math.max(Number(max) || 15, 1), 100);
  if (!words && !tag && !method) {
    const tags = await a.tags();
    const total = await a.count("");
    return { verdict: `${total} operations in ${tags.length} group${tags.length === 1 ? "" : "s"}; give words or a tag to list some`, total, tags: tags.slice(0, 80), ...(tags.length > 80 ? { leftOut: `${tags.length - 80} more tags` } : {}) };
  }
  // A tag is matched exactly first (letter case aside), then as a part of one tag's name.
  let group = null;
  let groupHow = "";
  if (tag) {
    const names = (await a.tags()).map((t) => t.tag);
    const want = String(tag).toLowerCase();
    group = names.find((t) => t.toLowerCase() === want) ?? null;
    if (!group) {
      const part = names.filter((t) => t.toLowerCase().includes(want));
      if (part.length !== 1) throw new Error(`${part.length ? `"${String(tag).slice(0, 60)}" is part of ${part.length} tags: ${part.slice(0, 20).join(", ")}` : `no tag "${String(tag).slice(0, 60)}"`}; have: ${names.slice(0, 50).join(", ")}${names.length > 50 ? `, +${names.length - 50} more` : ""}`);
      group = part[0];
      groupHow = ` (substring: "${String(tag).slice(0, 60)}" is part of it)`;
    }
  }
  const opts = { tag: group ?? undefined, method, max: n };
  const what = [words ? `"${String(words).slice(0, 80)}"` : "", group ? `the tag ${group}${groupHow}` : "", method ? String(method).toUpperCase() : ""].filter(Boolean).join(", ");
  const operations = await a.find(words, opts);
  if (!operations.length) {
    const tags = await a.tags();
    return { verdict: `no operation fits ${what}: try other words, or one of the tags`, total: 0, operations: [], tags: tags.slice(0, 60).map((t) => t.tag) };
  }
  // `total` counts the operations that hold every word; after those, find lists the ones that hold some.
  const total = await a.count(words, opts);
  const nearest = words ? `; the nearest is ${operations[0].op} (${operations[0].id})` : "";
  return {
    verdict: total ? `${total} operation${total === 1 ? " fits" : "s fit"} ${what}${total > operations.length ? `; the best ${operations.length} are shown` : ""}${nearest}` : `no operation holds all of ${what}; the ones shown hold some of the words${nearest}`,
    total,
    shown: operations.length,
    operations,
    ...(total > operations.length ? { leftOut: `${total - operations.length} more: raise max, or use more exact words` } : {}),
  };
}
