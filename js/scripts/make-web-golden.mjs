// Regenerates tests/golden/web-engine.json — what the CatPAL web tool's engine
// returns for the shared test cases when Math.random is replaced by a fixed
// sequence. test/reference.test.mjs checks the library against this file.
//
// Needs a copy of the web tool's engine (catpal_model.js), which is not part of
// this repository:
//   npm run build && node scripts/make-web-golden.mjs /path/to/catpal_model.js
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { modelData, resolveTask } from "../dist/index.mjs";
import { allCases, runCase } from "../test/cases.mjs";
import { withFixedRandom } from "../test/fixed-random.mjs";

const enginePath = process.argv[2];
if (!enginePath) {
  console.error("usage: node scripts/make-web-golden.mjs /path/to/catpal_model.js");
  process.exit(1);
}
const mod = { exports: {} };
new Function("module", "exports", readFileSync(enginePath, "utf8"))(mod, mod.exports);
const web = new mod.exports.CatPAL(modelData);

// Translate library options into the web engine's: it has no rngSeed or task
// keys, calls pinHex "preferredHex", and needs its mode and encoding spelled out.
function forWeb(opts) {
  const { rngSeed, pinHex, ...rest } = opts;
  if (pinHex !== undefined) rest.preferredHex = pinHex;
  return { ...rest, task: resolveTask(rest.task), mode: "unseen", enc: rest.enc ?? "color" };
}
// Keep only the fields the library reports.
const FIELDS = ["enc", "score", "meanDe", "colorLabs", "colorHex", "shapeIds", "id", "hex", "labs", "delta"];
const plain = rows => JSON.parse(JSON.stringify(rows)).map(r =>
  Object.fromEntries(FIELDS.filter(f => f in r).map(f => [f, r[f]])));

const cases = allCases.map(c => {
  const w = { ...c, opts: forWeb(c.opts), ...(c.base ? { base: forWeb(c.base) } : {}) };
  return { name: c.name, expected: plain(withFixedRandom(() => runCase(web, w))) };
});
const out = resolve(dirname(fileURLToPath(import.meta.url)), "../../tests/golden/web-engine.json");
writeFileSync(out, JSON.stringify(cases, null, 1) + "\n");
console.log(`wrote ${cases.length} cases to ${out}`);
