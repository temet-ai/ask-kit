// kit test and the journal report with no model and no network: a bench of the fixture kit with one
// `do` question (run as a shot) and one model question (a scripted backend). The summary gives the
// cells and the share answered with no model; the report shows the shot.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fakeBackend } from "./fixtures/shot-kit/fake-backend.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ask-kit-kittest-"));
const config = path.join(tmp, "config");
const kit = path.join(config, "kits", "watch");
fs.cpSync(path.join(ROOT, "test", "fixtures", "shot-kit"), kit, { recursive: true });
fs.mkdirSync(path.join(kit, "bench"));
fs.copyFileSync(path.join(ROOT, "test", "fixtures", "shot-kit-bench", "questions.json"), path.join(kit, "bench", "questions.json"));

const fake = await fakeBackend([{ code: 'watch.onDuty("Cable Street").join(", ")' }, { answer: "Angua is on duty at Cable Street." }]);
fs.writeFileSync(path.join(config, "config.json"), JSON.stringify({ version: 1, sources: [], backends: { default: "fake", list: { fake: fake.backend } }, domains: { watch: {} } }));
process.env.ASK_KIT_CONFIG = config;
process.env.ASK_KIT_STATE = path.join(tmp, "state");
delete process.env.ASK_KIT_DOMAIN;
delete process.env.ASK_KIT_SESSION;

const { kitTest } = await import("../src/kittest.mjs");
const { report } = await import("../src/report.mjs");
const r = await kitTest("watch", { backends: ["fake"], timeoutSeconds: 60 });

const [shot, ask] = r.results;
assert.equal(shot.id, "duty-shot");
assert.ok(shot.pass, JSON.stringify(shot));
assert.equal(shot.noModel, true, "the do question ran as a shot");
assert.equal(shot.cells, 1);
assert.equal(shot.costUsd, null);
assert.ok(ask.pass, JSON.stringify(ask));
assert.equal(ask.noModel, false);
assert.equal(ask.cells, 1, "the model question ran one cell");
assert.equal(fake.requests.length, 2, "only the model question reached the backend");
const s = r.summary[0];
assert.deepEqual([s.passed, s.of, s.cells, s.noModel], [2, 2, 2, 1]);

const rep = report({ since: "1h" });
assert.equal(rep.asks, 2);
assert.equal(rep.shots, 1);
assert.equal(rep.noModelShare, 0.5);

if (process.env.KITTEST_SHOW) console.log(JSON.stringify({ summary: r.summary, results: r.results.map(({ answer, ...x }) => x), report: { asks: rep.asks, shots: rep.shots, noModelShare: rep.noModelShare } }, null, 1));
await fake.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log("ok");
process.exit(0);
