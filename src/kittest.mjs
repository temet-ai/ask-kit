// `ask-kit kit test <name>`: a kit's bench (bench/questions.json) asked on each backend, scored
// against the patterns each answer must hold, with time and price. The questions are real ones,
// taken from what agents actually asked or dug for.
//
// bench/questions.json: {"questions": [{"id": "ci-why", "q": "why did CI fail on main?",
//   "expect": ["regex", ...], "any": ["regex", ...]?}]}. A question passes when every `expect`
// matches (any case) and, when `any` is given, at least one of it does. A question with `do`
// ("<script>", optional `params` object) runs as a shot, like `ask-kit run`: no model, and it counts
// in the summary's share answered with no model. Each result carries the cells the investigator ran,
// read from the ask's journal row.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ROOT, STATE_ROOT, loadConfig } from "./config.mjs";
import { loadDomain } from "./domains.mjs";

function askOnce(kit, backend, q, session, timeoutMs) {
  return new Promise((resolve) => {
    const args = [path.join(ROOT, "bin", "ask-kit.mjs"), "ask", "--domain", kit, ...(backend ? ["--backend", backend] : []), q];
    const p = spawn(process.execPath, args, { env: { ...process.env, ASK_KIT_SESSION: session, NO_COLOR: "1" }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    const t = setTimeout(() => p.kill("SIGTERM"), timeoutMs);
    p.on("close", (code) => {
      clearTimeout(t);
      resolve({ code, out, err: err.slice(-1500) });
    });
  });
}

// One shot from the shell: the kit's script with no model.
function runOnce(kit, script, params, session, timeoutMs) {
  const words = Object.entries(params ?? {}).map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`);
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(ROOT, "bin", "ask-kit.mjs"), "run", kit, script, ...words], { env: { ...process.env, ASK_KIT_SESSION: session, NO_COLOR: "1" }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    const t = setTimeout(() => p.kill("SIGTERM"), timeoutMs);
    p.on("close", (code) => {
      clearTimeout(t);
      resolve({ code, out, err: err.slice(-1500) });
    });
  });
}

// The ask rows a question left in the kit's journal: the cells run, and whether it was a shot.
function journalOf(kit, session) {
  let rows = [];
  try {
    rows = fs.readFileSync(path.join(STATE_ROOT, kit, `${session}.jsonl`), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.type === "ask");
  } catch {}
  return { cells: rows.length ? rows.reduce((s, r) => s + (r.cells ?? 0), 0) : null, shot: rows.length > 0 && rows.every((r) => r.shot) };
}

export async function kitTest(name, { backends, only, timeoutSeconds = 600, log = () => {} } = {}) {
  const d = await loadDomain(name);
  const file = d.bench;
  if (!file || !fs.existsSync(file)) throw new Error(`${name} has no bench (bench/questions.json in the kit)`);
  const qs = JSON.parse(fs.readFileSync(file, "utf8")).questions.filter((q) => !only || only.includes(q.id));
  const config = loadConfig();
  const list = backends?.length ? backends : [config.domains?.[name]?.backend ?? config.backends.default];
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const results = [];
  for (const be of list) {
    for (const q of qs) {
      const t0 = Date.now();
      const session = `kittest-${name}-${stamp}-${be}-${q.id}`;
      const r = q.do ? await runOnce(name, q.do, q.params, session, timeoutSeconds * 1000) : await askOnce(name, be, q.q, session, timeoutSeconds * 1000);
      const j = journalOf(name, session);
      const answer = r.out.trim();
      const footer = answer.match(/\[[a-z0-9-]+ · [^·\]]+ · (\d+)s(?: · \$([\d.]+))?\]\s*$/);
      const missing = (q.expect ?? []).filter((re) => !new RegExp(re, "i").test(answer));
      const anyOk = !q.any?.length || q.any.some((re) => new RegExp(re, "i").test(answer));
      const pass = r.code === 0 && !missing.length && anyOk;
      const row = { backend: be, id: q.id, pass, seconds: footer ? Number(footer[1]) : Math.round((Date.now() - t0) / 1000), costUsd: footer?.[2] ? Number(footer[2]) : null, cells: j.cells, noModel: !!q.do && j.shot, missing: [...missing, ...(anyOk ? [] : [`one of ${q.any.join(" | ")}`])], answer: answer.slice(0, 1500), ...(r.code ? { error: r.err } : {}) };
      results.push(row);
      log(`${pass ? "pass" : "FAIL"}  ${be}  ${q.id}  ${row.seconds}s${row.costUsd != null ? ` $${row.costUsd}` : ""}${row.noModel ? "  shot" : row.cells != null ? `  ${row.cells} cells` : ""}${pass ? "" : `  missing: ${row.missing.join(", ") || row.error?.slice(0, 200)}`}`);
    }
  }
  const cellsSorted = (rs) => rs.map((r) => r.cells).filter((c) => c != null).sort((a, b) => a - b);
  const summary = list.map((be) => {
    const rs = results.filter((r) => r.backend === be);
    const secs = rs.map((r) => r.seconds).sort((a, b) => a - b);
    return { backend: be, passed: rs.filter((r) => r.pass).length, of: rs.length, medianSeconds: secs[Math.floor(secs.length / 2)] ?? null, costUsd: Number(rs.reduce((s, r) => s + (r.costUsd ?? 0), 0).toFixed(4)), cells: rs.reduce((s, r) => s + (r.cells ?? 0), 0), medianCells: cellsSorted(rs)[Math.floor(rs.length / 2)] ?? null, noModel: rs.filter((r) => r.noModel).length };
  });
  return { kit: name, bench: file, at: new Date().toISOString(), summary, results };
}
