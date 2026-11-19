/**
 * CatPAL recommendation engine.
 *
 * Task-aware recommendation of categorical palettes (color, shape, or redundant
 * color + shape) from a model fitted to crowdsourced experiments. This is the
 * engine behind the CatPAL web tool, with two additions for library use:
 * input validation, and an optional `rngSeed` for reproducible results.
 * Colors are always generated fresh (the web tool's behavior); shapes come
 * from the 39 tested shapes.
 *
 * See the README for the public API. Methods and functions prefixed with an
 * underscore are internal.
 */

// ═══════════════════════════════════════════════════════════════════════════════
// COLOUR SCIENCE UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

function deltaE76(lab1, lab2) {
  const dL = lab1[0] - lab2[0];
  const da = lab1[1] - lab2[1];
  const db = lab1[2] - lab2[2];
  return Math.sqrt(dL*dL + da*da + db*db);
}

// Cosine similarity between two Sets of IDs (binary palette vectors).
// For same-size palettes of k items: cosineSim = |intersection| / k
function cosineSim(setA, setB) {
  if (!setA.size || !setB.size) return 0;
  let dot = 0;
  for (const id of setA) if (setB.has(id)) dot++;
  return dot / Math.sqrt(setA.size * setB.size);
}

// Visual distance between two palettes via greedy min-ΔE matching.
// Returns average ΔE76 of the best one-to-one assignment (O(k²)).
function paletteLabDistance(labsA, labsB) {
  const used = new Set();
  let sum = 0;
  for (const a of labsA) {
    let best = Infinity, bestJ = 0;
    labsB.forEach((b, j) => {
      if (!used.has(j)) { const d = deltaE76(a, b); if (d < best) { best = d; bestJ = j; } }
    });
    used.add(bestJ);
    sum += best;
  }
  return sum / labsA.length;
}

function labToHex(L, a, b) {
  // L*a*b* → XYZ (D65)
  const fy = (L + 16) / 116;
  const fx = a / 500 + fy;
  const fz = fy - b / 200;
  const invF = t => t > 0.206897 ? t*t*t : (t - 16/116) / 7.787;
  const X = invF(fx) * 0.95047;
  const Y = invF(fy) * 1.00000;
  const Z = invF(fz) * 1.08883;
  // XYZ → linear sRGB
  let r =  X * 3.2404542 - Y * 1.5371385 - Z * 0.4985314;
  let g = -X * 0.9692660 + Y * 1.8760108 + Z * 0.0415560;
  let bv = X * 0.0556434 - Y * 0.2040259 + Z * 1.0572252;
  // Gamma
  const gamma = c => {
    c = Math.max(0, Math.min(1, c));
    return c > 0.0031308 ? 1.055 * Math.pow(c, 1/2.4) - 0.055 : 12.92 * c;
  };
  r = gamma(r); g = gamma(g); bv = gamma(bv);
  const toHex = v => Math.round(v * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(bv)}`.toUpperCase();
}

function hexToLab(hex) {
  if (!hex) return null;
  hex = hex.replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return null;
  const r = parseInt(hex.slice(0,2), 16) / 255;
  const g = parseInt(hex.slice(2,4), 16) / 255;
  const bv = parseInt(hex.slice(4,6), 16) / 255;
  // sRGB → linear
  const lin = c => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  const rl = lin(r), gl = lin(g), bl = lin(bv);
  // → XYZ
  const X = rl*0.4124564 + gl*0.3575761 + bl*0.1804375;
  const Y = rl*0.2126729 + gl*0.7151522 + bl*0.0721750;
  const Z = rl*0.0193339 + gl*0.1191920 + bl*0.9503041;
  // → L*a*b*
  const f = t => t > 0.008856 ? Math.cbrt(t) : 7.787*t + 16/116;
  const fx = f(X/0.95047), fy = f(Y/1.00000), fz = f(Z/1.08883);
  return [116*fy - 16, 500*(fx-fy), 200*(fy-fz)];
}

function mapK(k) {
  if (k <= 4) return 3;
  if (k <= 7) return 6;
  return 9;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SIMPLE SEEDED PRNG  (matches numpy.random.default_rng determinism)
// We use a simple xoshiro256** port so runs are reproducible in the browser.
// Note: exact float values will differ slightly from NumPy's PCG64, so
// "same as catpal_evaluate" is approximate in the browser.
// ═══════════════════════════════════════════════════════════════════════════════

class SeededRng {
  constructor(seed) {
    // Splitmix64-inspired 64-bit seed expansion → 4 × 32-bit state
    let s = (BigInt(seed) & 0xFFFFFFFFFFFFFFFFn);
    const next64 = () => {
      s = (s + 0x9e3779b97f4a7c15n) & 0xFFFFFFFFFFFFFFFFn;
      let z = s;
      z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & 0xFFFFFFFFFFFFFFFFn;
      z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & 0xFFFFFFFFFFFFFFFFn;
      return z ^ (z >> 31n);
    };
    const s0 = next64(), s1 = next64(), s2 = next64(), s3 = next64();
    this._s = [
      Number(s0 & 0xFFFFFFFFn), Number(s0 >> 32n),
      Number(s1 & 0xFFFFFFFFn), Number(s1 >> 32n),
    ];
  }
  // Returns float in [0, 1)
  nextFloat() {
    const [a, b, c, d] = this._s;
    const result = ((a ^ c) >>> 0);
    const t = (b << 9) >>> 0;
    this._s[2] = (this._s[2] ^ this._s[0]) >>> 0;
    this._s[3] = (this._s[3] ^ this._s[1]) >>> 0;
    this._s[1] = (this._s[1] ^ this._s[2]) >>> 0;
    this._s[0] = (this._s[0] ^ this._s[3]) >>> 0;
    this._s[2] = (this._s[2] ^ t) >>> 0;
    this._s[3] = ((this._s[3] << 11) | (this._s[3] >>> 21)) >>> 0;
    return result / 4294967296;
  }
  uniform(lo, hi) { return lo + this.nextFloat() * (hi - lo); }
}

// Source of the engine's unseeded random draws. With an integer rngSeed the
// stream is deterministic; without one it falls back to Math.random.
function makeRand(rngSeed) {
  if (rngSeed === null || rngSeed === undefined) return Math.random;
  const rng = new SeededRng(rngSeed);
  return () => rng.nextFloat();
}

// Sample one L*a*b* colour uniformly from the given lightness and chroma ranges.
function sampleLab(rng, Llo, Lhi, Clo, Chi) {
  const Ls = rng.uniform(Llo, Lhi);
  const Cs = rng.uniform(Clo, Chi);
  const hr = rng.uniform(0, 360) * Math.PI / 180;
  return [Ls, Cs * Math.cos(hr), Cs * Math.sin(hr)];
}

function randomSeedLab(runIdx, k) {
  const rngSeed = runIdx * 17 + k;
  const rng = new SeededRng(rngSeed);
  return sampleLab(rng, 20, 80, 20, 60);
}

// ═══════════════════════════════════════════════════════════════════════════════
// TASKS AND OPTION VALIDATION
// ═══════════════════════════════════════════════════════════════════════════════

// The seven analysis tasks from the experiments. `id` is what the model data is
// keyed by; `key` is a readable alias accepted anywhere a task id is.
const TASKS = Object.freeze([
  { id: 1, key: "cluster-identification",     name: "Cluster identification" },
  { id: 2, key: "spatial-distribution",       name: "Spatial distribution" },
  { id: 3, key: "dispersion-estimation",      name: "Dispersion estimation" },
  { id: 4, key: "outlier-detection",          name: "Outlier detection" },
  { id: 5, key: "correlation-identification", name: "Correlation identification" },
  { id: 6, key: "quantity-comparison",        name: "Quantity comparison" },
  { id: 7, key: "proximity-judgment",         name: "Proximity judgment" },
].map(Object.freeze));

const ENCODINGS = ["color", "shape", "redundant"];
const HEX_RE = /^#?[0-9a-fA-F]{6}$/;

function taskId(t) {
  if (typeof t === "string" && /^[1-7]$/.test(t.trim())) t = Number(t);
  if (typeof t === "number") {
    if (Number.isInteger(t) && t >= 1 && t <= 7) return t;
  } else if (typeof t === "string") {
    const norm = t.trim().toLowerCase().replace(/[\s_]+/g, "-");
    const hit = TASKS.find(x => x.key === norm);
    if (hit) return hit.id;
  }
  throw new RangeError(
    `CatPAL: unknown task ${JSON.stringify(t)}. Use an id 1-7 or one of: ${TASKS.map(x => x.key).join(", ")}.`);
}

// task: null/undefined (all tasks equally) | id or key | {idOrKey: weight, ...}
// → null | id | {id: weight}
function resolveTask(task) {
  if (task === null || task === undefined) return null;
  if (typeof task === "number" || typeof task === "string") return taskId(task);
  if (typeof task === "object" && !Array.isArray(task)) {
    const out = {};
    for (const [t, w] of Object.entries(task)) {
      if (typeof w !== "number" || !isFinite(w) || w < 0)
        throw new RangeError(`CatPAL: task weight for ${JSON.stringify(t)} must be a non-negative number.`);
      const id = taskId(t);
      out[id] = (out[id] ?? 0) + w;
    }
    if (!Object.values(out).some(w => w > 0))
      throw new RangeError("CatPAL: task weights must include at least one positive weight.");
    return out;
  }
  throw new TypeError("CatPAL: task must be an id (1-7), a task key, an object of weights, or null.");
}

function checkHexList(list, label) {
  if (!Array.isArray(list)) throw new TypeError(`CatPAL: ${label} must be an array of hex colors.`);
  for (const h of list)
    if (typeof h !== "string" || !HEX_RE.test(h))
      throw new RangeError(`CatPAL: ${label} contains an invalid hex color: ${JSON.stringify(h)}.`);
}

function checkIdList(list, label, n = 39) {
  if (!Array.isArray(list)) throw new TypeError(`CatPAL: ${label} must be an array of ids.`);
  for (const id of list)
    if (!Number.isInteger(id) || id < 0 || id >= n)
      throw new RangeError(`CatPAL: ${label} contains an invalid id: ${JSON.stringify(id)} (expected 0-${n - 1}).`);
}

// Validate options and fill defaults. Returns a new object; never mutates input.
function normalizeOptions(opts, { forSwap = false } = {}) {
  if (opts === null || typeof opts !== "object" || Array.isArray(opts))
    throw new TypeError("CatPAL: options must be an object.");
  const o = { ...opts };
  o.task = resolveTask(o.task);

  if (!Number.isInteger(o.k) || o.k < 2 || o.k > 10)
    throw new RangeError(`CatPAL: k (number of categories) must be an integer from 2 to 10; got ${JSON.stringify(o.k)}.`);
  if (o.top !== undefined && (!Number.isInteger(o.top) || o.top < 1))
    throw new RangeError("CatPAL: top must be a positive integer.");
  if (o.rngSeed !== undefined && o.rngSeed !== null &&
      (!Number.isSafeInteger(o.rngSeed) || o.rngSeed < 0))
    throw new RangeError("CatPAL: rngSeed must be a non-negative integer.");

  const ex = o.exclude ?? {};
  if (typeof ex !== "object" || Array.isArray(ex))
    throw new TypeError("CatPAL: exclude must be an object with shapeIds and/or hexCodes.");
  o.exclude = { shapeIds: ex.shapeIds ?? [], hexCodes: ex.hexCodes ?? [] };
  checkIdList(o.exclude.shapeIds, "exclude.shapeIds");
  checkHexList(o.exclude.hexCodes, "exclude.hexCodes");
  if (forSwap) return o;

  o.enc = o.enc ?? "color";
  for (const e of (Array.isArray(o.enc) ? o.enc : [o.enc]))
    if (e !== "all" && !ENCODINGS.includes(e))
      throw new RangeError(`CatPAL: enc must be "color", "shape", "redundant", "all", or an array of the first three; got ${JSON.stringify(e)}.`);
  if (Array.isArray(o.enc) && o.enc.includes("all")) o.enc = "all";

  if (o.nRuns !== undefined && (!Number.isInteger(o.nRuns) || o.nRuns < 1))
    throw new RangeError("CatPAL: nRuns must be a positive integer.");
  if (o.pinShapes !== undefined) checkIdList(o.pinShapes, "pinShapes");
  if (o.pinHex !== undefined) checkHexList(o.pinHex, "pinHex");
  if (o.seed !== undefined && o.seed !== null &&
      !(Array.isArray(o.seed) && o.seed.length === 3 && o.seed.every(v => typeof v === "number" && isFinite(v))))
    throw new TypeError("CatPAL: seed must be an [L, a, b] array of three numbers.");
  return o;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN MODEL CLASS
// ═══════════════════════════════════════════════════════════════════════════════

class CatPAL {
  /**
   * @param {Object} data — the model data (parsed catpal_model_data.json)
   */
  constructor(data) {
    this.colors       = data.colors;          // array, indexed by id
    this.shapes       = data.shapes;
    this.pwColor      = data.pairwise_color;  // "i-j-t-k" → acc
    this.pwShape      = data.pairwise_shape;
    this.btBetaColor  = data.bt_task_betas_color;   // "t-id" → beta
    this.btBetaShape  = data.bt_task_betas_shape;
    this.btAlphaColor = data.bt_task_alphas_color;  // "t" → alpha
    this.btAlphaShape = data.bt_task_alphas_shape;
    this.gee          = data.gee_coefficients;
    this.deltaG       = data.delta_g;         // array of {quadrant, task_id, k, delta_g, ...}

    this._shapeById = {};
    for (const s of this.shapes) this._shapeById[s.id] = s;

    // Build delta_g lookup: "quadrant-task-k" → delta_g
    // The data names quadrants "Q1_SC_SS" … "Q4_WC_WS"; lookups use "Q1" … "Q4".
    this._dgLookup = {};
    for (const row of (this.deltaG || [])) {
      const key = `${String(row.quadrant).split("_")[0]}-${row.task_id}-${row.k}`;
      this._dgLookup[key] = row.delta_g;
    }
  }

  // ── Task weight resolution ──────────────────────────────────────────────────
  _resolveTaskWeights(task) {
    if (task === null || task === undefined) {
      const w = 1/7;
      return {1:w,2:w,3:w,4:w,5:w,6:w,7:w};
    }
    if (typeof task === "number") return {[task]: 1.0};
    const total = Object.values(task).reduce((a,b)=>a+b, 0);
    const out = {};
    for (const [t, w] of Object.entries(task)) out[parseInt(t)] = w / total;
    return out;
  }

  // ── Pairwise accuracy lookup ────────────────────────────────────────────────
  _pwColorAcc(i, j, task, k) {
    const a = Math.min(i,j), b = Math.max(i,j);
    return this.pwColor[`${a}-${b}-${task}-${k}`] ?? null;
  }
  _pwShapeAcc(i, j, task, k) {
    const a = Math.min(i,j), b = Math.max(i,j);
    return this.pwShape[`${a}-${b}-${task}-${k}`] ?? null;
  }

  // ── Mean pairwise accuracy for a set ───────────────────────────────────────
  _meanPwShape(ids, task, k) {
    let sum = 0, cnt = 0;
    for (let x = 0; x < ids.length; x++) {
      for (let y = x+1; y < ids.length; y++) {
        const acc = this._pwShapeAcc(ids[x], ids[y], task, k);
        if (acc !== null) { sum += acc; cnt++; }
      }
    }
    return cnt > 0 ? sum / cnt : 0.5;
  }

  // ── GEE scoring  (kept for reference; NOT used for ranking) ──────────────────
  // The GEE sigmoid saturates to ~1.0 for any reasonable palette because the
  // mean_pairwise_acc coefficient (29.78) is very large.  Using it for ranking
  // produces identical scores and random ordering.
  _geeScore(meanPwAcc, encColor, logK, taskId) {
    const coef = this.gee;
    let logit = coef.intercept
              + coef.mean_pairwise_acc * meanPwAcc
              + coef.enc_color * encColor
              + coef.log_k * logK;
    if (taskId > 1) logit += coef.task[String(taskId)] || 0;
    return 1 / (1 + Math.exp(-logit));
  }

  // ── Score a pool shape set for one task ────────────────────────────────────
  _scoreShapeSet(ids, task, k) {
    return this._meanPwShape(ids, task, k);
  }

  // ── Weighted score across tasks ─────────────────────────────────────────────
  _wScore(scoreFn, ids, taskWeights, k) {
    let score = 0;
    for (const [t, w] of Object.entries(taskWeights)) {
      score += w * scoreFn(ids, parseInt(t), k);
    }
    return score;
  }

  // ── BT β weighted mean and threshold (for quadrant classification) ──────────
  _weightedMeanBeta(ids, taskWeights, betaLookup) {
    let sum = 0;
    for (const [t, w] of Object.entries(taskWeights)) {
      let taskBetaSum = 0;
      for (const id of ids) taskBetaSum += betaLookup[`${t}-${id}`] ?? 0;
      sum += w * (taskBetaSum / ids.length);
    }
    return sum;
  }
  _weightedBetaThreshold(taskWeights, betaLookup, nItems = 39) {
    let sum = 0;
    for (const [t, w] of Object.entries(taskWeights)) {
      const betas = [];
      for (let i = 0; i < nItems; i++) betas.push(betaLookup[`${t}-${i}`] ?? 0);
      betas.sort((a,b) => a-b);
      const mid = Math.floor(betas.length / 2);
      const median = betas.length % 2 === 0
        ? (betas[mid-1] + betas[mid]) / 2 : betas[mid];
      sum += w * median;
    }
    return sum;
  }

  // ── Delta G lookup ──────────────────────────────────────────────────────────
  _wDeltaG(quadrant, taskWeights, k) {
    let sum = 0;
    for (const [t, w] of Object.entries(taskWeights)) {
      sum += w * (this._dgLookup[`${quadrant}-${t}-${k}`] ?? 0);
    }
    return sum;
  }

  // ── Nearest pool color by ΔE ────────────────────────────────────────────────
  _nearestPoolId(lab) {
    let bestId = 0, bestDe = Infinity;
    for (const c of this.colors) {
      const de = deltaE76(lab, [c.L, c.a, c.b]);
      if (de < bestDe) { bestDe = de; bestId = c.id; }
    }
    return bestId;
  }

  // ── Generate all C(n, k) combinations ──────────────────────────────────────
  *_combinations(arr, k) {
    if (k === 0) { yield []; return; }
    for (let i = 0; i <= arr.length - k; i++) {
      for (const rest of this._combinations(arr.slice(i+1), k-1)) {
        yield [arr[i], ...rest];
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // PALETTE GENERATION
  // Colors: generated via random L*C*h* seeds + greedy construction (unseen).
  // Shapes: always from the 39-item pool (shapes are pool-only).
  // Redundant: pairs unseen colors with pool shapes; quadrant via nearest-pool proxy.
  // ══════════════════════════════════════════════════════════════════════════════

  // Greedy diversity filter.
  // Primary check: cosine similarity on proxy ID sets < threshold (default 0.5)
  //   AND, when getLabs is provided, palette ΔE distance ≥ minAvgDe (default 18).
  // Maximin fallback: when strict filtering leaves < top results, greedily pick
  //   the remaining candidate with the largest min-distance to any kept palette.
  _diverseFilter(candidates, top, getIdSet, getLabs = null, threshold = 0.5, minAvgDe = 18) {
    const kept = [], keptSets = [], keptLabs = [];

    const tooSimilar = (c) => {
      const ids = getIdSet(c);
      if (keptSets.some(ks => cosineSim(ids, ks) >= threshold)) return true;
      if (getLabs && keptLabs.length > 0) {
        const labs = getLabs(c);
        if (keptLabs.some(kl => paletteLabDistance(labs, kl) < minAvgDe)) return true;
      }
      return false;
    };

    for (const c of candidates) {
      if (kept.length >= top) break;
      if (!tooSimilar(c)) {
        kept.push(c);
        keptSets.push(getIdSet(c));
        if (getLabs) keptLabs.push(getLabs(c));
      }
    }

    // Maximin fallback: pick the remaining candidate most different from all kept
    const remaining = candidates.filter(c => !kept.includes(c));
    while (kept.length < top && remaining.length > 0) {
      let bestIdx = 0, bestDist = -Infinity;
      for (let i = 0; i < remaining.length; i++) {
        const dist = getLabs && keptLabs.length
          ? Math.min(...keptLabs.map(kl => paletteLabDistance(getLabs(remaining[i]), kl)))
          : 1 - Math.max(...keptSets.map(ks => cosineSim(getIdSet(remaining[i]), ks)));
        if (dist > bestDist) { bestDist = dist; bestIdx = i; }
      }
      const best = remaining.splice(bestIdx, 1)[0];
      kept.push(best);
      keptSets.push(getIdSet(best));
      if (getLabs) keptLabs.push(getLabs(best));
    }
    return kept;
  }

  _unseenMode(opts) {
    const {
      task, k, enc,
      exclude = {},
      top = 5,
      nRuns = 20,
      seed = null,
      pinHex = [],
      pinShapes = [],
      rngSeed = null,
    } = opts;
    const rand = makeRand(rngSeed);

    const km = mapK(k);
    const taskWeights = this._resolveTaskWeights(task);
    const refTask = parseInt(Object.keys(taskWeights)[0]);
    const allowed = enc === "all" ? new Set(["color","shape","redundant"])
                  : new Set(Array.isArray(enc) ? enc : [enc]);

    // ── Exclude: L*a*b* reference points for ΔE filtering (unseen colors) ──────
    const excLabs = [];
    for (const hex of (exclude.hexCodes || [])) {
      excLabs.push(hexToLab(hex));
    }
    const excShapeIds = new Set(exclude.shapeIds || []);
    const minDe = 25.0;  // match construction threshold

    // ── Generate unseen color candidates ──────────────────────────────────────
    const colorCandidates = new Map();  // labKey → {labs, score}

    // Convert preferred hex codes to L*a*b* — these will be pinned in every run
    let pinnedLabs = pinHex.map(h => hexToLab(h)).filter(l => l !== null);

    if (allowed.has("color") || allowed.has("redundant")) {

      // Helper: compute score + meanDe for a lab array and store in colorCandidates
      const _addCandidate = (labs) => {
        const labKey = labs.map(c => c.map(v => v.toFixed(2)).join(",")).join("|");
        if (colorCandidates.has(labKey)) return;
        let wscore = 0;
        for (const [t, w] of Object.entries(taskWeights))
          wscore += w * this._scoreUnseenColorSet(labs, parseInt(t), km);
        let deSum = 0, deCnt = 0;
        for (let x = 0; x < labs.length; x++)
          for (let y = x + 1; y < labs.length; y++) {
            deSum += deltaE76(labs[x], labs[y]); deCnt++;
          }
        const meanDe = deCnt > 0 ? deSum / deCnt : 0;
        colorCandidates.set(labKey, {labs, score: wscore, meanDe});
      };

      if (pinnedLabs.length > k) {
        // preferred > k: score all C(n,k) subsets, add each as a ranked result.
        // Cap at 1000 combos to avoid browser hang (covers C(14,5)=2002 → capped,
        // C(10,5)=252 → fully enumerated, etc.)
        const MAX_PREF_COMBOS = 1000;
        let cnt = 0;
        for (const combo of this._combinations(pinnedLabs, k)) {
          _addCandidate(combo.map(l => [...l]));
          if (++cnt >= MAX_PREF_COMBOS) break;
        }
      } else {
        // preferred ≤ k: greedy construction fills remaining slots.
        // Multi-pass: each pass excludes key proxy regions from the best palette
        // found so far, forcing the construction to explore different colour territory.
        const baseOffset = seed ? 0 : Math.floor(rand() * 100000);
        const actualRuns = pinnedLabs.length === k ? 1 : nRuns;
        const nPasses    = seed ? 1 : top;  // one pass per desired result
        const selectedProxySets = [];  // track proxy sets of per-pass best candidates

        const _runPass = (passIdx, excludeProxies) => {
          const passSeeds = seed ? [[...seed]] :
            Array.from({length: actualRuns}, (_, i) =>
              randomSeedLab(baseOffset + passIdx * 100000 + i, km));
          for (let i = 0; i < passSeeds.length; i++) {
            const palette = this._constructPalette(
              passSeeds[i], k, refTask, i * 17 + km + passIdx * 1000, km,
              pinnedLabs.length > 0 ? pinnedLabs : null,
              excludeProxies.size > 0 ? excludeProxies : null
            );
            const labs = palette.map(c => [...c]);
            if (excLabs.length > 0) {
              let tooClose = false;
              outer: for (const lab of labs)
                for (const ex of excLabs)
                  if (deltaE76(lab, ex) < minDe) { tooClose = true; break outer; }
              if (tooClose) continue;
            }
            _addCandidate(labs);
          }
        };

        for (let pass = 0; pass < nPasses; pass++) {
          // Build exclusion set: ceil(k/2) proxy IDs from each previously selected best
          const excludeProxies = new Set();
          for (const ps of selectedProxySets)
            [...ps].slice(0, Math.ceil(k / 2)).forEach(p => excludeProxies.add(p));

          _runPass(pass, excludeProxies);

          // Identify best candidate not yet too-similar to selected ones, to guide next exclusions
          const sortedSoFar = [...colorCandidates.values()].sort((a, b) =>
            b.score !== a.score ? b.score - a.score : b.meanDe - a.meanDe);
          const nextBest = sortedSoFar.find(c => {
            const cProxies = new Set(c.labs.map(l => this._nearestPoolId(l)));
            return selectedProxySets.every(ps => cosineSim(cProxies, ps) < 0.5);
          }) ?? sortedSoFar[0];
          if (nextBest)
            selectedProxySets.push(new Set(nextBest.labs.map(l => this._nearestPoolId(l))));
        }
      }
    }

    // ── Score pool shape candidates (shapes are always pool-only) ─────────────
    const shapeScores = new Map();

    if (allowed.has("shape") || allowed.has("redundant")) {
      const shapePool = this.shapes.map(s=>s.id).filter(id => !excShapeIds.has(id));
      const pins = pinShapes.filter(id => !excShapeIds.has(id));
      const MAX_SHAPE_COMBOS = 500;
      let shapeCombos;

      if (pins.length > k) {
        // More pinned than k — rank all C(pins, k) subsets
        shapeCombos = [];
        for (const combo of this._combinations(pins, k)) {
          shapeCombos.push([...combo].sort((a,b) => a-b));
          if (shapeCombos.length >= MAX_SHAPE_COMBOS) break;
        }
      } else if (pins.length === k) {
        // Exactly k pinned — single candidate
        shapeCombos = [pins.slice().sort((a,b) => a-b)];
      } else if (pins.length > 0) {
        // Fewer pinned than k — fix pins, fill remaining from the rest of the pool
        const fillPool = shapePool.filter(id => !pins.includes(id));
        const nFill = k - pins.length;
        shapeCombos = [];
        if (nFill <= 4) {
          // Small fill — full enumeration
          for (const combo of this._combinations(fillPool, nFill)) {
            shapeCombos.push([...pins, ...combo].sort((a,b) => a-b));
            if (shapeCombos.length >= MAX_SHAPE_COMBOS) break;
          }
        } else {
          // Large fill — random sampling
          const seen = new Set();
          const maxTries = MAX_SHAPE_COMBOS * 20;
          for (let t = 0; t < maxTries && shapeCombos.length < MAX_SHAPE_COMBOS; t++) {
            const arr = [...fillPool];
            for (let i = 0; i < nFill; i++) {
              const j = i + Math.floor(rand() * (arr.length - i));
              [arr[i], arr[j]] = [arr[j], arr[i]];
            }
            const combo = [...pins, ...arr.slice(0, nFill)].sort((a,b) => a-b);
            const key = combo.join(",");
            if (!seen.has(key)) { seen.add(key); shapeCombos.push(combo); }
          }
        }
      } else {
        // No pins — original logic
        if (k <= 4) {
          shapeCombos = [];
          for (const combo of this._combinations(shapePool, k)) {
            shapeCombos.push([...combo]);
          }
        } else {
          shapeCombos = [];
          const seen = new Set();
          const maxTries = MAX_SHAPE_COMBOS * 20;
          for (let t = 0; t < maxTries && shapeCombos.length < MAX_SHAPE_COMBOS; t++) {
            const arr = [...shapePool];
            for (let i = 0; i < k; i++) {
              const j = i + Math.floor(rand() * (arr.length - i));
              [arr[i], arr[j]] = [arr[j], arr[i]];
            }
            const combo = arr.slice(0, k).sort((a,b) => a-b);
            const key = combo.join(",");
            if (!seen.has(key)) { seen.add(key); shapeCombos.push(combo); }
          }
        }
      }

      for (const combo of shapeCombos) {
        const ids = [...combo];
        const key = ids.join(",");
        if (!shapeScores.has(key)) {
          const score = this._wScore(
            (ii, t, kk) => this._scoreShapeSet(ii, t, kk), ids, taskWeights, km
          );
          shapeScores.set(key, {ids, score});
        }
      }
    }

    // ── Assemble results ──────────────────────────────────────────────────────
    const results = [];

    if (allowed.has("color")) {
      if (colorCandidates.size === 0) {
        console.warn("CatPAL: all color palettes filtered by exclude list.");
      }
      // Sort by proxy pairwise acc descending; break ties by mean actual ΔE descending
      const sorted = [...colorCandidates.values()].sort((a, b) =>
        b.score !== a.score ? b.score - a.score : b.meanDe - a.meanDe
      );
      // Diversity filter: proxy cosine sim < 0.5 AND avg palette ΔE ≥ 18
      const diverse = this._diverseFilter(sorted, top,
        cs => new Set(cs.labs.map(l => this._nearestPoolId(l))),
        cs => cs.labs
      );
      for (const {labs, score, meanDe} of diverse) {
        results.push({
          enc: "color", score, meanDe,
          colorLabs: labs,
          colorHex: labs.map(lab => labToHex(lab[0], lab[1], lab[2])),
          shapeIds: null,
        });
      }
    }

    if (allowed.has("shape")) {
      const sorted = [...shapeScores.values()].sort((a,b)=>b.score-a.score);
      const diverse = this._diverseFilter(sorted, top, ss => new Set(ss.ids));
      for (const {ids, score} of diverse) {
        results.push({
          enc: "shape", score,
          colorLabs: null, colorHex: null,
          shapeIds: ids,
        });
      }
    }

    if (allowed.has("redundant") && colorCandidates.size > 0 && shapeScores.size > 0) {
      const threshC = this._weightedBetaThreshold(taskWeights, this.btBetaColor);
      const threshS = this._weightedBetaThreshold(taskWeights, this.btBetaShape);

      // Split ALL candidates into high/low quality buckets, sorted by score desc.
      // For unseen colors, proxy via nearest pool ID to get comparable betas.
      const colorHigh = [], colorLow = [];
      for (const cs of colorCandidates.values()) {
        const proxies = cs.labs.map(lab => this._nearestPoolId(lab));
        const mb = this._weightedMeanBeta(proxies, taskWeights, this.btBetaColor);
        (mb >= threshC ? colorHigh : colorLow).push({...cs, mb});
      }
      colorHigh.sort((a,b) => b.score - a.score);
      colorLow.sort((a,b)  => b.score - a.score);

      const shapeHigh = [], shapeLow = [];
      for (const ss of shapeScores.values()) {
        const mb = this._weightedMeanBeta(ss.ids, taskWeights, this.btBetaShape);
        (mb >= threshS ? shapeHigh : shapeLow).push({...ss, mb});
      }
      shapeHigh.sort((a,b) => b.score - a.score);
      shapeLow.sort((a,b)  => b.score - a.score);

      const bucketPairs = [
        { q: "Q1", cBucket: colorHigh, sBucket: shapeHigh },
        { q: "Q2", cBucket: colorHigh, sBucket: shapeLow  },
        { q: "Q3", cBucket: colorLow,  sBucket: shapeHigh },
        { q: "Q4", cBucket: colorLow,  sBucket: shapeLow  },
      ];
      // Collect all redundant candidates first, then diversity-filter
      const redundantCandidates = [];
      for (const { q, cBucket, sBucket } of bucketPairs) {
        if (!cBucket.length || !sBucket.length) continue;
        const dg = this._wDeltaG(q, taskWeights, km);
        const nC = Math.min(top, cBucket.length);
        const nS = Math.min(top, sBucket.length);
        for (let ci = 0; ci < nC; ci++) {
          for (let si = 0; si < nS; si++) {
            const cs = cBucket[ci], ss = sBucket[si];
            redundantCandidates.push({
              enc: "redundant",
              score: (cs.score + ss.score) / 2 + dg,
              colorLabs: cs.labs,
              colorHex: cs.labs.map(lab => labToHex(lab[0], lab[1], lab[2])),
              shapeIds: ss.ids,
            });
          }
        }
      }
      redundantCandidates.sort((a, b) => b.score - a.score);
      // Diversity filter: combined color-proxy + shape ID set (shape IDs offset to avoid collision)
      const COLOR_POOL_SIZE = this.colors.length;
      const diverse = this._diverseFilter(redundantCandidates, top, r => new Set([
        ...r.colorLabs.map(l => this._nearestPoolId(l)),
        ...r.shapeIds.map(id => COLOR_POOL_SIZE + id),
      ]));
      results.push(...diverse);
    }

    return results.sort((a,b)=>b.score-a.score).slice(0, top);
  }

  // ── Greedy palette construction (simplified) ────────────────────────────────
  // k     = actual palette size (2–10)
  // km    = model scoring key (3/6/9, default: mapK(k))
  // pinnedLabs: optional array of [L,a,b] that MUST appear in the palette.
  // Each run keeps these fixed and fills remaining k-pinnedLabs.length slots
  // with greedy model-based search.  If pinnedLabs is null/empty, seedLab is
  // used as the single starting colour (original behaviour).
  _constructPalette(seedLab, k, task, rngSeed, km = null, pinnedLabs = null, excludedProxies = null) {
    const scoreK = km ?? mapK(k);  // use km for scoring, k for palette size
    const rng = new SeededRng(rngSeed);

    // Initialise palette from pinned colours or fall back to single seed
    const pinned = (pinnedLabs && pinnedLabs.length > 0)
      ? pinnedLabs.map(l => [...l])
      : [seedLab.slice()];
    const palette = [...pinned];
    const minDe = 25.0;
    const nCandidates = 300;

    // Track which pool proxy IDs are already represented in the palette.
    // Forcing each new colour to map to a fresh proxy region prevents:
    //   (a) hue clustering — two colours near the same pool hue both passing
    //       the ΔE=25 floor via a lightness difference
    //   (b) score convergence — without this, all greedy runs gravitate to
    //       the same top-k proxy IDs and produce identical final scores
    const paletteProxies = palette.map(l => this._nearestPoolId(l));
    const usedProxies = new Set(paletteProxies);

    // Incremental pairwise base: sum + count of pairs already in the palette.
    // Each step we only need to compute `palette.length` NEW pairs (candidate vs
    // each existing colour) rather than recomputing all C(palette+1, 2) pairs from
    // scratch — reduces scoring work from O(k²) to O(k) per candidate.
    let basePairSum = 0, basePairCnt = 0;
    for (let x = 0; x < paletteProxies.length; x++) {
      for (let y = x + 1; y < paletteProxies.length; y++) {
        const acc = paletteProxies[x] === paletteProxies[y]
          ? 0.5 : (this._pwColorAcc(paletteProxies[x], paletteProxies[y], task, scoreK) ?? 0.5);
        basePairSum += acc; basePairCnt++;
      }
    }

    // Pre-compute steps needed — palette grows during the loop so
    // k - palette.length must NOT be evaluated dynamically each iteration
    const stepsNeeded = k - palette.length;
    for (let step = 0; step < stepsNeeded; step++) {
      const candidates = [];
      for (let i = 0; i < nCandidates; i++) {
        candidates.push(sampleLab(rng, 25, 80, 20, 70));
      }

      // Primary filter: ΔE floor + unused proxy + not in excluded proxy set
      let valid = candidates.filter(c => {
        const proxy = this._nearestPoolId(c);
        return palette.every(p => deltaE76(c, p) >= minDe) &&
               !usedProxies.has(proxy) &&
               (!excludedProxies || !excludedProxies.has(proxy));
      });
      // Relax excluded proxies first
      if (valid.length === 0 && excludedProxies) {
        valid = candidates.filter(c =>
          palette.every(p => deltaE76(c, p) >= minDe) &&
          !usedProxies.has(this._nearestPoolId(c))
        );
      }
      // Then relax usedProxies constraint
      if (valid.length === 0) {
        valid = candidates.filter(c => palette.every(p => deltaE76(c, p) >= minDe));
      }
      // Emergency: try a larger sample — still enforce the ΔE floor
      if (valid.length === 0) {
        const extra = [];
        for (let j = 0; j < 1000; j++) {
          extra.push(sampleLab(rng, 25, 80, 20, 70));
        }
        valid = extra.filter(c => palette.every(p => deltaE76(c, p) >= minDe));
      }
      // Truly exhausted — stop here; palette has fewer than k colours but
      // every pair is guaranteed ΔE ≥ 25
      if (valid.length === 0) break;

      // Model-based greedy: pick candidate with highest incremental pairwise score.
      // Only the `paletteProxies.length` new pairs involving the candidate are scored;
      // the existing base sum is reused across all candidates in this step.
      let bestScore = -Infinity, bestC = null, bestProxy = -1;
      for (const c of valid) {
        const cProxy = this._nearestPoolId(c);
        let sum = basePairSum, cnt = basePairCnt;
        for (const px of paletteProxies) {
          const acc = cProxy === px
            ? 0.5 : (this._pwColorAcc(cProxy, px, task, scoreK) ?? 0.5);
          sum += acc; cnt++;
        }
        const score = cnt > 0 ? sum / cnt : 0.5;
        if (score > bestScore) { bestScore = score; bestC = c; bestProxy = cProxy; }
      }
      const chosen = bestC ?? valid[0];
      const chosenProxy = bestProxy !== -1 ? bestProxy : this._nearestPoolId(chosen);

      // Update incremental base for the next step
      for (const px of paletteProxies) {
        const acc = chosenProxy === px
          ? 0.5 : (this._pwColorAcc(chosenProxy, px, task, scoreK) ?? 0.5);
        basePairSum += acc; basePairCnt++;
      }
      palette.push(chosen);
      paletteProxies.push(chosenProxy);
      usedProxies.add(chosenProxy);
    }
    return palette;
  }

  // ── Score an unseen colour set ──────────────────────────────────────────────
  // Returns mean proxy pairwise accuracy across all C(n,2) colour pairs.
  // Each unseen colour is mapped to its nearest pool ID by ΔE76; the observed
  // pairwise accuracy for that pool pair (task, k) is looked up.
  // Duplicate proxies (two unseen colours map to the same pool ID) are
  // penalised at chance level (0.5) rather than skipped, which prevents
  // score inflation for perceptually similar colours.
  // Missing lookup entries also fall back to 0.5.
  _scoreUnseenColorSet(labs, task, k) {
    const proxyIds = labs.map(lab => this._nearestPoolId(lab));
    let sum = 0, cnt = 0;
    for (let x = 0; x < proxyIds.length; x++) {
      for (let y = x + 1; y < proxyIds.length; y++) {
        if (proxyIds[x] === proxyIds[y]) {
          sum += 0.5;  // duplicate proxy → chance level
        } else {
          const acc = this._pwColorAcc(proxyIds[x], proxyIds[y], task, k);
          sum += acc !== null ? acc : 0.5;
        }
        cnt++;
      }
    }
    return cnt > 0 ? sum / cnt : 0.5;
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // PUBLIC API
  // ══════════════════════════════════════════════════════════════════════════════

  /**
   * Recommend palettes.
   * @param {Object} opts — see the README ("Options")
   * @returns {Array} result objects
   */
  recommend(opts = {}) {
    return this._unseenMode(normalizeOptions(opts));
  }

  /** Return the 39-item shape pool. */
  getShapePool() { return this.shapes; }

  // ── Swap suggestion ─────────────────────────────────────────────────────────
  // Given an existing result and a slot to replace, returns the top-N
  // alternatives scored with the rest of the palette held fixed.
  //
  // result    — result object from recommend() (has colorLabs/shapeIds)
  // slotType  — "color" | "shape"
  // slotIdx   — index into colorHex / shapeIds to replace
  // opts      — { task, k, top=5, exclude={}, nSamples=500 }
  // Returns   — [{hex, id?, labs?, score, delta}] sorted best-first
  suggestSwap(result, slotType, slotIdx, opts) {
    const { task, k, top = 5, exclude = {}, nSamples = 500, rngSeed = null } = normalizeOptions(opts, { forSwap: true });
    const km = mapK(k);
    const taskWeights = this._resolveTaskWeights(task);
    const currentScore = result.score;
    let alts = [];
    if (slotType === 'color' && result.colorLabs)
      alts = this._swapUnseenColor(result.colorLabs, slotIdx, taskWeights, km, nSamples, rngSeed);
    else if (slotType === 'shape' && result.shapeIds)
      alts = this._swapPoolShape(result.shapeIds, slotIdx, taskWeights, km, exclude);
    return alts
      .sort((a, b) => b.score - a.score)
      .slice(0, top)
      .map(a => ({ ...a, delta: a.score - currentScore }));
  }

  _swapUnseenColor(colorLabs, slotIdx, taskWeights, km, nSamples, rngSeed = null) {
    const others = colorLabs.filter((_, j) => j !== slotIdx);
    const rng = new SeededRng(Math.floor(makeRand(rngSeed)() * 1e9));
    const alts = [];
    for (let i = 0; i < nSamples; i++) {
      const Ls  = rng.uniform(25, 80);
      const Cs  = rng.uniform(20, 70);
      const hs  = rng.uniform(0, 360) * Math.PI / 180;
      const lab = [Ls, Cs * Math.cos(hs), Cs * Math.sin(hs)];
      if (others.some(p => deltaE76(lab, p) < 25)) continue;
      const newLabs = colorLabs.map((l, j) => j === slotIdx ? lab : l);
      let wscore = 0;
      for (const [t, w] of Object.entries(taskWeights))
        wscore += w * this._scoreUnseenColorSet(newLabs, parseInt(t), km);
      alts.push({ labs: lab, hex: labToHex(lab[0], lab[1], lab[2]), score: wscore });
    }
    return alts;
  }

  _swapPoolShape(shapeIds, slotIdx, taskWeights, km, exclude) {
    const excShapeIds = new Set(exclude.shapeIds || []);
    const occupied    = new Set(shapeIds.filter((_, j) => j !== slotIdx));
    const alts = [];
    for (const s of this.shapes) {
      if (occupied.has(s.id) || excShapeIds.has(s.id) || s.id === shapeIds[slotIdx]) continue;
      const newIds = shapeIds.map((id, j) => j === slotIdx ? s.id : id);
      const score  = this._wScore(
        (ii, t, kk) => this._scoreShapeSet(ii, t, kk),
        [...newIds].sort((a,b) => a-b), taskWeights, km
      );
      alts.push({ id: s.id, score });
    }
    return alts;
  }
}

export {
  CatPAL, TASKS, SeededRng,
  mapK, labToHex, hexToLab, deltaE76, resolveTask,
};
