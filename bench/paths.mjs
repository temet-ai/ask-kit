// Where the bench scripts read and write. The public question set is bench/questions.json, with
// its results in bench/results/. Questions about client work and other private repositories live
// in bench/private/ (git-ignored): when that folder exists the scripts load its questions too, and
// redact.mjs routes their rows to bench/private/results/.
import fs from "node:fs";
import path from "node:path";

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const BENCH = path.join(ROOT, "bench");
export const PRIVATE = path.join(BENCH, "private");
export const RESULTS = path.join(BENCH, "results");
export const PRIVATE_RESULTS = path.join(PRIVATE, "results");
export const HAND_GRADES = [path.join(BENCH, "hand-grades.json"), path.join(PRIVATE, "hand-grades.json")];

const read = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
/** The public set, plus the private set (each question marked `private: true`) when it is here. */
export function loadQuestions() {
  const spec = read(process.env.BENCH_QUESTIONS || path.join(BENCH, "questions.json"));
  const priv = path.join(PRIVATE, "questions.json");
  if (!process.env.BENCH_QUESTIONS && fs.existsSync(priv)) {
    const p = read(priv);
    spec.questions = [...spec.questions, ...p.questions.map((q) => ({ ...q, private: true }))];
    spec.repos = { ...p.repos, ...spec.repos };
  }
  return spec;
}
