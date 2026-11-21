// The kits page reads a script's purpose from its source text; a shared kit's code is never run.
import assert from "node:assert/strict";
import { purposeOf } from "../src/gallery.mjs";

assert.equal(purposeOf('export const meta = { purpose: "Who is on duty tonight.", params: {} };'), "Who is on duty tonight.");
assert.equal(purposeOf("export const meta = {\n  purpose:\n    'The watch\\'s roster, by shift.',\n};"), "The watch's roster, by shift.");
assert.equal(purposeOf("export const meta = { purpose: `Open cases\n  with their owner` };"), "Open cases with their owner");
assert.equal(purposeOf('export const meta = { purpose: "Says \\"halt\\" once" };'), 'Says "halt" once');
assert.equal(purposeOf("export default async function () {}"), "");
assert.equal(purposeOf(null), "");
console.log("ok");
