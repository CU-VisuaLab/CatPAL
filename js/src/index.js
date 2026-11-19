/**
 * catpal — task-aware categorical palette recommendation.
 *
 * The model data is bundled, so the top-level functions work out of the box:
 *
 *   import { recommend } from "catpal";
 *   const palettes = recommend({ task: "outlier-detection", k: 6 });
 */
import modelData from "../data/catpal_model_data.json";
import shapeSvgs from "../data/shapes.json";
import {
  CatPAL, TASKS, SeededRng,
  mapK, labToHex, hexToLab, deltaE76, resolveTask,
} from "./engine.js";

let defaultModel = null;

/** The shared model instance built from the bundled data. */
function getModel() {
  if (!defaultModel) defaultModel = new CatPAL(modelData);
  return defaultModel;
}

/** Recommend palettes. See the README for options and the result shape. */
function recommend(options = {}) {
  return getModel().recommend(options);
}

/** Score single-slot replacements for one color or shape of a result. */
function suggestSwap(result, slotType, slotIdx, options) {
  return getModel().suggestSwap(result, slotType, slotIdx, options);
}

/** The 39 shapes tested in the experiments. */
function getShapePool() {
  return getModel().getShapePool();
}

/**
 * SVG markup for a shape id (0-38), as returned in a result's `shapeIds`.
 * Pass `color` to draw it in that color instead of black.
 */
function shapeSvg(id, { color = null } = {}) {
  const svg = shapeSvgs[String(id)];
  if (svg === undefined) throw new RangeError(`CatPAL: unknown shape id ${JSON.stringify(id)} (expected 0-38).`);
  if (!color) return svg;
  if (typeof color !== "string" || /["<>]/.test(color)) throw new TypeError("CatPAL: color must be a CSS color string.");
  return svg.replace(/#000\b/g, color).replace("<svg ", `<svg fill="${color}" `);
}

export {
  recommend, suggestSwap, getShapePool, shapeSvg, getModel,
  CatPAL, modelData, TASKS, SeededRng,
  mapK, labToHex, hexToLab, deltaE76, resolveTask,
};
