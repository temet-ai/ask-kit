// General helpers every cell can use. They are REPL globals and are passed to scripts as `tk`.

export const clip = (v, max = 400) =>
  v == null ? null : typeof v === "string" && v.length > max ? v.slice(0, max) + `… [+${v.length - max} chars]` : v;

/** Keys, types and array lengths of a value, a few levels deep: the cheap way to see what came back. */
export function shape(x, depth = 3) {
  if (x === null || x === undefined) return x === null ? "null" : "undefined";
  if (Array.isArray(x)) return x.length ? [`array(${x.length})`, depth ? shape(x[0], depth - 1) : "…"] : "array(0)";
  if (typeof x === "object") {
    if (!depth) return "{…}";
    const out = {};
    for (const [k, v] of Object.entries(x)) out[k] = shape(v, depth - 1);
    return out;
  }
  return typeof x === "string" ? `string(${x.length})` : typeof x;
}

export const pick = (rows, ...keys) => {
  const one = (r) => Object.fromEntries(keys.map((k) => [k, r?.[k]]));
  return Array.isArray(rows) ? rows.map(one) : one(rows);
};

export const omit = (rows, ...keys) => {
  const one = (r) => Object.fromEntries(Object.entries(r ?? {}).filter(([k]) => !keys.includes(k)));
  return Array.isArray(rows) ? rows.map(one) : one(rows);
};

/** Compact text table. cols defaults to the first row's keys. */
export function table(rows, cols, { width = 60 } = {}) {
  if (!rows?.length) return "(no rows)";
  cols = cols ?? Object.keys(rows[0]);
  const cell = (v) => {
    const s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    return (s.length > width ? s.slice(0, width - 1) + "…" : s).replace(/\s+/g, " ");
  };
  const body = rows.map((r) => cols.map((c) => cell(r[c])));
  const w = cols.map((c, i) => Math.max(c.length, ...body.map((b) => b[i].length)));
  const line = (cells) => cells.map((s, i) => s.padEnd(w[i])).join(" | ").trimEnd();
  return [line(cols), w.map((n) => "-".repeat(n)).join("-|-"), ...body.map(line)].join("\n");
}

export const top = (rows, key, n = 10) =>
  [...rows].sort((a, b) => (typeof key === "function" ? key(b) - key(a) : (b[key] ?? 0) - (a[key] ?? 0))).slice(0, n);

export function groupBy(rows, key) {
  const out = {};
  for (const r of rows) (out[typeof key === "function" ? key(r) : r[key]] ??= []).push(r);
  return out;
}

export const countBy = (rows, key) =>
  Object.fromEntries(Object.entries(groupBy(rows, key)).map(([k, v]) => [k, v.length]).sort((a, b) => b[1] - a[1]));

export const sumBy = (rows, key) => rows.reduce((s, r) => s + (Number(typeof key === "function" ? key(r) : r[key]) || 0), 0);

/** ISO time `hours` ago. */
export const since = (hours) => new Date(Date.now() - hours * 3600_000).toISOString();

export const minutes = (ms) => Math.round((ms / 60000) * 10) / 10;

// A domain's own citation helper (`cite`) is a domain global, not part of the toolkit.
export const toolkit = { clip, shape, pick, omit, table, top, groupBy, countBy, sumBy, since, minutes };
