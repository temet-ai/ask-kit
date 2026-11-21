export const meta = {
  purpose:
    "Read a collection through its pages: 'list all guards', 'how many open incidents are there', 'which patrols are at night'. It follows the paging the API uses (a Link header, a next link or cursor in the answer, page numbers, offsets), says which, keeps the fields named in `pick`, applies `where` filters here, and counts. Prefer the API's own query parameters to `where` when it has them: they filter before the pages are read.",
  params: {
    op: "the listing operation: its operationId, `METHOD /path`, or a path such as /guards",
    path: "values for the {placeholders} of the path, as an object, optional",
    query: "query parameters, as an object (the API's own filters and page size), optional",
    pick: "the fields to keep from each item, as \"id,name,post.name\" or a list, optional",
    where: "equality filters applied here after reading, as an object {\"rank\": \"sergeant\"} or \"rank=sergeant, post.name!=Cable Street\"; letter case is ignored; optional",
    max: "items to show, default 50",
    pages: "pages to read at most, default 5 (up to 50)",
  },
  returns: "{verdict, op, status, pagination, pages, read, matching?, shown, total?, more, items, fields?, leftOut?, cut?, redacted?, stopped?}; a first request that fails: {verdict, status, ok: false, data, hint?}; a document that cannot be read: {verdict, ok: false}",
  example: 'await scripts.run("list", { op: "listGuards", where: { rank: "sergeant" }, pick: "name,post.name" })',
};

const filters = (where) => {
  if (!where) return [];
  if (typeof where === "object") return Object.entries(where).map(([field, value]) => ({ field, not: false, value }));
  return String(where)
    .split(/,(?=[^,]*=)/)
    .map((part) => /^\s*([^=!]+?)\s*(!=|=)\s*(.*?)\s*$/.exec(part))
    .filter(Boolean)
    .map((m) => ({ field: m[1], not: m[2] === "!=", value: m[3] }));
};
const same = (a, b) => String(a ?? "").toLowerCase() === String(b ?? "").toLowerCase();

export default async function ({ api }, { op, path, query, pick, where, max = 50, pages = 5 } = {}) {
  if (!op) throw new Error("list needs `op`: a listing operation's operationId or a path such as /guards; the operations script finds one from words");
  const problem = await api.ready();
  if (problem) return { verdict: problem, ok: false };
  const r = await api.pages(String(op).trim(), { ...(path ? { path } : {}), ...(query ? { query } : {}) }, { max: pages });
  const route = String(r.op ?? op).replace(/ \(.*$/, "");
  if (r.status == null) return { verdict: `no answer from the API: ${r.error}${r.meaning ? ` (${r.meaning})` : ""}`, op: r.op, status: null, ok: false, error: r.error, hint: r.hint };
  if (!r.ok) return { verdict: `${route} answered ${r.status}`, op: r.op, status: r.status, ok: false, data: api.small(r.data, 1500).value, ...(r.hint ? { hint: r.hint } : {}) };
  if (r.pages === 1 && r.count === 0 && r.pagination === "the answer holds no list") return { verdict: `${route} answered ${r.status}, and the answer holds no list: read it with the call script`, op: r.op, status: r.status, ok: true, data: api.small(r.data, 3000).value };
  const fs = filters(where);
  const kept = fs.length
    ? r.items.filter((item) =>
        fs.every((f) => {
          const v = api.pick(item, [f.field])?.[f.field];
          const hit = Array.isArray(v) ? v.some((x) => same(x, f.value)) : same(v, f.value);
          return f.not ? !hit : hit;
        }),
      )
    : r.items;
  const n = Math.min(Math.max(Number(max) || 50, 1), 1000);
  const first = kept.slice(0, n);
  const fields = first[0] && typeof first[0] === "object" && !Array.isArray(first[0]) ? Object.keys(first[0]) : null;
  const s = api.small(pick ? api.pick(first, pick) : first, pick ? 14_000 : 6000);
  const redacted = r.redacted && (!pick || JSON.stringify(s.value).includes("<redacted>")) ? r.redacted : null;
  const filtered = fs.length ? ` ${kept.length} fit ${fs.map((f) => `${f.field}${f.not ? "!=" : "="}${f.value}`).join(", ")}` : "";
  return {
    verdict: `${route}: ${r.count} item${r.count === 1 ? "" : "s"} read over ${r.pages} page${r.pages === 1 ? "" : "s"}${fs.length ? `;${filtered}` : ""}${r.more ? `; there are more pages${r.total != null ? ` (the API says ${r.total} in all)` : ""}, so the count is not the whole collection` : "; that is the whole collection"}`,
    op: r.op,
    status: r.status,
    pagination: r.pagination,
    pages: r.pages,
    read: r.count,
    ...(fs.length ? { matching: kept.length } : {}),
    shown: first.length,
    ...(r.total != null ? { total: r.total } : {}),
    more: r.more,
    items: s.value,
    ...(!pick && fields ? { fields: fields.slice(0, 60).join(", ") } : {}),
    ...(kept.length > n ? { leftOut: `${kept.length - n} more items: raise max, or keep fewer with where` } : {}),
    ...(r.more ? { toReadOn: "raise pages, or narrow the list with the API's own query parameters" } : {}),
    ...(s.cut ? { cut: `${s.cut}; name the fields you need in pick` } : {}),
    ...(redacted ? { redacted } : {}),
    ...(r.stopped ? { stopped: r.stopped } : {}),
  };
}
