// A domain is what an investigator answers about: its REPL globals, scripts, instructions and the
// words of its `ask` tool. The REPL, backends, warm-and-fork, snapshots and journal are shared.
//
// Built in: domains/<name>/domain.mjs in this package. Your own: ~/.config/ask-kit/domains/<name>/domain.mjs,
// which wins over a built-in of the same name.
//
// A domain module exports `domain`:
//   name, says            name, and one line saying what it answers (the router reads it)
//   stateKey?             a sub-folder of its state (code: one per repository)
//   scriptsDir, apiDoc, instructions   paths
//   makeGlobals({push, config, act})  the REPL's service globals; push(call) journals each call;
//                                     act: the caller asked for a change, so build the acting ones too
//   prime                 the warm session's first prompt
//   answerRules           appended to every question (how to cite)
//   openWith              which script to start from, for the chat-API loop
//   askDescription, serverInstructions, replInstructions   the MCP words
//   fingerprintFiles()    files whose change re-warms
//   defaultBackend?       a backend name from config that suits this domain best
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { CONFIG_DIR, ROOT, loadConfig } from "./config.mjs";
import { findKit, kitDomain, kitIndex, listKits } from "./kits.mjs";

const NAME = /^[a-z][a-z0-9-]*$/;

export function domainDirs() {
  return [path.join(CONFIG_DIR, "domains"), path.join(ROOT, "domains")];
}

// Kits (an ask-kit.toml folder, src/kits.mjs) and domains share one namespace; a kit wins.
export function listDomains() {
  const seen = new Set(listKits());
  for (const dir of domainDirs()) {
    try {
      for (const d of fs.readdirSync(dir)) if (NAME.test(d) && fs.existsSync(path.join(dir, d, "domain.mjs"))) seen.add(d);
    } catch {}
  }
  return [...seen];
}

// The router's view of a domain: a kit's index (manifest only, nothing run), else the domain module.
export async function indexDomain(name, config = loadConfig({ required: false })) {
  if (!NAME.test(name ?? "")) throw new Error(`"${name}" is not a domain name`);
  const kit = findKit(name);
  if (kit) return kitIndex(kit, { config });
  return loadDomain(name);
}

export async function loadDomain(name) {
  if (!NAME.test(name ?? "")) throw new Error(`"${name}" is not a domain name`);
  const kit = findKit(name);
  if (kit) return kitDomain(kit, { config: loadConfig({ required: false }) });
  for (const dir of domainDirs()) {
    const file = path.join(dir, name, "domain.mjs");
    if (fs.existsSync(file)) return (await import(pathToFileURL(file).href)).domain;
  }
  throw new Error(`no domain "${name}"; there are: ${listDomains().join(", ")}`);
}
