// The setup conversation: questions built from what detect() found, each with options, a
// suggested answer and why. The terminal wizard (`ask-kit setup`) and an agent running the
// ask-kit-setup skill ask the same questions and hand the same answers to apply().
//
// Answers:
//   { sources: ["claude-code", ...],          transcripts the sessions domain reads
//     clients: ["claude-code", ...],          agents that get the `ask` tool
//     investigator: "<choice id>",            the default model, an id from the investigator options
//     extras: ["<choice id>", ...],           more backends a caller may pick with backend:
//     router: "investigator" | "keywords" | "<choice id>",   what picks the investigator for a question
//     domains: ["sessions", "code"],
//     keys: { "<preset>": {env} | {file, var} | {value} } }   only for an API without a key found
import { AGENTS, AGENT_CLIS, API_PRESETS } from "../providers.mjs";

/** Every model choice this machine could use, best first. id is "<kind or preset>:<model>". */
export function investigatorChoices(d) {
  const out = [];
  for (const [preset, a] of Object.entries(d.apis)) {
    for (const [k, m] of API_PRESETS[preset].models.entries()) {
      out.push({
        id: `${preset}:${m.id}`,
        label: `${m.id} via ${a.label}`,
        note: m.note,
        ready: a.keyFound,
        needs: a.keyFound ? null : `a ${a.label} key (${API_PRESETS[preset].keyEnv})`,
        rank: (a.keyFound ? 0 : 100) + (preset === "openrouter" ? 0 : 10) + k,
        cost: "pay per question",
      });
    }
  }
  for (const [kind, c] of Object.entries(d.clis)) {
    if (!c.available) continue;
    for (const [k, m] of AGENT_CLIS[kind].models.entries()) {
      out.push({
        id: `${kind}:${m.id}`,
        label: `${AGENT_CLIS[kind].label}${m.id ? `, model ${m.id}` : ""}`,
        note: `${m.note}; ${AGENT_CLIS[kind].forks ? "warmed once and forked per question" : "starts fresh each question (no fork)"}`,
        ready: c.signedIn !== false,
        needs: c.signedIn === false ? `signing in to ${c.label}` : null,
        rank: 30 + (kind === "claude-cli" ? 0 : kind === "codex-cli" ? 2 : 4) + k,
        cost: "uses your subscription",
      });
    }
  }
  for (const [preset, l] of Object.entries(d.local)) {
    if (!l.running) continue;
    // Embedding, reranking and OCR models cannot drive an investigation.
    for (const m of l.models.filter((x) => !/embed|rerank|ocr|whisper/i.test(x)).slice(0, 5)) {
      out.push({ id: `${preset}:${m}`, label: `${m} on ${l.label}`, note: "free and private; small local models answer worse", ready: true, needs: null, rank: 60, cost: "free" });
    }
  }
  return out.sort((a, b) => a.rank - b.rank);
}

/** The models that can route, ready on this machine: each with its speed and cost for one routing call. */
export function routerChoices(d) {
  // Measured 2026-11-23 for one routing call: claude on Haiku about 4 s, codex about 7.6 s.
  const speed = (kind, model) =>
    kind === "claude-cli" ? (model === "haiku" ? "about 4 s per routed question" : "slower than haiku per routed question")
    : kind === "codex-cli" ? "about 8 s per routed question"
    : kind === "copilot-cli" ? "starts Copilot for each routed question" : null;
  return investigatorChoices(d)
    .filter((c) => c.ready)
    .map((c) => {
      const [kind, model] = c.id.split(/:(.*)/s);
      const s = speed(kind, model);
      if (s) return { ...c, note: `${s} · ${kind === "copilot-cli" ? "uses premium requests" : "nothing extra on your subscription"}` };
      if (API_PRESETS[kind]?.local) return { ...c, note: "free and private; small local models pick worse" };
      return { ...c, note: `about 1 s per routed question · a fraction of a cent` };
    });
}

export function questions(d) {
  const stores = Object.entries(d.agents).filter(([, a]) => a.transcripts);
  const clients = Object.entries(d.agents).filter(([n, a]) => a.onPath && AGENTS[n].client);
  const choices = investigatorChoices(d);
  const ready = choices.filter((c) => c.ready);
  const best = ready[0] ?? choices[0];
  const qs = [
    {
      id: "sources",
      type: "multi",
      question: "Whose past sessions should `ask` be able to read?",
      why: "The sessions investigator answers from these agents' own transcripts on this machine. Nothing leaves the machine except the excerpts the investigator's model reads.",
      options: stores.map(([n, a]) => ({ value: AGENTS[n].source, label: `${a.label}: ${a.sessions ?? "?"} sessions in ${a.transcripts}` })),
      suggested: stores.map(([n]) => AGENTS[n].source),
    },
    {
      id: "clients",
      type: "multi",
      question: "Which agents should get the `ask` tool?",
      why: "ask-kit registers one MCP server named `ask` in each agent you pick (user-wide).",
      options: clients.map(([n, a]) => ({ value: AGENTS[n].client, label: `${a.label} (${a.version ?? a.path})` })),
      suggested: clients.map(([n]) => AGENTS[n].client),
    },
    {
      id: "investigator",
      type: "single",
      question: "Which model should do the digging by default?",
      why:
        "It runs outside your agent's context, so a small cheap model is usually right: it reads and searches, your agent gets a short answer. " +
        "An API key is cheapest and fastest; a subscription CLI costs nothing extra but is slower to start.",
      options: choices.map((c) => ({ value: c.id, label: c.label, note: `${c.note} · ${c.cost}${c.needs ? ` · needs ${c.needs}` : ""}` })),
      suggested: best?.id ?? null,
    },
    {
      id: "extras",
      type: "multi",
      question: "Any other models to keep available, for a caller to pick with `backend:`?",
      why: "Handy for a hard question (a stronger model) or when the default is down. They cost nothing until used.",
      options: ready.filter((c) => c.id !== best?.id).map((c) => ({ value: c.id, label: c.label, note: c.cost })),
      suggested: ready.filter((c) => c.id !== best?.id && !c.id.startsWith("copilot-cli")).slice(0, 2).map((c) => c.id),
    },
    {
      id: "router",
      type: "single",
      question: "When a question doesn't say which investigator it is for, which model should pick one?",
      why:
        "Most asks skip this: the caller names the investigator, follows up an earlier ask, or the question matches a kit's pattern. " +
        "For the rest, one short call picks the investigator before the digging starts, so its speed is added to those asks. " +
        "An API answers in about a second for a fraction of a cent. A subscription CLI costs nothing extra but starts each time: " +
        "about 4 s for claude on Haiku, about 8 s for codex. Keywords only is instant and free, and picks the wrong investigator more often.",
      options: [
        { value: "investigator", label: "The model you chose to do the digging", note: "one choice to make; its speed is the router's" },
        ...routerChoices(d).map((c) => ({ value: c.id, label: c.label, note: c.note })),
        { value: "keywords", label: "No model: keywords only", note: "instant and free; misroutes more" },
      ],
      suggested: "investigator",
    },
    {
      id: "domains",
      type: "multi",
      question: "What should `ask` answer about?",
      why: "sessions: past work in your agents' transcripts. code: the repository the agent is working in (path:line answers).",
      options: [
        { value: "sessions", label: "sessions: past work, from the transcripts" },
        { value: "code", label: "code: the repository you are working in" },
      ],
      suggested: ["sessions", "code"],
    },
  ];
  return { questions: qs, suggested: Object.fromEntries(qs.map((q) => [q.id, q.suggested])) };
}

/** Asked only when the chosen API has no key on this machine. */
export function keyQuestion(preset) {
  const p = API_PRESETS[preset];
  return {
    id: `keys.${preset}`,
    type: "secret",
    question: `Where is your ${p.label} key? Paste it, or name the environment variable that holds it.`,
    why: `A pasted key is stored in ~/.config/ask-kit/keys.env (mode 0600); ask-kit's config only names where the key is. Default variable: ${p.keyEnv}.`,
  };
}
