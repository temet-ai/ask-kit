export const meta = {
  purpose:
    "Call one operation and get a small result: the status, the time, and the data, cut to the fields named in `pick`. For 'what does the API say about X' once you know the operation. A list in the answer is counted and its first `max` items shown. GET operations and reading POSTs always run; an operation that changes things (POST, PUT, PATCH, DELETE) runs only when the caller asked for a change.",
  params: {
    op: "the operation: its operationId, `METHOD /path`, or a path such as /guards/vimes (a GET)",
    path: "values for the {placeholders} of the path, as an object, optional",
    query: "query parameters, as an object, optional",
    body: "the request body, as an object, optional",
    headers: "request headers the operation declares, as an object, optional (the credential is added for you: never pass it)",
    pick: "the fields to keep, as \"id,name,post.name\" or a list; from each item when the answer holds a list, optional",
    max: "items of a list to show, default 25",
  },
  returns: "{verdict, op, status, ok, ms, data} or, for a list, {verdict, op, status, ok, ms, count, shown, items, fields?, rest?, leftOut?}; plus redacted?, cut?, hint?, note?. No answer at all: {verdict, status: null, error, meaning}; a document that cannot be read: {verdict, ok: false}",
  example: 'await scripts.run("call", { op: "getGuard", path: { id: "vimes" }, pick: "name,rank,post.name" })',
};

const say = (data) => {
  if (!data || typeof data !== "object") return typeof data === "string" ? data.replace(/\s+/g, " ").slice(0, 140) : "";
  const m = data.message ?? data.detail ?? data.error_description ?? data.title ?? (typeof data.error === "string" ? data.error : data.error?.message);
  return typeof m === "string" ? m.replace(/\s+/g, " ").slice(0, 140) : "";
};

export default async function ({ api }, { op, path, query, body, headers, pick, max = 25 } = {}) {
  if (!op) throw new Error("call needs `op`: an operationId, `METHOD /path` or a path; the operations script finds one from words");
  const problem = await api.ready();
  if (problem) return { verdict: problem, ok: false };
  const ref = String(op).trim();
  const args = { ...(path ? { path } : {}), ...(query ? { query } : {}), ...(body !== undefined ? { body } : {}), ...(headers ? { headers } : {}) };
  let r;
  try {
    r = await api.call(ref, args);
  } catch (e) {
    // A path the document does not list can still be read with a GET.
    if (!/^(get\s+)?\//i.test(ref) || !/^no operation /.test(e.message)) throw e;
    r = await api.get(ref.replace(/^get\s+/i, ""), query ?? {});
  }
  const head = { op: r.op, ...(r.matched ? { matched: r.matched } : {}), status: r.status, ok: r.ok, ms: r.ms };
  if (r.status == null) return { verdict: `no answer from the API: ${r.error}${r.meaning ? ` (${r.meaning})` : ""}`, ...head, error: r.error, ...(r.meaning ? { meaning: r.meaning } : {}), hint: r.hint };
  const tail = { ...(r.redacted ? { redacted: r.redacted } : {}), ...(r.note ? { note: r.note } : {}), ...(r.hint ? { hint: r.hint } : {}) };
  const route = r.op.replace(/ \(.*$/, "");
  if (!r.ok) {
    const why = say(r.data);
    const kept = ["location", "retry-after", "www-authenticate"].filter((k) => r.headers?.[k]).map((k) => [k, r.headers[k]]);
    const s = api.small(r.data, 1500);
    return { verdict: `${route} answered ${r.status}${why ? `: ${why}` : ""}`, ...head, data: s.value, ...(kept.length ? { headers: Object.fromEntries(kept) } : {}), ...tail };
  }
  const n = Math.min(Math.max(Number(max) || 25, 1), 500);
  // One record is not a list, even when it has a list among its fields.
  const list = /\}$/.test(route) && !Array.isArray(r.data) ? null : api.items(r.data, true);
  // With pick, the note about redacted fields is kept only when one of them is among the fields shown.
  const scrubbed = (o) => (pick && !JSON.stringify(o.items ?? o.data ?? null).includes("<redacted>") ? (delete o.redacted, o) : o);
  if (list) {
    const count = list.items.length;
    const first = list.items.slice(0, n);
    const fields = first[0] && typeof first[0] === "object" && !Array.isArray(first[0]) ? Object.keys(first[0]) : null;
    const s = api.small(pick ? api.pick(first, pick) : first, pick ? 12_000 : 5000);
    const rest = list.key ? Object.fromEntries(Object.entries(r.data).filter(([k, v]) => k !== list.key.split(".")[0] && (v === null || typeof v !== "object") && String(v).length <= 200).slice(0, 12)) : {};
    return scrubbed({
      verdict: `${route} answered ${r.status} in ${r.ms} ms with ${count} item${count === 1 ? "" : "s"}${list.key ? ` in \`${list.key}\`` : ""}${count > n ? `; the first ${n} are shown` : ""}${r.morePages ? "; this is one page of a longer list, which the list script reads whole" : ""}`,
      ...head,
      count,
      shown: first.length,
      items: s.value,
      ...(!pick && fields ? { fields: fields.slice(0, 60).join(", ") } : {}),
      ...(Object.keys(rest).length ? { rest } : {}),
      ...(count > n ? { leftOut: `${count - n} more items: raise max, or use the list script for every page` } : {}),
      ...(s.cut ? { cut: `${s.cut}; name the fields you need in pick` } : {}),
      ...tail,
    });
  }
  const s = api.small(pick ? api.pick(r.data, pick) : r.data, 5000);
  const fields = !pick && s.cut && r.data && typeof r.data === "object" ? Object.keys(r.data) : null;
  return scrubbed({
    verdict: `${route} answered ${r.status} in ${r.ms} ms${r.data == null ? " with no body" : ""}${r.headers?.location ? `; Location: ${r.headers.location}` : ""}`,
    ...head,
    data: s.value,
    ...(fields ? { fields: fields.slice(0, 80).join(", ") } : {}),
    ...(s.cut ? { cut: `${s.cut}; name the fields you need in pick` } : {}),
    ...tail,
  });
}
