// Fidelity to the paper's tool: with the same random numbers, the library
// engine must return exactly what the web tool's engine returns.
// tests/golden/web-engine.json holds the web engine's outputs, recorded by
// scripts/make-web-golden.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CatPAL, modelData } from "../dist/index.mjs";
import { allCases, runCase } from "./cases.mjs";
import { withFixedRandom } from "./fixed-random.mjs";

const recorded = JSON.parse(readFileSync(new URL("../../tests/golden/web-engine.json", import.meta.url)));
const lib = new CatPAL(modelData);

// Both engines must draw from the same stubbed Math.random, so no rngSeed.
const noSeed = ({ rngSeed, ...rest }) => rest;

test("web-engine file covers every case", () => {
  assert.deepEqual(recorded.map(c => c.name), allCases.map(c => c.name));
});

for (const [i, c] of allCases.entries()) {
  test(`matches web engine: ${c.name}`, () => {
    const s = { ...c, opts: noSeed(c.opts), ...(c.base ? { base: noSeed(c.base) } : {}) };
    const got = JSON.parse(JSON.stringify(withFixedRandom(() => runCase(lib, s))));
    assert.ok(recorded[i].expected.length > 0, "web engine returned no results");
    assert.deepEqual(got, recorded[i].expected);
  });
}
