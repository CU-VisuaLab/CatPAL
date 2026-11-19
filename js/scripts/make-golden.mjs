// Regenerates tests/golden/cases.json — the expected outputs shared by the
// JavaScript and Python test suites. Run only when a behavior change is intended:
//   npm run build && node scripts/make-golden.mjs
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as api from "../dist/index.mjs";
import { allCases, runCase } from "../test/cases.mjs";

const out = resolve(dirname(fileURLToPath(import.meta.url)), "../../tests/golden/cases.json");
const cases = allCases.map(c => ({ ...c, expected: runCase(api, c) }));
writeFileSync(out, JSON.stringify(cases, null, 1) + "\n");
console.log(`wrote ${cases.length} cases to ${out}`);
