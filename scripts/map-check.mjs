#!/usr/bin/env node
// The code map against ripgrep, on any repository, with no model. For each name, every line that
// `rg -w <name>` finds in the files the map covers must be among the map's lines for that name;
// a missing one would make an "every caller" or "every use" list wrong. It also compares the map's
// definitions with what the code domain's ripgrep definition pattern (domains/code/lib.mjs) finds,
// and lists files ripgrep searches that the map has not read. Lines in files git tracks but
// ripgrep's ignore rules skip are counted apart: the map reads them and ripgrep does not.
//
//   node scripts/map-check.mjs <repository> [--names a,b,c] [--n 10] [--json]
//
// Without --names it takes the N (default 10) most used defined names of the map, spread over its
// languages, as an "every use of X" question would. The map is built in a scratch state folder,
// so the live ask-kit state is never written. Exits 1 when the map misses a line ripgrep finds.
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const argv = process.argv.slice(2);
const opt = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
};
const repoArg = argv.find((a, i) => !a.startsWith("--") && !argv[i - 1]?.startsWith("--"));
if (!repoArg) {
  console.error("usage: node scripts/map-check.mjs <repository> [--names a,b,c] [--n 10] [--json]");
  process.exit(2);
}
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "ask-kit-map-check-"));
process.env.ASK_KIT_STATE = scratch;
process.env.ASK_KIT_CONFIG ??= path.join(scratch, "config");
const { ensureMap, defsOf, usesOf, mapped, statusLine } = await import("../domains/code/map.mjs");
const { langOf, MAPPED_EXTS } = await import("../domains/code/scan.mjs");
const { NOISE, definitionPattern, noisy } = await import("../domains/code/lib.mjs");
const { gitTop } = await import("../domains/code/repo.mjs");
const { rgPath } = await import("../src/platform.mjs");

const rgJson = (args, cwd) =>
  new Promise((resolve, reject) =>
    execFile(rgPath(), ["--json", "--hidden", "-g", "!.git", ...NOISE.flatMap((g) => ["-g", g]), ...MAPPED_EXTS.flatMap((e) => ["-g", `*${e}`]), ...args, "--", "."], { cwd, maxBuffer: 1 << 30 }, (err, out) =>
      err && err.code !== 1 ? reject(err) : resolve(out.split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.type === "match").map((e) => ({ file: e.data.path.text.replace(/^\.\//, ""), line: e.data.line_number }))),
    ),
  );

try {
  const root = fs.realpathSync(gitTop(path.resolve(repoArg)) ?? path.resolve(repoArg));
  const t0 = Date.now();
  const map = await ensureMap(root);
  const buildMs = Date.now() - t0;
  const covered = new Set([...map.files].filter(([, e]) => !e.s).map(([f]) => f));

  let names = opt("names")?.split(",").map((s) => s.trim()).filter(Boolean);
  if (!names) {
    // The most used defined names, taken in turn from each language.
    const n = Number(opt("n") ?? 10);
    const byLang = new Map();
    const seen = new Set();
    for (const [file, e] of map.files) {
      for (const d of e.d ?? []) {
        if (seen.has(d[0]) || d[0].length < 4 || !mapped(d[0])) continue;
        seen.add(d[0]);
        const lines = usesOf(map, d[0]).length;
        const files = new Set(usesOf(map, d[0]).map((u) => u.file)).size;
        if (files < 2) continue;
        (byLang.get(langOf(file)) ?? byLang.set(langOf(file), []).get(langOf(file))).push({ name: d[0], lines });
      }
    }
    for (const list of byLang.values()) list.sort((a, b) => b.lines - a.lines);
    names = [];
    for (let k = 0; names.length < n && [...byLang.values()].some((l) => l.length > k); k++) for (const list of byLang.values()) if (list[k] && names.length < n) names.push(list[k].name);
  }

  // Files ripgrep would search, in the map's languages, that the map has not read.
  const listed = await new Promise((resolve) =>
    execFile(rgPath(), ["--files", "--hidden", "-g", "!.git", ...NOISE.flatMap((g) => ["-g", g]), "--", "."], { cwd: root, maxBuffer: 1 << 30 }, (err, out) => resolve(String(out ?? "").split("\n").filter(Boolean).map((f) => f.replace(/^\.\//, "")))),
  );
  const rgFiles = new Set(listed);
  const rows = [];
  for (const name of names) {
    if (!mapped(name)) {
      rows.push({ name, skipped: "not an identifier the map holds; it is answered by ripgrep" });
      continue;
    }
    const inMap = new Set(usesOf(map, name).map((u) => `${u.file}:${u.line}`));
    const found = (await rgJson(["-w", "-e", name], root)).filter((h) => covered.has(h.file)).map((h) => `${h.file}:${h.line}`);
    const rg = new Set(found);
    const missing = [...rg].filter((k) => !inMap.has(k));
    // Lines in files ripgrep's ignore rules skip although git tracks them are the map's alone, and expected.
    const extra = [...inMap].filter((k) => !rg.has(k) && rgFiles.has(k.split(":").slice(0, -1).join(":")));
    const ignored = [...inMap].filter((k) => !rg.has(k) && !rgFiles.has(k.split(":").slice(0, -1).join(":"))).length;
    const mapDefs = new Set(defsOf(map, name).map((d) => `${d.file}:${d.line}`));
    const patternDefs = new Set((await rgJson(["-e", definitionPattern([name])], root)).filter((h) => covered.has(h.file)).map((h) => `${h.file}:${h.line}`));
    rows.push({
      name,
      rgLines: rg.size,
      mapLines: inMap.size,
      missing,
      extra,
      inFilesRipgrepSkips: ignored,
      mapDefs: mapDefs.size,
      patternDefs: patternDefs.size,
      defsOnlyPattern: [...patternDefs].filter((k) => !mapDefs.has(k)),
      defsOnlyMap: [...mapDefs].filter((k) => !patternDefs.has(k)),
    });
  }

  const unread = listed.filter((f) => langOf(f) && !noisy(f) && !map.files.has(f));

  const report = { root, buildMs, map: statusLine({ ...map, ms: buildMs }), files: map.files.size, names: rows, filesNotRead: unread };
  if (argv.includes("--json")) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`${report.map}\n${root}: built in ${(buildMs / 1000).toFixed(1)} s\n`);
    console.log("name                          rg lines  map lines  missing  extra  rg-skipped  defs(map)  defs(pattern)  pattern-only defs");
    for (const r of rows) {
      if (r.skipped) {
        console.log(`${r.name.padEnd(30)}${r.skipped}`);
        continue;
      }
      console.log(`${r.name.padEnd(30)}${String(r.rgLines).padStart(8)}  ${String(r.mapLines).padStart(9)}  ${String(r.missing.length).padStart(7)}  ${String(r.extra.length).padStart(5)}  ${String(r.inFilesRipgrepSkips).padStart(10)}  ${String(r.mapDefs).padStart(9)}  ${String(r.patternDefs).padStart(13)}  ${r.defsOnlyPattern.slice(0, 3).join(", ")}`);
      for (const k of r.missing.slice(0, 10)) console.log(`    missing from the map: ${k}`);
      for (const k of r.extra.slice(0, 5)) console.log(`    in the map, not found by ripgrep: ${k}`);
    }
    if (unread.length) console.log(`\nFiles ripgrep searches that the map has not read: ${unread.length} (${unread.slice(0, 8).join(", ")}${unread.length > 8 ? ", ..." : ""})`);
    console.log(`\n${rows.some((r) => r.missing?.length) ? "FAIL: the map misses lines ripgrep finds" : "ok: every line ripgrep finds is in the map"}`);
  }
  process.exitCode = rows.some((r) => r.missing?.length) ? 1 : 0;
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
