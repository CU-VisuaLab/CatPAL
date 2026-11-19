import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import * as api from "../dist/index.mjs";

const require = createRequire(import.meta.url);
const read = p => readFileSync(new URL(p, import.meta.url), "utf8");

test("CommonJS build exposes the same API", () => {
  const cjs = require("../dist/index.cjs");
  assert.deepEqual(Object.keys(cjs).sort(), Object.keys(api).sort());
  assert.deepEqual(cjs.recommend({ task: 4, k: 6, rngSeed: 1 }), api.recommend({ task: 4, k: 6, rngSeed: 1 }));
});

test("browser build defines a catpal global", () => {
  const scope = {};
  new Function("globalThis", read("../dist/catpal.global.js") + "; globalThis.catpal = catpal;")(scope);
  assert.equal(scope.catpal.recommend({ task: 4, k: 6, rngSeed: 1 }).length, 5);
});

test("defaults: generated color palettes, five results", () => {
  const r = api.recommend({ k: 4, rngSeed: 2 });
  assert.equal(r.length, 5);
  for (const p of r) {
    assert.equal(p.enc, "color");
    assert.equal(p.colorHex.length, 4);
    assert.ok(p.colorHex.every(h => /^#[0-9A-F]{6}$/.test(h)));
    assert.ok(p.score > 0.5 && p.score <= 1);
  }
});

test("rngSeed makes results reproducible; omitting it does not crash", () => {
  const o = { task: 2, k: 7, enc: "all", nRuns: 4, rngSeed: 42 };
  assert.deepEqual(api.recommend(o), api.recommend(o));
  assert.ok(api.recommend({ task: 2, k: 7, enc: "all", nRuns: 4 }).length > 0);
});

test("task keys and ids are interchangeable", () => {
  const byKey = api.recommend({ task: "Outlier Detection", k: 5, nRuns: 4, rngSeed: 3 });
  const byId = api.recommend({ task: 4, k: 5, nRuns: 4, rngSeed: 3 });
  assert.deepEqual(byKey, byId);
  assert.equal(api.TASKS.length, 7);
});

test("generated palettes keep colors apart", () => {
  for (const p of api.recommend({ task: 1, k: 8, nRuns: 4, rngSeed: 5 })) {
    for (let i = 0; i < p.colorLabs.length; i++)
      for (let j = i + 1; j < p.colorLabs.length; j++)
        assert.ok(api.deltaE76(p.colorLabs[i], p.colorLabs[j]) >= 25);
  }
});

test("invalid options are rejected with clear errors", () => {
  const bad = [
    [{}, /k \(number of categories\)/],
    [{ k: 11 }, /k \(number of categories\)/],
    [{ k: 6, task: 8 }, /unknown task/],
    [{ k: 6, task: "nope" }, /unknown task/],
    [{ k: 6, task: { 1: -1 } }, /non-negative/],
    [{ k: 6, enc: "colour" }, /enc must be/],
    [{ k: 6, top: 0 }, /top must be/],
    [{ k: 6, rngSeed: 1.5 }, /rngSeed/],
    [{ k: 6, pinHex: ["red"] }, /invalid hex/],
    [{ k: 6, exclude: { hexCodes: ["#12"] } }, /invalid hex/],
    [{ k: 6, exclude: { shapeIds: [39] } }, /invalid id/],
    [{ k: 6, seed: [1, 2] }, /seed must be/],
  ];
  for (const [opts, re] of bad) assert.throws(() => api.recommend(opts), re, JSON.stringify(opts));
  assert.throws(() => api.recommend(null), /options must be an object/);
});

test("shape pool and artwork", () => {
  assert.equal(api.getShapePool().length, 39);
  for (let id = 0; id < 39; id++) assert.match(api.shapeSvg(id), /<svg[\s\S]*<\/svg>$/);
  const red = api.shapeSvg(13, { color: "#ff0000" });
  assert.ok(red.includes('fill="#ff0000"') && red.includes("stroke: #ff0000") && !red.includes("#000"));
  assert.throws(() => api.shapeSvg(39), /unknown shape id/);
});

test("color conversions round-trip", () => {
  for (const hex of ["#000000", "#FFFFFF", "#1F77B4", "#D62728", "#7FC97F"]) {
    const [L, a, b] = api.hexToLab(hex);
    assert.equal(api.labToHex(L, a, b), hex);
  }
});

test("package copies of the data match the canonical files", () => {
  for (const f of ["catpal_model_data.json", "shapes.json"])
    assert.equal(read(`../data/${f}`), read(`../../data/${f}`), f);
});
