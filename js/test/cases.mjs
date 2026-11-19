// Shared test inputs. `recommend` cases are option objects; `swap` cases take a
// base recommendation and ask for replacements for one slot.
const R = (name, opts) => ({ name, kind: "recommend", opts });

export const recommendCases = [
  // Colors
  R("color, task 1, k=3", { task: 1, k: 3, enc: "color", nRuns: 8, rngSeed: 11 }),
  R("color, task 4, k=6, defaults", { task: 4, k: 6, rngSeed: 1 }),
  R("color, task 7, k=9", { task: 7, k: 9, enc: "color", nRuns: 6, top: 3, rngSeed: 5 }),
  R("color, all tasks, k=5", { task: null, k: 5, enc: "color", nRuns: 6, rngSeed: 21 }),
  R("color, weighted tasks by key", { task: { "outlier-detection": 0.6, "cluster-identification": 0.4 }, k: 6, enc: "color", nRuns: 6, rngSeed: 3 }),
  R("color, weighted tasks by id, k=2", { task: { 2: 1, 5: 3 }, k: 2, enc: "color", nRuns: 6, rngSeed: 8 }),
  R("color, k=10", { task: 3, k: 10, enc: "color", nRuns: 4, top: 2, rngSeed: 13 }),
  R("color, explicit Lab seed", { task: 3, k: 6, enc: "color", seed: [55, 30, -15] }),
  R("color, must-include colors", { task: 2, k: 6, enc: "color", nRuns: 6, pinHex: ["#1f77b4", "#ff7f0e"], rngSeed: 4 }),
  R("color, must-include equals k", { task: 2, k: 3, enc: "color", pinHex: ["#1f77b4", "#ff7f0e", "#2ca02c"], rngSeed: 4 }),
  R("color, must-include exceeds k", { task: 6, k: 3, enc: "color", pinHex: ["#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd"], rngSeed: 4 }),
  R("color, exclude hex", { task: 5, k: 6, enc: "color", nRuns: 8, exclude: { hexCodes: ["#4B0082", "#FF4500"] }, rngSeed: 9 }),
  // Shapes and redundant
  R("shape, k=3 (enumerated)", { task: 2, k: 3, enc: "shape", rngSeed: 1 }),
  R("shape, k=6 (sampled)", { task: 6, k: 6, enc: "shape", rngSeed: 17 }),
  R("shape, pinned, small fill", { task: 3, k: 5, enc: "shape", pinShapes: [2, 14], rngSeed: 17 }),
  R("shape, pinned, large fill", { task: 3, k: 8, enc: "shape", pinShapes: [2, 14], rngSeed: 17 }),
  R("shape, pinned equals k", { task: 3, k: 3, enc: "shape", pinShapes: [2, 14, 30], rngSeed: 17 }),
  R("shape, pinned exceeds k", { task: 3, k: 3, enc: "shape", pinShapes: [2, 14, 30, 31, 5], rngSeed: 17 }),
  R("shape, exclude shapes", { task: 7, k: 4, enc: "shape", exclude: { shapeIds: [0, 1, 2, 3, 4, 5] }, rngSeed: 17 }),
  R("redundant, k=6", { task: 4, k: 6, enc: "redundant", nRuns: 6, rngSeed: 31 }),
  R("redundant, all tasks, k=3", { task: null, k: 3, enc: "redundant", nRuns: 6, rngSeed: 32 }),
  R("all encodings", { task: 5, k: 6, enc: "all", nRuns: 6, top: 6, rngSeed: 33 }),
  R("color and shape", { task: 5, k: 4, enc: ["color", "shape"], nRuns: 6, top: 8, rngSeed: 34 }),
];

// base: options for the recommendation whose first result is edited.
export const swapCases = [
  { name: "swap a generated color", kind: "swap", base: { task: 4, k: 6, enc: "color", nRuns: 6, rngSeed: 1 },
    slotType: "color", slotIdx: 0, opts: { task: 4, k: 6, top: 4, nSamples: 300, rngSeed: 77 } },
  { name: "swap a shape", kind: "swap", base: { task: 6, k: 4, enc: "shape", rngSeed: 17 },
    slotType: "shape", slotIdx: 3, opts: { task: { 6: 1, 1: 1 }, k: 4, top: 6, exclude: { shapeIds: [9] } } },
];

export const allCases = [...recommendCases, ...swapCases];

export function runCase(api, c) {
  if (c.kind === "recommend") return api.recommend(c.opts);
  const base = api.recommend(c.base)[0];
  return api.suggestSwap(base, c.slotType, c.slotIdx, c.opts);
}
