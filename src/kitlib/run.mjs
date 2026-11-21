// Running programs for kits: no shell (each argument separate), a timeout, an output cap, never
// throwing for a failing program, every call journaled, and the kit's `acts` held back when the
// caller did not ask for a change. From the kits' own copies (ask-kit kit commons, 2026-11-21): nine
// kits had near-identical `exec` wrappers (docker, github, ops, postgres, procs, repos, systemd,
// deps, tests); this is theirs, with the host's act guard, which none of them had.
import { execFile } from "node:child_process";

/**
 * run(bin, args, o) -> {code, out, err, timedOut?, ms}. o.timeoutMs (default 120000), o.cwd, o.env
 * (added to the environment), o.input (written to stdin), o.maxBuffer (default 64 MB).
 * code 127 when the program is not installed, with err saying so.
 */
export function makeRun({ push = () => {}, held = () => null, notInThisAsk }) {
  return function run(bin, args = [], o = {}) {
    const argv = [].concat(args).map(String);
    const phrase = held([bin, ...argv]);
    if (phrase) return Promise.reject(new Error(notInThisAsk(`${bin}: ${phrase}`)));
    const started = Date.now();
    return new Promise((resolve) => {
      const child = execFile(bin, argv, { cwd: o.cwd, env: { ...process.env, NO_COLOR: "1", PAGER: "cat", ...(o.env ?? {}) }, timeout: o.timeoutMs ?? 120_000, maxBuffer: o.maxBuffer ?? 64 << 20, encoding: "utf8", windowsHide: true }, (err, stdout, stderr) => {
        const r =
          err?.code === "ENOENT"
            ? { code: 127, out: "", err: `${bin} is not installed or not on PATH` }
            : { code: err ? (typeof err.code === "number" ? err.code : 1) : 0, out: stdout ?? "", err: stderr ?? "", ...(err?.killed ? { timedOut: true } : {}) };
        r.ms = Date.now() - started;
        push({ kind: "run", detail: `${bin} ${argv.join(" ")}`.slice(0, 200), ms: r.ms, code: r.code, size: r.out.length });
        resolve(r);
      });
      if (o.input != null) child.stdin?.end(String(o.input));
    });
  };
}

/** Run `fn` over items, at most `n` at a time, keeping their order. From deps, repos and mike's pools. */
export async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, worker));
  return out;
}
