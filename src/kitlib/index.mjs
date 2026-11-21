// The library ask-kit gives every kit: make({ lib }) in a module source. It holds the jobs kits kept
// writing for themselves (docs/design/mesh.md): redaction, credential paths, running programs with
// the act guard, HTTP through a proxy, refusals, a pool, walking folders, sizes and ages, and the
// kit's own folders. A kit that uses it sets min_ask_kit to the ask-kit version that has what it uses.
import { R, isCredName, redact, redactDeep } from "./redact.mjs";
import { age, isSecretPath, resolvePath, size, walk } from "./files.mjs";
import { makeRun, pool } from "./run.mjs";
import * as http from "./http.mjs";

export const LIB_VERSION = "0.4.0";

/** The sentence an acting call gives when the caller did not ask for a change. */
export const notInThisAsk = (what) =>
  `not in this ask: ${what} changes things, and the caller did not ask for a change (act: true), so nothing was done. ` +
  "Answer what you can, and say that this needs `ask` with act: true. Do not look for another way to do it.";

/** A refusal: throws "not allowed: <why>". Say in `why` what to use instead. */
export const deny = (why) => {
  throw new Error(`not allowed: ${why}`);
};

/**
 * The library for one kit. push journals calls; act is the caller's; held(argv) names the `acts`
 * phrase an argument list holds when act is off; callerDir is the folder the agent works in;
 * stateDir the kit's own data folder.
 */
export function makeLib({ push = () => {}, act = false, held = () => null, callerDir = process.cwd(), stateDir = null, kit = null } = {}) {
  const run = makeRun({ push, held: act ? () => null : held, notInThisAsk });
  return {
    version: LIB_VERSION,
    kit,
    act,
    callerDir,
    stateDir,
    R,
    redact,
    redactDeep,
    isCredName,
    isSecretPath,
    run,
    pool,
    walk,
    size,
    age,
    deny,
    notInThisAsk,
    /** A path from the caller: ~ is the home folder, relative is relative to the caller's folder. */
    path: (p) => resolvePath(p, callerDir),
    /** HTTP: request(url, {method, headers, body, timeoutMs, maxBytes, redirects, stay, publicOnly}); proxyFor(url); noProxy(host). Journaled. */
    http: {
      ...http,
      async request(url, o = {}) {
        const started = Date.now();
        const r = await http.request(url, { agent: `ask-kit-${kit ?? "kit"}`, ...o });
        let shown = String(url);
        try {
          const u = new URL(url);
          if (u.password) u.password = "redacted";
          shown = redact(u.href);
        } catch {}
        push({ kind: "http", detail: `${(o.method ?? "GET").toUpperCase()} ${shown}`.slice(0, 200), ms: Date.now() - started, code: r.ok ? 0 : r.status ?? 1, size: r.body?.length ?? 0 });
        return r;
      },
    },
  };
}
