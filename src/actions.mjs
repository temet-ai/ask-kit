// Actions: a kit script that answers a question with no model. A kit's ask-kit.toml names them in
// [[actions]]: `name`, `title`, `script` (a kit script), `match` (regular expressions; a question
// that matches one as a whole runs the script, its named captures filling the script's params),
// `params` (defaults), `expect` (a regular expression the output must match) and `acts` (the
// script changes something). docs/design/composition.md, section 6.
//
// The domain server tries a kit's actions before any model call (src/ask.mjs); anything other than
// a clean answer (no match, an error, empty output, output that fails `expect`) falls through to the
// model. Every run is journaled in <state>/actions/<kit>.jsonl. An action whose last 20 runs hold
// more than 3 bad ones (fell through on an error or the shape, or the caller asked again within two
// minutes) is turned off in <state>/actions/<kit>.json, never in the user's config;
// `ask-kit kit actions <kit> --enable <name>` turns it on again.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { STATE_ROOT, slug } from "./config.mjs";

const NAME = /^[a-z][a-z0-9-]*$/;
const SCRIPT = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
// The rolling window, how many bad runs in it turn an action off, and the re-ask gap.
export const WINDOW = 20;
export const MAX_BAD = 3;
export const REASK_MS = 120_000;
// One run in this many also runs the model in the background, for `report` to show both answers.
export const SHADOW_EVERY = 20;
// The key in an ask result's _meta naming the action that answered ({ kit, action, run }), so the
// router can tell the action when the caller corrects the route.
export const ACTION_META = "ask-kit/action";
// Fell-through reasons that count against an action (a mismatch is not a run).
const BAD = ["error", "empty", "expect"];

// A request that asks for a change rather than an answer: it opens with a verb that changes
// something, once any politeness ("please", "can you", "go ahead and") is left off. Only the
// caller's own words are tested: the router and the `ask` tool set act from it when the caller
// did not say, and smith keeps such prompts out of bench rows.
export const ACTING = /^(create|add|post|merge|approve|fix|implement|write|update|delete|remove|push|commit|make|build|deploy|move|rename|send|reply|comment|close|open|raise|file|log|set|change|apply|edit|refactor|revert|rebase|restart|stop|start|kill|rerun|retry|run|install|uninstall|enable|disable|prune|clean|reset|record|save|message|mail|spawn|label|tag|release|bump|upgrade|cancel|decline|mark|resolve|assign|replace|insert|drop|truncate|terminate|go ahead|do it|do that|proceed)\b/i;
const LEAD = /^(?:(?:okay|ok|so|now|then|and|also|please|pls|yes|great|thanks|go ahead and|can you|could you|would you|will you|i want you to|i need you to|i'd like you to|let's|lets)[,!.]?\s+)+/i;
/** Does this request ask for a change? */
export const asksForChange = (question) => ACTING.test(String(question ?? "").trim().replace(LEAD, ""));

/** Problems with a manifest's [[actions]], for readManifest. */
export function checkActions(actions) {
  const problems = [];
  if (actions == null) return problems;
  if (!Array.isArray(actions)) return ["[[actions]]: a list of { name, title, script, match, params, expect, acts }"];
  const seen = new Set();
  const isRe = (p) => {
    try {
      new RegExp(p);
      return true;
    } catch {
      return false;
    }
  };
  for (const [i, a] of actions.entries()) {
    if (!NAME.test(a.name ?? "")) problems.push(`actions[${i}].name: lowercase letters, digits and dashes, starting with a letter`);
    else if (seen.has(a.name)) problems.push(`actions[${i}].name: "${a.name}" is named twice`);
    seen.add(a.name);
    if (a.title != null && typeof a.title !== "string") problems.push(`actions[${i}].title: a few words saying what it answers`);
    if (!SCRIPT.test(a.script ?? "")) problems.push(`actions[${i}].script: the name of one of the kit's scripts`);
    const match = [].concat(a.match ?? []);
    if (!match.length || !match.every((p) => typeof p === "string" && p)) problems.push(`actions[${i}].match: one or more regular expressions, e.g. ['containers( running)? on (?<host>\\S+)']`);
    for (const p of match) if (typeof p === "string" && p && !isRe(p)) problems.push(`actions[${i}].match: ${p} is not a regular expression`);
    if (a.params != null && (typeof a.params !== "object" || Array.isArray(a.params))) problems.push(`actions[${i}].params: a table of default parameters`);
    if (a.expect != null && !(typeof a.expect === "string" && isRe(a.expect))) problems.push(`actions[${i}].expect: a regular expression the script's output must match`);
    if (a.acts != null && typeof a.acts !== "boolean") problems.push(`actions[${i}].acts: true when the script changes something`);
  }
  return problems;
}

/**
 * A manifest's actions, ready to match. A pattern must match the whole question (trailing
 * punctuation and spaces aside), so a question with a clause the pattern does not cover goes to
 * the model. `acts` is set by the action or by its script being named in the kit's `acts`.
 */
export function compileActions(m) {
  return (m.actions ?? []).map((a) => ({
    name: a.name,
    title: a.title ?? a.name,
    script: a.script,
    patterns: [].concat(a.match),
    match: [].concat(a.match).map((p) => new RegExp(`^\\s*(?:${p})[\\s?.!]*$`, "i")),
    params: a.params ?? {},
    expect: a.expect ? new RegExp(a.expect, "i") : null,
    acts: a.acts === true || (a.acts !== false && [].concat(m.acts ?? []).includes(a.script)),
  }));
}

// A captured number or boolean is passed as one; anything else as the text captured.
const value = (s) => (/^-?\d+(\.\d+)?$/.test(s) ? Number(s) : s === "true" ? true : s === "false" ? false : s);

const paramsOf = (a, m) => ({ ...a.params, ...Object.fromEntries(Object.entries(m.groups ?? {}).filter(([, v]) => v != null && v !== "").map(([k, v]) => [k, value(v.trim())])) });

/** The first action one of whose patterns matches the whole question, with its params, or null. */
export function matchAction(actions, question) {
  const q = String(question ?? "");
  for (const a of actions) {
    for (const re of a.match) {
      const m = re.exec(q);
      if (m) return { action: a, params: paramsOf(a, m) };
    }
  }
  return null;
}

/**
 * The first action one of whose patterns is found inside the question without matching all of
 * it, with its params, or null. Its script opens the investigation and the model finishes it.
 */
export function openerFor(actions, question) {
  const q = String(question ?? "");
  if (matchAction(actions, q)) return null;
  for (const a of actions) {
    for (const p of a.patterns) {
      const m = new RegExp(p, "i").exec(q);
      if (m) return { action: a, params: paramsOf(a, m) };
    }
  }
  return null;
}

/** Why a script's output is not an answer: "empty", "expect", or null when it is one. */
export function shapeProblem(action, text) {
  const t = String(text ?? "").trim();
  if (/^(undefined|null|\[\]|\{\}|""|'')?$/.test(t)) return "empty";
  if (action.expect && !action.expect.test(t)) return "expect";
  return null;
}

// ---- state: the run log and what was turned off ----

export const actionsDir = () => path.join(STATE_ROOT, "actions");
const logFile = (kit) => path.join(actionsDir(), `${slug(kit)}.jsonl`);
const stateFile = (kit) => path.join(actionsDir(), `${slug(kit)}.json`);

const append = (kit, row) => {
  try {
    fs.mkdirSync(actionsDir(), { recursive: true, mode: 0o700 });
    fs.appendFileSync(logFile(kit), JSON.stringify({ at: new Date().toISOString(), ...row }) + "\n", { mode: 0o600 });
  } catch {}
};

/** Every row of a kit's action log: runs, re-asks and shadow runs. */
export function readLog(kit) {
  try {
    return fs
      .readFileSync(logFile(kit), "utf8")
      .split("\n")
      .filter(Boolean)
      .flatMap((l) => {
        try {
          return [JSON.parse(l)];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

export function readState(kit) {
  try {
    return JSON.parse(fs.readFileSync(stateFile(kit), "utf8"));
  } catch {
    return {};
  }
}

export function writeState(kit, s) {
  fs.mkdirSync(actionsDir(), { recursive: true, mode: 0o700 });
  fs.writeFileSync(stateFile(kit), JSON.stringify(s, null, 2) + "\n", { mode: 0o600 });
}

/**
 * Whether an action runs: { on, why }. `domains.<kit>.actions.<name>` in the config turns any
 * action off (false) and an acting one on (true); a demoted one stays off until `kit actions
 * --enable` clears it.
 */
export function statusOf(kit, action, config, state = readState(kit)) {
  const set = config?.domains?.[kit]?.actions?.[action.name];
  if (set === false) return { on: false, why: `turned off in the config (domains.${kit}.actions.${action.name} = false)` };
  if (action.acts && set !== true) return { on: false, why: `changes things: on once you set domains.${kit}.actions.${action.name} = true (or run ask-kit kit actions ${kit} --enable ${action.name})` };
  const s = state[action.name];
  if (s?.off) return { on: false, demoted: true, why: `turned off: ${s.why}` };
  return { on: true };
}

/** The action's last WINDOW runs since it was last turned on: how many fell through or were asked again. */
export function windowOf(kit, name, rows = readLog(kit), since = readState(kit)[name]?.enabledAt) {
  const runs = rows.filter((r) => r.type === "run" && r.action === name && (!since || r.at >= since)).slice(-WINDOW);
  const ids = new Set(runs.map((r) => r.id));
  const reasked = new Set(rows.filter((r) => r.type === "reask" && ids.has(r.run)).map((r) => r.run));
  const failed = runs.filter((r) => BAD.includes(r.fellThrough)).length;
  const bad = runs.filter((r) => BAD.includes(r.fellThrough) || reasked.has(r.id)).length;
  return { runs: runs.length, answered: runs.filter((r) => !r.fellThrough).length, failed, reasked: reasked.size, bad };
}

// After a bad run or a re-ask: past MAX_BAD bad runs in the window, the action is turned off.
function guard(kit, name) {
  const w = windowOf(kit, name);
  if (w.bad <= MAX_BAD) return null;
  const state = readState(kit);
  if (state[name]?.off) return null;
  const why = `${w.bad} of its last ${w.runs} runs went wrong (${w.failed} fell through on an error or the output's shape, ${w.reasked} asked again within ${REASK_MS / 1000} s)`;
  writeState(kit, { ...state, [name]: { off: true, why, at: new Date().toISOString() } });
  return why;
}

/** Journal one run of a matched action; returns its id and, when the run turned it off, why. */
export function logRun(kit, row) {
  const id = crypto.randomUUID().slice(0, 8);
  append(kit, { type: "run", id, ...row });
  return { id, off: BAD.includes(row.fellThrough) ? guard(kit, row.action) : null };
}

export function logShadow(kit, row) {
  append(kit, { type: "shadow", ...row });
}

/** How many times the action has run (shadow runs are taken every SHADOW_EVERY). */
export const runCount = (kit, name) => readLog(kit).filter((r) => r.type === "run" && r.action === name).length;

/**
 * A new question from `session` in `kit`: when the last thing it got from this kit was an action's
 * answer less than REASK_MS ago, it asked again, unless the new question is the same action with
 * other params (a new question of the same kind). `hit` is the new question's matchAction result.
 */
export function noteQuestion(kit, session, hit) {
  const rows = readLog(kit);
  const last = rows.findLast((r) => r.type === "run" && r.session === session);
  if (!last || last.fellThrough || Date.now() - Date.parse(last.at) > REASK_MS) return null;
  if (rows.some((r) => r.type === "reask" && r.run === last.id)) return null;
  if (hit && (hit.action.name !== last.action || JSON.stringify(hit.params) !== JSON.stringify(last.params))) return null;
  return markReask(kit, last, "asked again");
}

/** The router saw the caller send its next question to another domain: the action's answer fell short. */
export function markReaskOf(kit, runId, why) {
  const rows = readLog(kit);
  const run = rows.find((r) => r.type === "run" && r.id === runId);
  if (!run || run.fellThrough || rows.some((r) => r.type === "reask" && r.run === runId)) return null;
  return markReask(kit, run, why);
}

function markReask(kit, run, why) {
  append(kit, { type: "reask", run: run.id, action: run.action, session: run.session, why, afterMs: Date.now() - Date.parse(run.at) });
  return guard(kit, run.action);
}

/** Clear a demotion: the window starts again from now. */
export function enableAction(kit, name) {
  const state = readState(kit);
  writeState(kit, { ...state, [name]: { enabledAt: new Date().toISOString() } });
}
