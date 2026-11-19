// The library must reproduce the shared golden outputs exactly. The Python
// package is tested against the same file, which keeps the two in step.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as api from "../dist/index.mjs";
import { allCases, runCase } from "./cases.mjs";

const golden = JSON.parse(readFileSync(new URL("../../tests/golden/cases.json", import.meta.url)));

test("golden file covers every case", () => {
  assert.deepEqual(golden.map(c => c.name), allCases.map(c => c.name));
});

for (const [i, c] of allCases.entries()) {
  test(`golden: ${c.name}`, () => {
    const got = JSON.parse(JSON.stringify(runCase(api, c)));
    assert.deepEqual(got, golden[i].expected);
  });
}
