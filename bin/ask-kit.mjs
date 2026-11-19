#!/usr/bin/env node
// ask-kit: one plain-language `ask` tool for coding agents.
//
//   ask-kit init [--force]       put ask-kit's skills, agent and rule into every agent found, write its guide
//   ask-kit setup                set up in the terminal: questions from what this machine has
//   ask-kit detect [--json]      what this machine has (agents, transcripts, CLIs, keys, local models)
//   ask-kit questions            the setup questions and suggested answers, as JSON (for an agent)
//   ask-kit apply <file|-> [--dry-run]   apply answers (JSON) from an agent or a file
//   ask-kit doctor               check the config: sources, backends, tools
//   ask-kit ask "<question>" [--domain d] [--backend b] [--continue]   ask from the shell
//   ask-kit run <kit> <script> [key=value ...]   run a kit script with no model (a shot)
//   ask-kit report [--since 7d]  how ask is doing: flagged asks, scripts used, routes worth a script
//   ask-kit gaps [--since 30d] [--json]   digging agents did by hand instead of ask, by kit
//   ask-kit mine <kit> [--since 30d] [--n 20] [--json]   that digging's questions as draft bench rows
//   ask-kit smith scaffold <source> [--name n] · prove <name> · install <name> · promote <kit>   kits from that digging
//   ask-kit gallery              shared kits (GitHub topics ask-kit, ask-kit-domain)
//   ask-kit kit new|link|list|test|profile|actions|install|enable|disable   kits: ask-kit.toml folders
//   ask-kit add <repo> [--yes]   show a shared domain's files; with --yes, install and enable it
//   ask-kit lines                the one-line prompts to paste into any agent
//   ask-kit uninstall [--dry-run]   remove registrations and what init installed (not your edits)
//   ask-kit serve [--domain d]   the MCP server agents start (all domains behind one router)
//   ask-kit plugin build|start   write the Claude Code plugin's skill copies; its SessionStart hook
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : true;
};
const positional = argv.slice(1).filter((a, i, all) => !a.startsWith("--") && !(all[i - 1]?.startsWith("--") && !["--json", "--dry-run", "--continue", "--yes"].includes(all[i - 1])));

async function main() {
  switch (cmd) {
    case "serve": {
      (await import("../src/agentsmd.mjs")).writeAgentsMd();
      const domain = flag("domain");
      if (domain) {
        process.env.ASK_KIT_DOMAIN = domain;
        await import("../src/server.mjs");
      } else {
        const { serveRouter } = await import("../src/router.mjs");
        await serveRouter();
      }
      return;
    }
    case "detect": {
      const { detect } = await import("../src/setup/detect.mjs");
      const d = await detect();
      if (flag("json")) return print(d);
      return printDetect(d);
    }
    case "questions": {
      const { detect } = await import("../src/setup/detect.mjs");
      const { questions } = await import("../src/setup/questions.mjs");
      const d = await detect();
      return print({ found: summary(d), ...questions(d), existing: d.existing?.config ?? null, answerFormat: "ask-kit apply <file> takes {sources, clients, investigator, extras, domains, keys}" });
    }
    case "apply": {
      const src = positional[0];
      if (!src) throw new Error("apply needs a JSON file of answers, or - for stdin");
      const answers = JSON.parse(src === "-" ? fs.readFileSync(0, "utf8") : fs.readFileSync(src, "utf8"));
      const { detect } = await import("../src/setup/detect.mjs");
      const { apply } = await import("../src/setup/apply.mjs");
      const r = apply(answers, await detect({ counts: false }), { dry: !!flag("dry-run") });
      return print({ dryRun: !!flag("dry-run"), config: r.config, changes: r.changes.map((c) => c.what), applied: r.applied });
    }
    case "setup":
      return wizard();
    case "init":
      return init();
    case "plugin":
      return plugin(positional[0]);
    case "doctor":
      return doctor();
    case "ask":
      return askFromShell();
    case "run":
      return runShotFromShell();
    case "report": {
      const { report } = await import("../src/report.mjs");
      const r = report({ since: typeof flag("since") === "string" ? flag("since") : "7d" });
      if (flag("json")) return print(r);
      console.log(`Since ${r.since}: ${r.asks} asks, ${r.flagged} flagged, ${r.shots} shots, ${r.actionAnswers} answered by actions (${Math.round((r.noModelShare ?? 0) * 100)}% with no model; ${r.realNoModelShare == null ? "-" : `${Math.round(r.realNoModelShare * 100)}%`} on real use), $${r.costUsd}, median ${r.medianSeconds ?? "-"} s`);
      for (const a of r.flaggedAsks) console.log(`\n${a.ts}  ${a.domain} · ${a.backend} · ${Math.round(a.ms / 1000)}s  ${a.signals.join("; ")}\n  ${a.question}\n  ${a.journal}`);
      if (r.scripts.length) console.log(`\nScripts: ${r.scripts.map((s) => `${s.name} ${s.runs}${s.failed ? ` (${s.failed} failed)` : ""}`).join(", ")}`);
      if (r.worthAScript.length) console.log(`\nWritten by hand 3+ times (worth a script):\n${r.worthAScript.map((w) => `  ${w.n}×  ${w.shape}`).join("\n")}`);
      if (r.routed || r.misroutes.length) {
        console.log(`\nMisroutes: ${r.misroutes.length} of ${r.routed} routed by the router (router bench rows: ${(await import("../src/router.mjs")).benchFile()})`);
        for (const m of r.misroutes) console.log(`  ${m.at}  ${m.routed} (by ${m.how}) → ${m.correct}, ${m.why}\n    ${m.question}`);
      }
      if (r.actions.length) {
        console.log("\nActions:");
        for (const a of r.actions) console.log(`  ${a.kit}.${a.action}: ${a.runs} runs, ${a.answered} answered${Object.keys(a.fellThrough).length ? `, fell through: ${Object.entries(a.fellThrough).map(([k, n]) => `${n} ${k}`).join(", ")}` : ""}${a.reasked ? `, ${a.reasked} asked again` : ""}${a.off ? `\n    turned off: ${a.off}` : ""}`);
      }
      if (r.shadows.length) {
        console.log("\nShadow runs (the action's answer, then the model's):");
        for (const s of r.shadows) console.log(`  ${s.at}  ${s.kit}.${s.action}  ${s.question}\n    action: ${s.actionAnswer.replace(/\s+/g, " ").slice(0, 300)}\n    model (${s.backend}${s.ms != null ? `, ${Math.round(s.ms / 1000)}s` : ""}${s.costUsd != null ? `, $${s.costUsd}` : ""}): ${(s.modelAnswer ?? `failed: ${s.error}`).replace(/\s+/g, " ").slice(0, 300)}`);
      }
      if (r.worthAnAction.length) {
        console.log("\nWorth an action (real questions asked again whose cells ran the same script; ranked by count × cost):");
        for (const w of r.worthAnAction) console.log(`  ${w.n}× in ${w.sessions} session(s)  ${w.kit} · ${w.script}  $${w.costUsd}, median ${w.medianSeconds ?? "-"} s\n    "${w.template}"\n    e.g. ${w.questions[0]}${w.params.length ? `\n    params seen: ${w.params.join("  ")}` : ""}`);
      }
      return;
    }
    case "gaps": {
      const { gaps, formatReport } = await import("../src/gaps.mjs");
      const r = await gaps({ since: typeof flag("since") === "string" ? flag("since") : "30d" });
      return flag("json") ? print(r) : console.log(formatReport(r));
    }
    case "mine": {
      if (!positional[0]) throw new Error("mine needs a kit or source name, as `ask-kit gaps` lists them (code, github, mike, ...)");
      const { mine, writeDrafts, formatMine } = await import("../src/mine.mjs");
      const n = Number(flag("n"));
      const r = await mine({ kit: positional[0], since: typeof flag("since") === "string" ? flag("since") : "30d", n: n > 0 ? n : 20 });
      if (flag("json")) return print(r);
      const file = writeDrafts(r);
      console.log(formatMine(r));
      console.log(`\nDrafts: ${file}\nCheck each answer in the source as it is now, fill expect, then copy the row into the kit's bench/questions.json.`);
      return;
    }
    case "smith": {
      const smith = await import("../src/smith.mjs");
      const [sub, ...rest] = positional;
      const arg = rest.join(" ");
      if (sub === "scaffold") {
        if (!arg) throw new Error("smith scaffold needs a source, as `ask-kit gaps` lists it under No kit (e.g. \"mcp: flux\", gitlab)");
        const r = await smith.scaffold(arg, { name: typeof flag("name") === "string" ? flag("name") : undefined, since: typeof flag("since") === "string" ? flag("since") : "30d" });
        if (flag("json")) return print(r);
        console.log(`Drafted ${r.name} (${r.kind}) in ${r.dir}: ${r.questions} mined questions${r.allow.length ? `, ${r.allow.length} tools that read` : ""}${r.leftOut.length ? `; left out because they change something: ${r.leftOut.join(", ")}` : ""}${r.settings.length ? `; settings read from the agent's config: ${r.settings.join(", ")}` : ""}.\nNext: ask-kit smith prove ${r.name}`);
        return;
      }
      if (sub === "prove") {
        if (!arg) throw new Error("smith prove needs a draft's name");
        const r = await smith.prove(arg, { backends: typeof flag("backends") === "string" ? flag("backends").split(",") : undefined, log: (l) => console.error(l) });
        if (flag("json")) return print(r);
        console.log(`${r.name}: ${r.passed}/${r.of}.${r.changed.length ? ` Reference out of date (the source changed since it was asked; check and fix the row): ${r.changed.join(", ")}.` : ""}${r.failed.length ? ` Wrong: ${r.failed.join(", ")}; the instructions were rewritten from them (${r.tuned}), see ${r.dir}/instructions.md.` : ""}\nNext: ask-kit smith install ${r.name}; its real use is the next measure (ask-kit report).`);
        return;
      }
      if (sub === "install") {
        if (!arg) throw new Error("smith install needs a draft's name");
        const r = smith.install(arg);
        (await import("../src/agentsmd.mjs")).writeAgentsMd();
        return print(r);
      }
      if (sub === "promote") {
        if (!arg) throw new Error("smith promote needs a kit's name");
        const r = await smith.promote(arg, { since: typeof flag("since") === "string" ? flag("since") : "30d" });
        if (flag("json")) return print(r);
        for (const s of r.skipped) console.error(`skipped ${s.script} ("${s.template}"): ${s.why}`);
        if (!r.entries.length) return console.log(`${arg}: nothing to promote yet (ask-kit report lists what is worth an action).`);
        console.log(`${r.toml}\n\n# ${r.entries.length} action${r.entries.length === 1 ? "" : "s"} for ${r.dir}/ask-kit.toml. Add them there, then: ask-kit kit actions ${arg}`);
        return;
      }
      throw new Error("smith: scaffold <source> [--name n] [--since 30d] · prove <name> [--backends a,b] · install <name> · promote <kit> [--since 30d]");
    }
    case "gallery": {
      const { listGallery } = await import("../src/gallery.mjs");
      const list = await listGallery();
      if (flag("json")) return print(list);
      if (!list.length) return console.log("No shared kits yet (GitHub topic ask-kit). Share one: the ask-kit-domain skill.");
      for (const g of list) console.log(`${g.repo.padEnd(40)} ★${g.stars}  ${g.updated}  ${g.description}`);
      console.log('\nAdd one: ask your agent "Read ~/.config/ask-kit/AGENTS.md, then add this kit: github.com/<owner>/<repo>"');
      return;
    }
    case "kit":
      return kitCommand();
    case "add": {
      if (!positional[0]) throw new Error("add needs a repository (owner/repo or a GitHub URL) or a folder");
      const { addDomain } = await import("../src/gallery.mjs");
      return print(await addDomain(positional[0], { yes: !!flag("yes") }));
    }
    case "lines": {
      const { AGENTS_MD } = await import("../src/agentsmd.mjs");
      console.log(`Paste one into any coding agent:\n
  Read ${AGENTS_MD}, then set up ask-kit for me.
  Read ${AGENTS_MD}, then switch ask's default model to <name>.
  Read ${AGENTS_MD}, then add this kit: github.com/<owner>/<repo>
  Read ${AGENTS_MD}, then make a kit for <a tool, folder or service> and prove it on real questions from my sessions.
  Read ${AGENTS_MD}, then write a RECIPE.md for my <name> kit the way the ask-kit-domain skill describes, push it to a public GitHub repo and add the topic ask-kit.

On a machine without ask-kit yet:
  Read https://github.com/temet-ai/ask-kit/blob/main/AGENTS.md, then set up ask-kit for me.`);
      return;
    }
    case "uninstall":
      return uninstall();
    default:
      console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 12).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
      if (cmd && cmd !== "help" && cmd !== "--help") process.exitCode = 1;
  }
}

const print = (x) => console.log(JSON.stringify(x, null, 2));

function summary(d) {
  return {
    agents: Object.fromEntries(Object.entries(d.agents).map(([n, a]) => [n, { installed: a.onPath, sessions: a.sessions, transcripts: a.transcripts }])),
    subscriptionClis: Object.fromEntries(Object.entries(d.clis).filter(([, c]) => c.available).map(([n, c]) => [n, { signedIn: c.signedIn, status: c.status }])),
    apiKeysFound: Object.entries(d.apis).filter(([, a]) => a.keyFound).map(([n]) => n),
    localModelServers: Object.fromEntries(Object.entries(d.local).filter(([, l]) => l.running).map(([n, l]) => [n, l.models])),
  };
}

function printDetect(d) {
  console.log("Coding agents");
  for (const a of Object.values(d.agents)) console.log(`  ${a.onPath ? "✓" : "·"} ${a.label.padEnd(20)} ${a.onPath ? a.version ?? "" : "not installed"}${a.transcripts ? `  · ${a.sessions ?? "?"} sessions in ${a.transcripts}` : ""}`);
  console.log("Subscriptions that can run the investigator");
  for (const c of Object.values(d.clis)) console.log(`  ${c.available ? (c.signedIn === false ? "!" : "✓") : "·"} ${c.label}${c.available && c.status ? `  · ${c.status}` : ""}`);
  console.log("API keys (found by name; values never shown)");
  for (const a of Object.values(d.apis)) console.log(`  ${a.keyFound ? "✓" : "·"} ${a.label}${a.keyFound ? `  · ${a.keyRefs.map((r) => r.env ? `$${r.env}` : r.file).join(", ")}` : ""}`);
  console.log("Local model servers");
  for (const l of Object.values(d.local)) console.log(`  ${l.running ? "✓" : "·"} ${l.label}${l.running ? `  · ${l.models.slice(0, 5).join(", ")}` : ""}`);
  console.log(`Tools\n  ${d.tools.nodeOk ? "✓" : "!"} Node ${d.tools.node} (${d.tools.platform})  ${d.tools.ripgrep ? "✓" : "!"} ripgrep  ${d.tools.git ? "✓" : "·"} git`);
  if (d.existing) console.log(`\nAlready set up: ${d.existing.file}`);
}

// ---- terminal wizard: the same questions an agent asks ----

async function wizard() {
  const { detect } = await import("../src/setup/detect.mjs");
  const { questions, keyQuestion } = await import("../src/setup/questions.mjs");
  const { apply } = await import("../src/setup/apply.mjs");
  const { API_PRESETS } = await import("../src/providers.mjs");
  console.log("Looking at what this machine has…\n");
  const d = await detect();
  printDetect(d);
  const { questions: qs } = questions(d);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answers = { keys: {} };
  try {
    for (const q of qs) {
      if (!q.options.length) {
        answers[q.id] = q.type === "multi" ? [] : null;
        continue;
      }
      console.log(`\n${q.question}\n  ${q.why}`);
      q.options.forEach((o, i) => console.log(`  ${String(i + 1).padStart(2)}. ${o.label}${o.note ? `\n      ${o.note}` : ""}${[].concat(q.suggested).includes(o.value) ? "   ← suggested" : ""}`));
      const hint = q.type === "multi" ? "numbers separated by spaces, Enter for the suggested, 0 for none" : "a number, Enter for the suggested";
      const raw = (await rl.question(`  (${hint}) > `)).trim();
      if (!raw) answers[q.id] = q.suggested;
      else if (raw === "0" && q.type === "multi") answers[q.id] = [];
      else {
        const picked = raw.split(/[\s,]+/).map((n) => q.options[Number(n) - 1]?.value).filter(Boolean);
        answers[q.id] = q.type === "multi" ? picked : picked[0] ?? q.suggested;
      }
    }
    for (const id of [answers.investigator, ...(answers.extras ?? [])].filter(Boolean)) {
      const preset = id.split(":")[0];
      if (!API_PRESETS[preset] || API_PRESETS[preset].local || d.apis[preset]?.keyFound || answers.keys[preset]) continue;
      const kq = keyQuestion(preset);
      console.log(`\n${kq.question}\n  ${kq.why}`);
      const v = (await rl.question("  > ")).trim();
      answers.keys[preset] = /^[A-Z][A-Z0-9_]*$/.test(v) ? { env: v } : { value: v };
    }
    const dry = apply(answers, d, { dry: true });
    console.log("\nThis will:");
    for (const c of dry.changes) console.log(`  - ${c.what}`);
    console.log(`  default model: ${dry.config.backends.default}; also: ${Object.keys(dry.config.backends.list).filter((n) => n !== dry.config.backends.default).join(", ") || "none"}`);
    if (!/^y/i.test((await rl.question("\nGo ahead? (y/N) > ")).trim())) return console.log("Nothing changed.");
  } finally {
    rl.close();
  }
  const r = apply(answers, d);
  for (const a of r.applied) console.log(`${a.ok ? "✓" : "✗"} ${a.what}${a.ok ? "" : `: ${a.error}`}`);
  console.log("\nDone. Restart your agents so they load `ask`, then try: ask-kit doctor");
}

// ---- init: everything an agent needs to run the setup conversation, in every agent found ----

async function init() {
  const { installBundle, TARGETS } = await import("../src/setup/bundle.mjs");
  const { writeAgentsMd } = await import("../src/agentsmd.mjs");
  const { detect } = await import("../src/setup/detect.mjs");
  const guide = writeAgentsMd();
  const d = await detect({ counts: false });
  // Agents that run here: a leftover folder or a broken version-manager shim is not an agent.
  const present = Object.keys(TARGETS).filter((a) => d.agents[a]?.onPath);
  const rows = installBundle(present, { force: !!flag("force") });
  const by = {};
  for (const r of rows) (by[r.agent] ??= []).push(r);
  for (const [agent, list] of Object.entries(by)) {
    if (list[0].action === "skip-no-agent") continue;
    if (list[0].action === "skip-plugin") {
      console.log(`· ${TARGETS[agent].label}: the ask-kit plugin is installed and brings the skills, agent and rule`);
      continue;
    }
    const kept = list.filter((r) => r.action.startsWith("skip-"));
    console.log(`✓ ${TARGETS[agent].label}${TARGETS[agent].verified === false ? " (format from its docs, not yet checked on a real install)" : ""}: ${list.length - kept.length} file(s)`);
    for (const k of kept) console.log(`    left alone (${k.action === "skip-edited" ? "you edited it" : "not ask-kit's"}): ${k.path}  — --force replaces it`);
  }
  const none = Object.keys(TARGETS).filter((a) => !present.includes(a) || by[a]?.[0]?.action === "skip-no-agent");
  if (none.length) console.log(`  not found here: ${none.map((a) => TARGETS[a].label).join(", ")}`);
  if (!d.tools.nodeOk) console.log(`! Node ${d.tools.node}: ask-kit needs 22.13 or newer (opencode transcripts use node:sqlite).`);
  if (!d.tools.ripgrep) console.log("! ripgrep not found and the bundled copy is missing: run npm install in ask-kit, or install rg. The code domain needs it.");
  if (!d.tools.git) console.log("· git not found: the code domain answers without history, and `ask-kit add` cannot fetch shared domains.");
  console.log(`\nGuide for agents: ${guide}\n\nNext, paste this into any of your agents:\n\n  Read ${guide}, then set up ask-kit for me.\n\nor run: ask-kit setup`);
}

// ---- plugin: the Claude Code plugin (.claude-plugin/ at the repository root) ----

async function plugin(sub) {
  const { pluginFiles, render, TARGETS } = await import("../src/setup/bundle.mjs");
  if (sub === "build") {
    // The plugin's copies of the bundle, written into plugin/; test/plugin.mjs fails when they are stale.
    for (const f of pluginFiles()) {
      fs.mkdirSync(path.join(ROOT, path.dirname(f.path)), { recursive: true });
      fs.writeFileSync(path.join(ROOT, f.path), f.content);
      console.log(`wrote ${f.path}`);
    }
    return;
  }
  if (sub === "start") {
    // The plugin's SessionStart hook: what it prints becomes context for the session.
    const { writeAgentsMd } = await import("../src/agentsmd.mjs");
    const { loadConfig } = await import("../src/config.mjs");
    writeAgentsMd();
    // `ask-kit init` from before the plugin already put the rule in ~/.claude/rules.
    if (!fs.existsSync(path.join(TARGETS["claude-code"].base(), "rules", "ask-kit.md"))) console.log(render(fs.readFileSync(path.join(ROOT, "bundle", "rules", "ask.md"), "utf8")).trim());
    if (!loadConfig({ required: false })) console.log("\nask-kit is installed as a Claude Code plugin but not set up yet, so `ask` will say so. When the user wants to use it, follow the ask-kit-setup skill.");
    return;
  }
  throw new Error("plugin needs build or start");
}

async function uninstall() {
  const { uninstallBundle } = await import("../src/setup/bundle.mjs");
  const { REGISTER } = await import("../src/setup/register.mjs");
  const { loadConfig } = await import("../src/config.mjs");
  const dry = !!flag("dry-run");
  const c = loadConfig({ required: false });
  for (const client of c?.clients ?? []) {
    if (!REGISTER[client]) continue;
    const r = REGISTER[client]();
    console.log(`${dry ? "would remove" : "removing"} \`ask\` from ${client}`);
    if (!dry) {
      try {
        r.remove();
      } catch (e) {
        console.log(`  ✗ ${e.message}`);
      }
    }
  }
  for (const r of uninstallBundle({ dry })) if (r.action !== "gone") console.log(`${r.action === "skip-edited" ? "kept (you edited it)" : dry ? `would ${r.action}` : r.action}: ${r.path}`);
  console.log(dry ? "\nNothing changed (dry run)." : "\nDone. The config, keys and journals are kept; delete the ask-kit config and state folders to remove those too.");
}

// ---- doctor ----

async function doctor() {
  const { loadConfig, resolveKey, CONFIG_FILE } = await import("../src/config.mjs");
  const { API_PRESETS } = await import("../src/providers.mjs");
  const { makeHistory } = await import("../src/transcripts/index.mjs");
  const c = loadConfig();
  const { writeAgentsMd } = await import("../src/agentsmd.mjs");
  const { rgPath, which } = await import("../src/platform.mjs");
  console.log(`config: ${CONFIG_FILE}\nguide:  ${writeAgentsMd()}`);
  console.log(`  node ${process.version} on ${process.platform}-${process.arch}; ripgrep ${rgPath() ?? "MISSING"}; git ${which("git") ?? "missing"}`);
  const h = makeHistory({ sources: c.sources });
  for (const s of h.sources()) console.log(`  source ${s.name}: ${s.available ? `${(await h.sessions({ source: s.name, limit: 0 })).total} sessions` : `missing (${s.where})`}`);
  for (const [n, b] of Object.entries(c.backends.list)) {
    let status;
    if (b.kind === "api") {
      const p = API_PRESETS[b.preset] ?? {};
      const key = resolveKey(b.key) ?? (p.keyEnv ? process.env[p.keyEnv] : null);
      try {
        const res = await fetch(`${(b.baseUrl ?? p.baseUrl).replace(/\/+$/, "")}/models`, { headers: key ? { authorization: `Bearer ${key}` } : {}, signal: AbortSignal.timeout(8000) });
        const j = await res.json().catch(() => ({}));
        const ids = (j.data ?? []).map((m) => m.id);
        status = !res.ok ? `HTTP ${res.status}` : ids.length && !ids.includes(b.model) ? `reachable, but ${b.model} is not in its model list` : "ok";
        // Some providers (OpenRouter) list models without a key, so check the key on its own.
        if (status === "ok" && p.keyEnv && !p.local) {
          if (!key) status = `no key: set ${p.keyEnv} or rerun setup`;
          else if (p.keyCheck) {
            const kr = await fetch(`${p.baseUrl}${p.keyCheck}`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000) });
            if (!kr.ok) status = `the key was refused (HTTP ${kr.status}): check ${b.key?.env ?? b.key?.file ?? "the key"}`;
          }
        }
        if (status === "ok" && b.preset === "ollama") {
          // ask-kit asks Ollama for this much context; a model that tops out lower gets its prompt cut.
          const { ollamaContextLength, OLLAMA_DEFAULT_CTX } = await import("../src/ollama.mjs");
          const want = b.contextTokens ?? OLLAMA_DEFAULT_CTX;
          const max = await ollamaContextLength(b.baseUrl ?? p.baseUrl, b.model);
          status = max && max < want ? `ok, but ${b.model} holds only ${max} tokens of context and ask-kit's prompt needs about 16k: pick a larger-context model` : `ok (context ${want}${max ? ` of the model's ${max}` : ""})`;
        }
      } catch (e) {
        status = e.message;
      }
    } else status = "agent CLI (checked on first ask)";
    console.log(`  backend ${n}${n === c.backends.default ? " (default)" : ""}: ${b.kind} ${b.preset ?? ""} ${b.model ?? ""} → ${status}`);
  }
  console.log(`  domains: ${Object.keys(c.domains).join(", ")}; router: ${c.router?.backend ?? "keyword rules (no API backend)"}`);
  // Capabilities: who answers what more than one domain holds, and ties the config must settle.
  const { makeRouter } = await import("../src/router.mjs");
  const r = await makeRouter(c);
  for (const [cap, w] of Object.entries(r.caps)) console.log(`  capability ${cap}: ${w.top}${Object.entries(w.byCover).filter(([, d]) => d !== w.top).map(([x, d]) => `; ${x}: ${d}`).join("")}`);
  for (const n of r.hidden) console.log(`  hidden ${n}: ${r.skipped[n]}`);
  for (const t of r.ties) console.log(`  ✗ tie: ${t.message}`);
  if (r.ties.length) process.exitCode = 1;
}

// ---- kits: ask-kit.toml folders (src/kits.mjs, docs/design/kits.md) ----

async function kitCommand() {
  const sub = positional[0];
  const kits = await import("../src/kits.mjs");
  const { loadConfig, saveConfig, CONFIG_DIR } = await import("../src/config.mjs");
  const enable = (name, extra = {}) => {
    const c = loadConfig();
    c.domains = { ...(c.domains ?? {}), [name]: { ...(c.domains?.[name] ?? {}), enabled: true, ...extra } };
    saveConfig(c);
    return c;
  };
  switch (sub) {
    case "new": {
      const name = positional[1];
      const r = kits.newKit(name, flag("from"), { dir: typeof flag("dir") === "string" ? path.resolve(flag("dir")) : undefined });
      return print(r);
    }
    case "link": {
      const dir = path.resolve(positional[1] ?? ".");
      const m = kits.readManifest(dir);
      const dest = path.join(CONFIG_DIR, "kits", m.name);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      try {
        const st = fs.lstatSync(dest);
        if (!st.isSymbolicLink()) throw new Error(`${dest} exists and is not a link; remove it first`);
        fs.unlinkSync(dest);
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
      fs.symlinkSync(dir, dest, "dir");
      enable(m.name, { from: dir });
      (await import("../src/agentsmd.mjs")).writeAgentsMd();
      return print({ linked: m.name, dir, at: dest, next: `Restart the agents so \`ask\` lists it; changes in ${dir} load on the next question. Then: ask-kit kit test ${m.name}` });
    }
    case "enable":
    case "disable": {
      const c = loadConfig();
      if (!positional[1]) throw new Error(`kit ${sub} needs a name`);
      c.domains = { ...(c.domains ?? {}), [positional[1]]: { ...(c.domains?.[positional[1]] ?? {}), enabled: sub === "enable" } };
      saveConfig(c);
      return print({ [positional[1]]: sub === "enable" ? "enabled" : "disabled" });
    }
    case "list": {
      const c = loadConfig({ required: false }) ?? {};
      const rows = [];
      for (const name of kits.listKits()) {
        const dir = kits.findKit(name);
        try {
          const m = kits.readManifest(dir);
          const why = (await kits.kitDomain(dir, { config: c })).unavailable;
          rows.push({ name, version: m.version ?? "", enabled: c.domains?.[name]?.enabled !== false && !!c.domains?.[name], unavailable: why, sources: m.sources.map((s) => `${s.kind}:${s.name}`).join(" "), says: why ? `(not here: ${why})` : m.says, dir });
        } catch (e) {
          rows.push({ name, error: e.message.split("\n")[0], dir });
        }
      }
      if (flag("json")) return print(rows);
      for (const r of rows) console.log(`${r.enabled ? "●" : "○"} ${r.name.padEnd(14)} ${(r.sources ?? r.error).padEnd(34)} ${r.says ?? ""}`);
      return;
    }
    case "test": {
      const name = positional[1];
      if (!name) throw new Error("kit test needs a kit name");
      const { kitTest } = await import("../src/kittest.mjs");
      const backends = typeof flag("backends") === "string" ? flag("backends").split(",") : undefined;
      const only = typeof flag("only") === "string" ? flag("only").split(",") : undefined;
      const r = await kitTest(name, { backends, only, log: (l) => console.error(l) });
      if (typeof flag("out") === "string") fs.writeFileSync(flag("out"), JSON.stringify(r, null, 2));
      for (const s of r.summary) console.log(`${r.kit} · ${s.backend}: ${s.passed}/${s.of}, median ${s.medianSeconds}s, $${s.costUsd}, ${s.cells} cells (median ${s.medianCells ?? "-"}), ${s.noModel}/${s.of} answered with no model`);
      if (r.summary.some((s) => s.passed < s.of)) process.exitCode = 1;
      return;
    }
    case "profile": {
      const { kitProfile } = await import("../src/report.mjs");
      const { makeRouter } = await import("../src/router.mjs");
      const router = await makeRouter(loadConfig());
      const r = kitProfile({ since: typeof flag("since") === "string" ? flag("since") : "30d", router });
      if (flag("json")) return print(r);
      console.log(`Since ${r.since} (kit tests and benchmarks left out)`);
      console.log(`${"kit".padEnd(18)}${"chosen".padStart(7)}${"asks".padStart(6)}${"median s".padStart(10)}${"cost $".padStart(9)}${"cells".padStart(7)}${"misroutes".padStart(11)}${"fallbacks".padStart(11)}${"no data".padStart(9)}${"router tok".padStart(12)}${"load ms".padStart(9)}`);
      for (const k of r.kits) console.log(`${k.name.padEnd(18)}${String(k.chosen).padStart(7)}${String(k.asks).padStart(6)}${String(k.medianSeconds ?? "-").padStart(10)}${k.costUsd.toFixed(4).padStart(9)}${String(k.medianCells ?? "-").padStart(7)}${String(k.misroutes).padStart(11)}${String(k.fallbacks).padStart(11)}${String(k.noData).padStart(9)}${String(k.routerTokens).padStart(12)}${String(k.loadMs ?? "-").padStart(9)}${k.hidden ? `  (hidden: ${k.hidden})` : ""}`);
      return;
    }
    case "actions": {
      // A kit's [[actions]]: status (on, or off and why), the last 20 runs, and --enable/--disable.
      const name = positional[1];
      if (!name) throw new Error("kit actions needs a kit name");
      const dir = kits.findKit(name);
      if (!dir) throw new Error(`no kit ${name}; ask-kit kit list shows them`);
      const acts = await import("../src/actions.mjs");
      const list = acts.compileActions(kits.readManifest(dir));
      const on = typeof flag("enable") === "string" ? flag("enable") : null;
      const off = typeof flag("disable") === "string" ? flag("disable") : null;
      if (on || off) {
        const a = list.find((x) => x.name === (on ?? off));
        if (!a) throw new Error(`${name} has no action ${on ?? off}; its actions: ${list.map((x) => x.name).join(", ") || "none"}`);
        const c = loadConfig();
        const own = { ...(c.domains?.[name]?.actions ?? {}) };
        if (on) {
          // Your yes: clears a demotion (its window starts again) and turns on an action that acts.
          acts.enableAction(name, a.name);
          if (own[a.name] === false || a.acts) own[a.name] = true;
        } else own[a.name] = false;
        c.domains = { ...(c.domains ?? {}), [name]: { ...(c.domains?.[name] ?? {}), actions: own } };
        saveConfig(c);
      }
      const c = loadConfig({ required: false }) ?? {};
      const state = acts.readState(name);
      const rows = list.map((a) => {
        const s = acts.statusOf(name, a, c, state);
        return { name: a.name, title: a.title, script: a.script, acts: a.acts, on: s.on, ...(s.on ? {} : { why: s.why }), match: a.patterns, ...(a.expect ? { expect: a.expect.source } : {}), last20: acts.windowOf(name, a.name) };
      });
      if (flag("json")) return print(rows);
      if (!rows.length) return console.log(`${name} has no [[actions]] (docs/user-guide/kits.md, "Actions").`);
      for (const r of rows) console.log(`${r.on ? "●" : "○"} ${r.name.padEnd(20)} ${r.title}  (script ${r.script}${r.acts ? ", changes things" : ""})\n    ${r.on ? "on" : r.why}\n    last ${r.last20.runs} runs: ${r.last20.answered} answered, ${r.last20.failed} fell through on an error or the shape, ${r.last20.reasked} asked again\n    match: ${r.match.join("  |  ")}`);
      return;
    }
    case "install":
      if (!positional[1]) throw new Error("kit install needs a repository (owner/repo) or a folder");
      return print(await (await import("../src/gallery.mjs")).addDomain(positional[1], { yes: !!flag("yes") }));
    default:
      throw new Error("kit: new <name> --from folder:<path>|cli:<command> · link <dir> · list · test <name> [--backends a,b] [--only id,id] · profile [--since 30d] [--json] · install <owner/repo> [--yes] · enable|disable <name> · actions <name> [--enable|--disable <action>] [--json]");
  }
}

// ---- ask from the shell: the same tool, through MCP ----

async function askFromShell() {
  const question = positional.join(" ");
  if (!question) throw new Error('ask needs a question: ask-kit ask "what did we decide about X?"');
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
  const domain = flag("domain");
  const args = [path.join(ROOT, "bin", "ask-kit.mjs"), "serve", ...(domain ? ["--domain", domain] : [])];
  const env = { ...process.env, ASK_KIT_SESSION: process.env.ASK_KIT_SESSION || `shell-${process.ppid}` };
  const client = new Client({ name: "ask-kit-shell", version: "0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args, env, stderr: "inherit" }));
  const backend = flag("backend");
  // On a terminal: a spinner with the time so far, and one line per cell the investigator runs.
  const tty = process.stderr.isTTY;
  const t0 = Date.now();
  const frames = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";
  let tick = 0;
  const spin = () => process.stderr.write(`\r\x1b[2K\x1b[2m${frames[tick++ % frames.length]} investigating · ${Math.round((Date.now() - t0) / 1000)}s\x1b[0m`);
  const timer = tty ? setInterval(spin, 100) : null;
  const onprogress = (p) => {
    if (!p.message) return;
    if (tty) process.stderr.write(`\r\x1b[2K\x1b[2m  ${p.message}\x1b[0m\n`), spin();
    else process.stderr.write(`  ${p.message}\n`);
  };
  let out;
  try {
    out = await client.callTool(
      // No early answers from a shell: the process ends with the reply, and the rest of the run with it.
      { name: "ask", arguments: { question, early: false, ...(typeof backend === "string" ? { backend } : {}), ...(flag("continue") ? { continue: true } : {}) } },
      undefined,
      { timeout: 900_000, onprogress },
    );
  } finally {
    if (timer) clearInterval(timer), process.stderr.write("\r\x1b[2K");
  }
  if (tty) process.stderr.write("\n");
  const text = out.content.map((c) => c.text).join("\n");
  console.log(process.stdout.isTTY && !process.env.NO_COLOR ? terminalMarkdown(text) : text);
  await client.close();
  if (out.isError) process.exitCode = 1;
}

// ---- a shot from the shell: one kit script, no model, kept in the kit's REPL for `ask --continue` ----

async function runShotFromShell() {
  const [kit, script, ...words] = argv.slice(1);
  if (!kit || !script) throw new Error("run needs a kit and a script: ask-kit run <kit> <script> [key=value ...]");
  const { parseParams } = await import("../src/shots.mjs");
  const params = parseParams(words);
  const { loadDomain } = await import("../src/domains.mjs");
  const d = await loadDomain(kit);
  if (d.unavailable) throw new Error(`${kit} cannot run here: ${d.unavailable}`);
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
  // The same session id as `ask-kit ask` from this shell, so `ask-kit ask --continue` finds the shot.
  const env = { ...process.env, ASK_KIT_DOMAIN: kit, ASK_KIT_SESSION: process.env.ASK_KIT_SESSION || `shell-${process.ppid}` };
  const client = new Client({ name: "ask-kit-shell", version: "0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, "src", "server.mjs")], env, stderr: "inherit" }));
  try {
    const out = await client.callTool({ name: "ask", arguments: { do: script, params } }, undefined, { timeout: 900_000 });
    console.log(out.content.map((c) => c.text).join("\n"));
    if (out.isError) process.exitCode = 1;
  } finally {
    await client.close();
  }
}

// An answer's Markdown, for a terminal: headings and **bold** in bold, `code` in colour, bullets
// as •, and the [domain · backend · time · cost] line dimmed. Piped output stays plain Markdown.
function terminalMarkdown(text) {
  const B = "\x1b[1m", D = "\x1b[2m", C = "\x1b[36m", R = "\x1b[0m";
  const inline = (s) => s.replace(/`([^`]+)`/g, `${C}$1${R}`).replace(/\*\*([^*]+)\*\*/g, `${B}$1${R}`);
  return text
    .split("\n")
    .map((l) => {
      if (/^#{1,6}\s/.test(l)) return B + inline(l.replace(/^#{1,6}\s+/, "")) + R;
      if (/^\[[^\]]+·[^\]]+\]$/.test(l.trim())) return D + l + R;
      const m = l.match(/^(\s*)[-*]\s+(.*)$/);
      if (m) return `${m[1]}${D}•${R} ${inline(m[2])}`;
      return inline(l);
    })
    .join("\n");
}

// Output piped into `head` and closed early is not an error.
process.stdout.on("error", (e) => (e.code === "EPIPE" ? process.exit(0) : undefined));
main().catch((e) => {
  console.error(`ask-kit: ${e.message}`);
  process.exit(1);
});
