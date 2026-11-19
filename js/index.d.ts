/** Task id (1-7) as used in the experiments. */
export type TaskId = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** Readable alias for a task id. */
export type TaskKey =
  | "cluster-identification"
  | "spatial-distribution"
  | "dispersion-estimation"
  | "outlier-detection"
  | "correlation-identification"
  | "quantity-comparison"
  | "proximity-judgment";

/**
 * Which analysis task(s) to optimize for: one task, a weighted mix
 * (`{ "outlier-detection": 0.6, 1: 0.4 }`), or null for all tasks equally.
 */
export type TaskSpec = TaskId | TaskKey | { [task: string]: number } | null;

export type Encoding = "color" | "shape" | "redundant";
export type Lab = [L: number, a: number, b: number];

export interface Exclude {
  /** Ids (0-38) of shapes to avoid. */
  shapeIds?: number[];
  /** Hex colors to avoid; generated colors stay at least ΔE 25 away. */
  hexCodes?: string[];
}

export interface RecommendOptions {
  /** Number of categories, 2-10. */
  k: number;
  /** Default: null (all tasks equally). */
  task?: TaskSpec;
  /** Default: "color". "all" considers all three encodings. */
  enc?: Encoding | "all" | Encoding[];
  /** Number of palettes to return. Default 5. */
  top?: number;
  /** Integer seed for reproducible results. */
  rngSeed?: number | null;
  exclude?: Exclude;
  /**
   * Shape ids that must appear. If more than `k` are given, the results are
   * `k`-sized subsets of them, best first.
   */
  pinShapes?: number[];
  /**
   * Hex colors that must appear in every palette. If more than `k` are given,
   * the results are `k`-sized subsets of them, best first.
   */
  pinHex?: string[];
  /** Color construction attempts per pass. Default 20. */
  nRuns?: number;
  /** Start every palette from this L*a*b* color. */
  seed?: Lab | null;
}

export interface Palette {
  enc: Encoding;
  /** Predicted accuracy: mean pairwise accuracy, where 0.5 is chance. */
  score: number;
  /** Colors as "#RRGGBB"; null for shape-only results. */
  colorHex: string[] | null;
  /** L*a*b* values of the colors; null for shape-only results. */
  colorLabs: Lab[] | null;
  /** Shape ids; get artwork with `shapeSvg(id)`. */
  shapeIds: number[] | null;
  /** Mean pairwise ΔE76 between the colors. */
  meanDe?: number;
}

export interface SwapOptions {
  /** Number of categories in the palette being edited, 2-10. */
  k: number;
  task?: TaskSpec;
  top?: number;
  exclude?: Exclude;
  /** Color swaps: how many candidates to sample. Default 500. */
  nSamples?: number;
  rngSeed?: number | null;
}

export interface Swap {
  /** Score of the palette with this replacement. */
  score: number;
  /** Change in score relative to the palette being edited. */
  delta: number;
  /** Id of the replacement shape. */
  id?: number;
  hex?: string;
  /** L*a*b* of the replacement color. */
  labs?: Lab;
}

export interface Task { readonly id: TaskId; readonly key: TaskKey; readonly name: string; }
export interface PoolShape { id: number; type: "fill" | "open" | "unfill"; mean_acc: number; beta: number; }

/** Recommend palettes, best first, using the bundled model. */
export function recommend(options: RecommendOptions): Palette[];
/** Score replacements for one color or shape of a result, best first. */
export function suggestSwap(result: Palette, slotType: "color" | "shape", slotIdx: number, options: SwapOptions): Swap[];
/** The 39 shapes tested in the experiments. */
export function getShapePool(): PoolShape[];
/** SVG markup for a shape id (0-38), optionally drawn in a CSS color. */
export function shapeSvg(id: number, options?: { color?: string | null }): string;
/** The shared model instance built from the bundled data. */
export function getModel(): CatPAL;

/** The model class, for use with your own copy of the model data. */
export class CatPAL {
  constructor(data: object);
  recommend(options: RecommendOptions): Palette[];
  suggestSwap(result: Palette, slotType: "color" | "shape", slotIdx: number, options: SwapOptions): Swap[];
  getShapePool(): PoolShape[];
}

/** The bundled model data, fitted from the crowdsourced experiments. */
export const modelData: object;
export const TASKS: readonly Task[];

export class SeededRng {
  constructor(seed: number);
  nextFloat(): number;
  uniform(lo: number, hi: number): number;
}

export function hexToLab(hex: string): Lab | null;
export function labToHex(L: number, a: number, b: number): string;
export function deltaE76(lab1: Lab, lab2: Lab): number;
/** Snap a palette size (2-10) to the sizes the model was fitted on (3, 6, 9). */
export function mapK(k: number): 3 | 6 | 9;
export function resolveTask(task: TaskSpec | undefined): null | TaskId | { [id: number]: number };
