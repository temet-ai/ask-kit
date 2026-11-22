// A search worker: parses the sessions it is given and returns their matching events. Each worker
// keeps its own parse cache, and a session always goes to the same worker (index.mjs), so a later
// search over the same sessions parses nothing here either.
import { parentPort } from "node:worker_threads";
import { scanSessions } from "./index.mjs";

parentPort.on("message", async ({ id, sessions, spec, deadline }) => {
  try {
    parentPort.postMessage({ id, result: await scanSessions(sessions, spec, deadline) });
  } catch (e) {
    parentPort.postMessage({ id, error: String(e?.message ?? e) });
  }
});
