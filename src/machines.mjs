// Other machines' evidence for reviews. `machines` in the config names ssh hosts; a sync copies each
// one's journals, action logs and review records, and the lookup chains its own ask-kit finds, to
// STATE_ROOT/machines/<host>/, laid out as a state folder is. Nothing is written on the other machine.
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { STATE_ROOT, loadConfig } from "./config.mjs";

const HOST = /^[A-Za-z0-9][\w.@-]*$/;
export const machinesDir = () => path.join(STATE_ROOT, "machines");
const dirOf = (host) => path.join(machinesDir(), host);

/** The machines the config names: [{host, command?}]. An entry is a host, or {host, command} when ask-kit runs as something else there. */
export function machinesOf(config = loadConfig({ required: false })) {
  const list = [].concat(config?.machines ?? []).map((m) => (typeof m === "string" ? { host: m } : m));
  for (const m of list) if (!HOST.test(m?.host ?? "")) throw new Error(`machines: ${JSON.stringify(m)} is not an ssh host name`);
  return list;
}

/** Where a file under the state folder belongs: {machine (null for this one), rel: its path parts in that machine's state folder}. */
export function placeOf(file) {
  const parts = path.relative(STATE_ROOT, file).split(path.sep);
  return parts[0] === "machines" ? { machine: parts[1], rel: parts.slice(2) } : { machine: null, rel: parts };
}

/** The state folders to read: this machine's and each copied one. */
export function stateRoots() {
  let hosts = [];
  try {
    hosts = fs.readdirSync(machinesDir()).filter((h) => HOST.test(h));
  } catch {}
  return [STATE_ROOT, ...hosts.map(dirOf)];
}

/** What other machines' scans found: {chains, asks, machines: [{host, at}]}; chains and asks carry their `machine`. */
export function machineEvidence() {
  const out = { chains: [], asks: [], machines: [] };
  for (const dir of stateRoots().slice(1)) {
    const host = path.basename(dir);
    try {
      const r = JSON.parse(fs.readFileSync(path.join(dir, "chains.json"), "utf8"));
      for (const k of ["chains", "asks"]) out[k].push(...(r[k] ?? []).map((x) => ({ ...x, machine: host })));
      out.machines.push({ host, at: r.at });
    } catch {}
  }
  return out;
}

const SSH = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=8"];
const ssh = (host, script, ms) =>
  new Promise((ok, no) => {
    const bin = process.env.ASK_KIT_SSH || "ssh";
    execFile(bin, [...SSH, host, script], { encoding: "buffer", maxBuffer: 256 << 20, timeout: ms }, (e, out, err) =>
      e ? no(new Error(String(err).trim().split("\n").filter((l) => !/Permanently added/.test(l)).at(-1)?.slice(0, 200) || e.message.split("\n")[0].slice(0, 200))) : ok(out),
    );
  });

const STATE = 'd="${ASK_KIT_STATE:-${XDG_STATE_HOME:-$HOME/.local/state}/ask-kit}"';
// A non-login ssh shell lacks the folders Node and npm's commands are usually in. Failing a command
// on PATH, the Claude Code plugin's own copy.
const RUN = `PATH="$HOME/.local/share/mise/shims:$HOME/.local/bin:$HOME/.npm-global/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"; export PATH
a=$(ls -td "$HOME"/.claude/plugins/cache/*/ask-kit/*/bin/ask-kit.mjs 2>/dev/null | head -1)
if [ -n "$a" ]; then set -- node "$a"; else set -- ask-kit; fi`;

/** Run an ask-kit command on a machine: its stdout. */
export const runThere = ({ host, command }, args, ms = 180_000) => ssh(host, `${command ? `set -- ${command}` : RUN}\n"$@" ${args}`, ms);

async function syncOne(machine, days) {
  const { host } = machine;
  const dir = dirOf(host);
  const out = { host, ok: true };
  try {
    const list = `find . -name '*.jsonl' -mtime -${days} ! -path './warm/*' \\( ! -path './nudges/*' -o -name nudges.jsonl \\) ! -path './machines/*' ! -path './drafts/*' ! -path './gallery/*'`;
    const tar = await ssh(host, `${STATE}; [ -d "$d" ] || exit 0; cd "$d" && ${list} > /tmp/.ask-kit-$$ && { [ -s /tmp/.ask-kit-$$ ] && tar czf - -T /tmp/.ask-kit-$$; rm -f /tmp/.ask-kit-$$; } ; true`, 180_000);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (tar.length) {
      await new Promise((ok, no) => {
        const p = execFile("tar", ["xzf", "-", "-C", dir], { timeout: 60_000 }, (e) => (e ? no(e) : ok()));
        p.stdin.on("error", () => {});
        p.stdin.end(tar);
      });
    }
    out.journalBytes = tar.length;
  } catch (e) {
    return { ...out, ok: false, journals: e.message };
  }
  try {
    const json = await runThere(machine, `gaps --chains --since ${days}d`);
    const { chains, asks = [] } = JSON.parse(String(json));
    if (!Array.isArray(chains)) throw new Error("no chains in its answer");
    fs.writeFileSync(path.join(dir, "chains.json"), JSON.stringify({ at: new Date().toISOString(), chains, asks }), { mode: 0o600 });
    out.chains = chains.length;
  } catch (e) {
    Object.assign(out, { ok: false, chainsError: /JSON|no chains/.test(e.message) ? "its ask-kit is older than 0.7.1" : e.message });
  }
  return out;
}

/** Copy every named machine's evidence. One that fails says why, and what an earlier sync copied is kept. */
export async function syncMachines({ days = 30, config } = {}) {
  return Promise.all(machinesOf(config).map((m) => syncOne(m, days)));
}
