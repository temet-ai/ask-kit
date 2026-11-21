export const meta = {
  purpose:
    "Whether the API is reachable and whether the credential is accepted: it sends the cheapest GET operations that need no parameters (one that takes no credential when the document has one, then one that does) and reports each status and time. For 'is the API up', 'does my token work', and as the first check when calls fail.",
  params: { op: "a GET operation to try instead of the ones chosen, optional" },
  returns: "{verdict, baseUrl, credential: 'set, sent as bearer' | 'not set', checks:[{op, takesCredential, status, ms, error?, says?}]}; a document that cannot be read: {verdict, ok: false, checks: []}",
  example: 'await scripts.run("health")',
};

const say = (data) => {
  const m = data && typeof data === "object" ? (data.message ?? data.detail ?? data.title ?? (typeof data.error === "string" ? data.error : data.error?.message)) : null;
  return typeof m === "string" ? m.replace(/\s+/g, " ").slice(0, 120) : undefined;
};

export default async function ({ api }, { op } = {}) {
  let info;
  let probes;
  try {
    info = await api.info();
    probes = await api.probes();
  } catch (e) {
    return { verdict: `cannot check: ${e.message}`, ok: false, checks: [] };
  }
  const credential = info.auth.credentialSet ? `set, sent as ${info.auth.sentAs}` : "not set";
  const out = { baseUrl: info.baseUrl ?? null, credential, checks: [] };
  if (info.baseUrlProblem) return { verdict: `cannot check: ${info.baseUrlProblem}`, ...out };
  const plan = op ? [{ id: String(op), takesCredential: null, sizeParam: null }] : [probes.open[0], probes.guarded[0]].filter(Boolean);
  const run = async (p) => {
    let r;
    try {
      r = p.path ? await api.get(p.path) : await api.call(p.id, p.sizeParam ? { query: { [p.sizeParam]: 1 } } : {});
    } catch (e) {
      return { op: p.id, error: e.message };
    }
    return { op: r.op, ...(p.takesCredential == null ? {} : { takesCredential: p.takesCredential }), status: r.status, ms: r.ms, ...(r.status == null ? { error: `${r.error}${r.meaning ? ` (${r.meaning})` : ""}` } : {}), ...(r.status >= 400 && say(r.data) ? { says: say(r.data) } : {}), ...(r.note ? { note: r.note } : {}) };
  };
  if (!plan.length) {
    const c = await run({ id: "GET /", path: "/" });
    out.checks.push(c);
    return { verdict: c.status == null ? `not reachable: ${c.error}` : `reachable (GET / answered ${c.status} in ${c.ms} ms); the document has no GET without required parameters, so the credential was not tried`, ...out };
  }
  for (const p of plan) {
    const c = await run(p);
    out.checks.push(c);
    if (c.status == null) break; // nothing answers: a second request would only wait again
  }
  const dead = out.checks.find((c) => c.status == null);
  if (dead) return { verdict: dead.error && !/^not in this ask|^no operation|needs /.test(dead.error) ? `not reachable at ${out.baseUrl}: ${dead.error}` : `cannot check with ${dead.op}: ${dead.error}`, ...out };
  const last = out.checks[out.checks.length - 1];
  const route = String(last.op).replace(/ \(.*$/, "");
  const guarded = last.takesCredential !== false;
  let verdict;
  if (last.status === 401 || last.status === 403) verdict = info.auth.credentialSet ? `reachable, but the credential is not accepted: ${route} answered ${last.status}` : `reachable, but no credential is set and ${route} needs one (${last.status}): set API_TOKEN`;
  else if (last.status >= 500) verdict = `reachable, but failing: ${route} answered ${last.status}`;
  else if (last.status === 404) verdict = `reachable, but ${route} answered 404: check API_BASE_URL (${out.baseUrl})`;
  else if (last.status >= 400) verdict = `reachable; ${route} answered ${last.status}, which says nothing about the credential`;
  else if (!guarded) verdict = `reachable (${route} answered ${last.status} in ${last.ms} ms); the credential was not tried: the document has no GET without required parameters that takes one`;
  else if (info.auth.credentialSet) verdict = `reachable, and the credential is accepted (${route} answered ${last.status} in ${last.ms} ms)`;
  else verdict = `reachable (${route} answered ${last.status} in ${last.ms} ms) with no credential set`;
  return { verdict, ...out };
}
