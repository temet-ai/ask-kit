import { NOISE, escape } from "../lib.mjs";

export const meta = {
  purpose:
    "Settings, toggles, env vars, CLI flags and named constants about a topic: answers 'is there a setting/flag/env var for X' and 'where is X configured'. One search for the topic's words, then each line sorted into env reads, CLI flags, SCREAMING_CASE constants, config-file entries and settings fields.",
  params: { topic: "words, e.g. 'embedding batch' or 'retry limit'", path: "folder, optional", max: "hits per kind, default 25" },
  returns: "{words, envReads, cliFlags, constants, configFiles, settingsFields: [{file,line,text}], scanned, complete, checked}",
  example: 'await scripts.run("knobs", { topic: "embedding batch" })',
};

const STOP = new Set(["the", "a", "an", "to", "for", "of", "and", "or", "up", "speed", "is", "there", "any", "how", "do", "we", "toggle", "toggles", "setting", "settings", "means", "make", "faster"]);
const KINDS = {
  envReads: /(env::var|std::env|process\.env|os\.environ|getenv|env!\(|dotenv|\benv\s*=|Environment=)/,
  cliFlags: /(#\[(arg|clap|command)|\.option\(|add_argument|\.arg\(|--[a-z][a-z0-9-]{2,})/,
  constants: /\b(const|static|readonly|final)\s+[A-Z][A-Z0-9_]{2,}\b|\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\s*[:=]/,
  settingsFields: /(#\[serde|\bpub\s+[a-z_]+\s*:|Settings|Config|settings\.|config\.)/,
};
const CONFIG_FILE = /\.(toml|ya?ml|json|env|ini|conf|service)$|(^|\/)\.env/;

export default async function ({ repo }, { topic, path, max = 25 }) {
  const words = String(topic ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
  if (!words.length) throw new Error("knobs needs `topic` with at least one meaningful word");
  // Stems, so "embedding" also finds EMBED_ and embedder.
  const stems = [...new Set(words.map((w) => (w.length > 6 ? w.slice(0, Math.max(5, w.length - 4)) : w)))];
  const hits = await repo.rg(stems.map(escape).join("|"), { glob: [...NOISE, "!**/*.md", "!**/tests/**", "!**/*test*"], path, max: 6000, ignoreCase: true });
  const out = { envReads: [], cliFlags: [], constants: [], configFiles: [], settingsFields: [] };
  for (const h of hits) {
    const row = { file: h.file, line: h.line, text: h.text.trim().slice(0, 180) };
    if (CONFIG_FILE.test(h.file)) {
      if (out.configFiles.length < max) out.configFiles.push(row);
      continue;
    }
    for (const [kind, re] of Object.entries(KINDS)) {
      if (re.test(h.text) && out[kind].length < max) {
        out[kind].push(row);
        break;
      }
    }
  }
  return {
    words: stems,
    ...out,
    scanned: hits.length,
    complete: hits.complete,
    checked: ["env reads", "CLI argument definitions", "SCREAMING_CASE constants", "settings/config struct fields", "toml/yaml/json/env/ini/conf/service files"],
  };
}
