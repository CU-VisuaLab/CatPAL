"""CatPAL recommendation engine (pure Python, no dependencies).

This is a line-for-line port of the JavaScript engine in ``js/src/engine.js``.
Both are tested against the same golden outputs, so given the same options and
``rng_seed`` they return the same palettes. When changing behavior here, change
the JavaScript engine too and regenerate the golden file.

Names prefixed with an underscore are internal.
"""

import math
import random
import warnings
from dataclasses import asdict, dataclass
from itertools import combinations, islice
from typing import Any, Dict, List, Optional, Sequence

# ──────────────────────────────────────────────────────────────────────────────
# Color science
# ──────────────────────────────────────────────────────────────────────────────


def delta_e76(lab1: Sequence[float], lab2: Sequence[float]) -> float:
    """CIE76 color difference between two L*a*b* colors."""
    dL = lab1[0] - lab2[0]
    da = lab1[1] - lab2[1]
    db = lab1[2] - lab2[2]
    return math.sqrt(dL * dL + da * da + db * db)


def _js_round(x: float) -> int:
    """Round half up, as JavaScript's Math.round does."""
    return math.floor(x + 0.5)


def _cbrt(t: float) -> float:
    if hasattr(math, "cbrt"):
        return math.cbrt(t)
    y = t ** (1.0 / 3.0)
    return y - (y * y * y - t) / (3.0 * y * y) if y else y


def lab_to_hex(L: float, a: float, b: float) -> str:
    """Convert an L*a*b* color (D65) to an sRGB hex string like ``#1F77B4``."""
    fy = (L + 16) / 116
    fx = a / 500 + fy
    fz = fy - b / 200

    def inv_f(t):
        return t * t * t if t > 0.206897 else (t - 16 / 116) / 7.787

    X = inv_f(fx) * 0.95047
    Y = inv_f(fy) * 1.00000
    Z = inv_f(fz) * 1.08883
    r = X * 3.2404542 - Y * 1.5371385 - Z * 0.4985314
    g = -X * 0.9692660 + Y * 1.8760108 + Z * 0.0415560
    bv = X * 0.0556434 - Y * 0.2040259 + Z * 1.0572252

    def gamma(c):
        c = max(0, min(1, c))
        return 1.055 * math.pow(c, 1 / 2.4) - 0.055 if c > 0.0031308 else 12.92 * c

    return "#" + "".join("%02X" % _js_round(gamma(v) * 255) for v in (r, g, bv))


def _is_hex(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    h = value[1:] if value.startswith("#") else value
    return len(h) == 6 and all(ch in "0123456789abcdefABCDEF" for ch in h)


def hex_to_lab(hex_code: str) -> Optional[List[float]]:
    """Convert a hex color to ``[L, a, b]``. Returns None for an invalid code."""
    if not _is_hex(hex_code):
        return None
    h = hex_code[1:] if hex_code.startswith("#") else hex_code
    r = int(h[0:2], 16) / 255
    g = int(h[2:4], 16) / 255
    bv = int(h[4:6], 16) / 255

    def lin(c):
        return c / 12.92 if c <= 0.04045 else math.pow((c + 0.055) / 1.055, 2.4)

    rl, gl, bl = lin(r), lin(g), lin(bv)
    X = rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375
    Y = rl * 0.2126729 + gl * 0.7151522 + bl * 0.0721750
    Z = rl * 0.0193339 + gl * 0.1191920 + bl * 0.9503041

    def f(t):
        return _cbrt(t) if t > 0.008856 else 7.787 * t + 16 / 116

    fx, fy, fz = f(X / 0.95047), f(Y / 1.00000), f(Z / 1.08883)
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]


def map_k(k: int) -> int:
    """Snap a palette size (2-10) to the sizes the model was fitted on (3, 6, 9)."""
    if k <= 4:
        return 3
    if k <= 7:
        return 6
    return 9


def _cosine_sim(a, b) -> float:
    """Cosine similarity between two sets of ids."""
    if not a or not b:
        return 0
    dot = sum(1 for x in a if x in b)
    return dot / math.sqrt(len(a) * len(b))


def _oset(items) -> Dict[Any, None]:
    """Insertion-ordered set (matches the iteration order of a JavaScript Set)."""
    return dict.fromkeys(items)


def _palette_lab_distance(labs_a, labs_b) -> float:
    """Average ΔE of a greedy one-to-one matching between two palettes."""
    used = set()
    total = 0.0
    for a in labs_a:
        best, best_j = math.inf, 0
        for j, b in enumerate(labs_b):
            if j not in used:
                d = delta_e76(a, b)
                if d < best:
                    best, best_j = d, j
        used.add(best_j)
        total += best
    return total / len(labs_a)


# ──────────────────────────────────────────────────────────────────────────────
# Seeded random numbers (identical stream to the JavaScript engine)
# ──────────────────────────────────────────────────────────────────────────────

_M64 = (1 << 64) - 1
_M32 = 0xFFFFFFFF


class SeededRng:
    """Small deterministic generator shared, bit for bit, with the JS engine."""

    def __init__(self, seed: int):
        s = int(seed) & _M64
        out = []
        for _ in range(2):
            s = (s + 0x9E3779B97F4A7C15) & _M64
            z = s
            z = ((z ^ (z >> 30)) * 0xBF58476D1CE4E5B9) & _M64
            z = ((z ^ (z >> 27)) * 0x94D049BB133111EB) & _M64
            out.append(z ^ (z >> 31))
        s0, s1 = out
        self._s = [s0 & _M32, s0 >> 32, s1 & _M32, s1 >> 32]

    def next_float(self) -> float:
        """Next value in [0, 1)."""
        s = self._s
        result = s[0] ^ s[2]
        t = (s[1] << 9) & _M32
        s[2] ^= s[0]
        s[3] ^= s[1]
        s[1] ^= s[2]
        s[0] ^= s[3]
        s[2] ^= t
        s[3] = ((s[3] << 11) | (s[3] >> 21)) & _M32
        return result / 4294967296

    def uniform(self, lo: float, hi: float) -> float:
        return lo + self.next_float() * (hi - lo)


def _make_rand(rng_seed):
    if rng_seed is None:
        return random.random
    return SeededRng(rng_seed).next_float


def _finite_number(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _first(d: dict, *names):
    for n in names:
        if d.get(n) is not None:
            return d[n]
    return None


def _sample_lab(rng: SeededRng, l_lo, l_hi, c_lo, c_hi) -> List[float]:
    """One L*a*b* color drawn uniformly from the given lightness and chroma ranges."""
    Ls = rng.uniform(l_lo, l_hi)
    Cs = rng.uniform(c_lo, c_hi)
    hr = rng.uniform(0, 360) * math.pi / 180
    return [Ls, Cs * math.cos(hr), Cs * math.sin(hr)]


def _random_seed_lab(run_idx: int, k: int) -> List[float]:
    return _sample_lab(SeededRng(run_idx * 17 + k), 20, 80, 20, 60)


# ──────────────────────────────────────────────────────────────────────────────
# Tasks and option validation
# ──────────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Task:
    """One of the seven analysis tasks from the experiments."""

    id: int
    key: str
    name: str


#: The seven analysis tasks. ``id`` or ``key`` can be passed as ``task``.
TASKS = (
    Task(1, "cluster-identification", "Cluster identification"),
    Task(2, "spatial-distribution", "Spatial distribution"),
    Task(3, "dispersion-estimation", "Dispersion estimation"),
    Task(4, "outlier-detection", "Outlier detection"),
    Task(5, "correlation-identification", "Correlation identification"),
    Task(6, "quantity-comparison", "Quantity comparison"),
    Task(7, "proximity-judgment", "Proximity judgment"),
)

_ENCODINGS = ("color", "shape", "redundant")
_TASK_KEYS = ", ".join(t.key for t in TASKS)


def _is_int(v) -> bool:
    return isinstance(v, int) and not isinstance(v, bool)


def _task_id(t) -> int:
    if isinstance(t, str) and t.strip() in "1234567" and len(t.strip()) == 1:
        t = int(t)
    if _is_int(t):
        if 1 <= t <= 7:
            return t
    elif isinstance(t, str):
        norm = "-".join(t.strip().lower().replace("_", " ").split())
        for task in TASKS:
            if task.key == norm:
                return task.id
    raise ValueError(
        "CatPAL: unknown task %r. Use an id 1-7 or one of: %s." % (t, _TASK_KEYS))


def resolve_task(task):
    """Normalize a task spec to ``None``, an id, or a ``{id: weight}`` dict."""
    if task is None:
        return None
    if _is_int(task) or isinstance(task, str):
        return _task_id(task)
    if isinstance(task, dict):
        out: Dict[int, float] = {}
        for t, w in task.items():
            if not _finite_number(w) or w < 0:
                raise ValueError(
                    "CatPAL: task weight for %r must be a non-negative number." % (t,))
            tid = _task_id(t)
            out[tid] = out.get(tid, 0) + w
        if not any(w > 0 for w in out.values()):
            raise ValueError("CatPAL: task weights must include at least one positive weight.")
        return out
    raise TypeError(
        "CatPAL: task must be an id (1-7), a task key, a dict of weights, or None.")


def _check_hex_list(items, label) -> List[str]:
    if isinstance(items, str) or not isinstance(items, (list, tuple)):
        raise TypeError("CatPAL: %s must be a list of hex colors." % label)
    for h in items:
        if not _is_hex(h):
            raise ValueError("CatPAL: %s contains an invalid hex color: %r." % (label, h))
    return list(items)


def _check_id_list(items, label, n=39) -> List[int]:
    if not isinstance(items, (list, tuple)):
        raise TypeError("CatPAL: %s must be a list of ids." % label)
    for i in items:
        if not _is_int(i) or i < 0 or i >= n:
            raise ValueError(
                "CatPAL: %s contains an invalid id: %r (expected 0-%d)." % (label, i, n - 1))
    return list(items)


def _normalize_exclude(exclude) -> Dict[str, list]:
    ex = {} if exclude is None else exclude
    if not isinstance(ex, dict):
        raise TypeError(
            "CatPAL: exclude must be a dict with shape_ids and/or hex_codes.")
    return {
        "shapeIds": _check_id_list(_first(ex, "shape_ids", "shapeIds") or [], "exclude.shape_ids"),
        "hexCodes": _check_hex_list(_first(ex, "hex_codes", "hexCodes") or [], "exclude.hex_codes"),
    }


def _check_k(k) -> None:
    if not _is_int(k) or k < 2 or k > 10:
        raise ValueError(
            "CatPAL: k (number of categories) must be an integer from 2 to 10; got %r." % (k,))


def _check_common(top, rng_seed) -> None:
    if not _is_int(top) or top < 1:
        raise ValueError("CatPAL: top must be a positive integer.")
    if rng_seed is not None and (not _is_int(rng_seed) or rng_seed < 0):
        raise ValueError("CatPAL: rng_seed must be a non-negative integer.")


# ──────────────────────────────────────────────────────────────────────────────
# Results
# ──────────────────────────────────────────────────────────────────────────────


@dataclass
class Palette:
    """One recommended palette.

    ``score`` is the predicted accuracy (mean pairwise accuracy, 0.5 = chance).
    Fields that do not apply to a result are None.
    """

    enc: str
    score: float
    color_hex: Optional[List[str]] = None
    color_labs: Optional[List[List[float]]] = None
    shape_ids: Optional[List[int]] = None
    mean_de: Optional[float] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class Swap:
    """A candidate replacement for one slot of a palette.

    ``delta`` is the change in score relative to the palette being edited.
    """

    score: float
    delta: float
    id: Optional[int] = None
    hex: Optional[str] = None
    lab: Optional[List[float]] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


# ──────────────────────────────────────────────────────────────────────────────
# Model
# ──────────────────────────────────────────────────────────────────────────────


def _parse_keys(table: Dict[str, float]) -> Dict[tuple, float]:
    return {tuple(int(p) for p in key.split("-")): v for key, v in table.items()}


class CatPAL:
    """The recommendation model. Construct with the parsed model data."""

    def __init__(self, data: Dict[str, Any]):
        self.colors = data["colors"]
        self.shapes = data["shapes"]
        self._pw_color = _parse_keys(data["pairwise_color"])      # (i, j, task, k) → acc
        self._pw_shape = _parse_keys(data["pairwise_shape"])
        self._beta_color = _parse_keys(data["bt_task_betas_color"])  # (task, id) → beta
        self._beta_shape = _parse_keys(data["bt_task_betas_shape"])
        self._pool = [(c["L"], c["a"], c["b"], c["id"]) for c in self.colors]
        # The data names quadrants "Q1_SC_SS" … "Q4_WC_WS"; lookups use "Q1" … "Q4".
        self._dg = {
            (str(row["quadrant"]).split("_")[0], row["task_id"], row["k"]): row["delta_g"]
            for row in (data.get("delta_g") or [])
        }

    # ── Task weights: list of (task id, weight), ascending by id ───────────────
    @staticmethod
    def _resolve_task_weights(task):
        if task is None:
            w = 1 / 7
            return [(t, w) for t in range(1, 8)]
        if _is_int(task):
            return [(task, 1.0)]
        items = sorted(task.items())
        total = 0
        for _, w in items:
            total = total + w
        return [(t, w / total) for t, w in items]

    # ── Pairwise accuracy ──────────────────────────────────────────────────────
    def _pw_color_acc(self, i, j, task, k):
        return self._pw_color.get((i, j, task, k) if i <= j else (j, i, task, k))

    def _pw_shape_acc(self, i, j, task, k):
        return self._pw_shape.get((i, j, task, k) if i <= j else (j, i, task, k))

    @staticmethod
    def _mean_pw(ids, task, k, lookup):
        total, cnt = 0, 0
        n = len(ids)
        for x in range(n):
            for y in range(x + 1, n):
                acc = lookup(ids[x], ids[y], task, k)
                if acc is not None:
                    total += acc
                    cnt += 1
        return total / cnt if cnt > 0 else 0.5

    def _score_shape_set(self, ids, task, k):
        return self._mean_pw(ids, task, k, self._pw_shape_acc)

    @staticmethod
    def _w_score(score_fn, ids, task_weights, k):
        score = 0
        for t, w in task_weights:
            score += w * score_fn(ids, t, k)
        return score

    # ── Bradley–Terry strength (for the redundant-encoding quadrants) ──────────
    @staticmethod
    def _weighted_mean_beta(ids, task_weights, betas):
        total = 0
        for t, w in task_weights:
            task_sum = 0
            for i in ids:
                task_sum += betas.get((t, i), 0)
            total += w * (task_sum / len(ids))
        return total

    @staticmethod
    def _weighted_beta_threshold(task_weights, betas, n_items=39):
        total = 0
        for t, w in task_weights:
            vals = sorted(betas.get((t, i), 0) for i in range(n_items))
            mid = len(vals) // 2
            median = (vals[mid - 1] + vals[mid]) / 2 if len(vals) % 2 == 0 else vals[mid]
            total += w * median
        return total

    def _w_delta_g(self, quadrant, task_weights, k):
        total = 0
        for t, w in task_weights:
            total += w * self._dg.get((quadrant, t, k), 0)
        return total

    # ── Nearest experiment color ───────────────────────────────────────────────
    def _nearest_pool_id(self, lab):
        L, a, b = lab[0], lab[1], lab[2]
        best_id, best = 0, math.inf
        sqrt = math.sqrt
        for pL, pa, pb, pid in self._pool:
            dL = L - pL
            da = a - pa
            db = b - pb
            de = sqrt(dL * dL + da * da + db * db)
            if de < best:
                best, best_id = de, pid
        return best_id

    def _score_sets(self, candidate_sets, score_fn, task_weights, km):
        scores = {}
        for ids in candidate_sets:
            key = tuple(ids)
            if key not in scores:
                scores[key] = {"ids": ids, "score": self._w_score(score_fn, ids, task_weights, km)}
        return scores

    def _split_by_strength(self, entries, proxies_of, task_weights, betas, thresh):
        high, low = [], []
        for e in entries:
            mb = self._weighted_mean_beta(proxies_of(e), task_weights, betas)
            (high if mb >= thresh else low).append(e)
        high.sort(key=lambda e: -e["score"])
        low.sort(key=lambda e: -e["score"])
        return high, low

    # ══════════════════════════════════════════════════════════════════════════
    # Palette generation: new colors; shapes always come from the 39 tested shapes
    # ══════════════════════════════════════════════════════════════════════════

    @staticmethod
    def _diverse_filter(candidates, top, get_id_set, get_labs=None, threshold=0.5, min_avg_de=18):
        kept, kept_sets, kept_labs = [], [], []

        def too_similar(c):
            ids = get_id_set(c)
            if any(_cosine_sim(ids, ks) >= threshold for ks in kept_sets):
                return True
            if get_labs and kept_labs:
                labs = get_labs(c)
                if any(_palette_lab_distance(labs, kl) < min_avg_de for kl in kept_labs):
                    return True
            return False

        for c in candidates:
            if len(kept) >= top:
                break
            if not too_similar(c):
                kept.append(c)
                kept_sets.append(get_id_set(c))
                if get_labs:
                    kept_labs.append(get_labs(c))

        if len(kept) < top:
            kept_ids = {id(c) for c in kept}
            remaining = [c for c in candidates if id(c) not in kept_ids]
            while len(kept) < top and remaining:
                best_idx, best_dist = 0, -math.inf
                for i, cand in enumerate(remaining):
                    if get_labs and kept_labs:
                        dist = min(_palette_lab_distance(get_labs(cand), kl) for kl in kept_labs)
                    else:
                        dist = 1 - max(
                            (_cosine_sim(get_id_set(cand), ks) for ks in kept_sets),
                            default=-math.inf)
                    if dist > best_dist:
                        best_dist, best_idx = dist, i
                best = remaining.pop(best_idx)
                kept.append(best)
                kept_sets.append(get_id_set(best))
                if get_labs:
                    kept_labs.append(get_labs(best))
        return kept

    def _proxy_set(self, labs):
        return _oset(self._nearest_pool_id(lab) for lab in labs)

    def _unseen_shape_combos(self, pins, shape_pool, k, rand):
        max_combos = 500

        def sample(pool, n, fixed):
            combos, seen = [], set()
            if n > len(pool):
                return combos
            for _ in range(max_combos * 20):
                if len(combos) >= max_combos:
                    break
                arr = list(pool)
                for i in range(n):
                    j = i + math.floor(rand() * (len(arr) - i))
                    arr[i], arr[j] = arr[j], arr[i]
                combo = sorted(fixed + arr[:n])
                key = tuple(combo)
                if key not in seen:
                    seen.add(key)
                    combos.append(combo)
            return combos

        if len(pins) > k:
            return [sorted(c) for c in islice(combinations(pins, k), max_combos)]
        if len(pins) == k:
            return [sorted(pins)]
        if len(pins) > 0:
            fill = [i for i in shape_pool if i not in pins]
            n_fill = k - len(pins)
            if n_fill <= 4:
                return [sorted(pins + list(c))
                        for c in islice(combinations(fill, n_fill), max_combos)]
            return sample(fill, n_fill, pins)
        if k <= 4:
            return [list(c) for c in combinations(shape_pool, k)]
        return sample(shape_pool, k, [])

    def _unseen_mode(self, o):
        k, top, seed = o["k"], o["top"], o["seed"]
        rand = _make_rand(o["rngSeed"])
        km = map_k(k)
        tw = self._resolve_task_weights(o["task"])
        ref_task = tw[0][0]
        allowed = o["allowed"]
        exclude = o["exclude"]

        exc_labs = []
        for h in exclude["hexCodes"]:
            exc_labs.append(hex_to_lab(h))
        exc_shapes = set(exclude["shapeIds"])
        min_de = 25.0

        color_candidates: Dict[str, dict] = {}
        pinned_labs = [lab for lab in (hex_to_lab(h) for h in o["pinHex"]) if lab is not None]

        def add_candidate(labs):
            key = "|".join(",".join("%.2f" % v for v in c) for c in labs)
            if key in color_candidates:
                return
            wscore = 0
            for t, w in tw:
                wscore += w * self._score_unseen_color_set(labs, t, km)
            de_sum, de_cnt = 0, 0
            for x in range(len(labs)):
                for y in range(x + 1, len(labs)):
                    de_sum += delta_e76(labs[x], labs[y])
                    de_cnt += 1
            mean_de = de_sum / de_cnt if de_cnt > 0 else 0
            color_candidates[key] = {"labs": labs, "score": wscore, "meanDe": mean_de}

        def by_score_then_spread(c):
            return (-c["score"], -c["meanDe"])

        if "color" in allowed or "redundant" in allowed:
            if len(pinned_labs) > k:
                for combo in islice(combinations(pinned_labs, k), 1000):
                    add_candidate([list(lab) for lab in combo])
            else:
                base_offset = 0 if seed else math.floor(rand() * 100000)
                actual_runs = 1 if len(pinned_labs) == k else o["nRuns"]
                n_passes = 1 if seed else top
                selected_proxy_sets = []

                def run_pass(pass_idx, exclude_proxies):
                    if seed:
                        pass_seeds = [list(seed)]
                    else:
                        pass_seeds = [
                            _random_seed_lab(base_offset + pass_idx * 100000 + i, km)
                            for i in range(actual_runs)]
                    for i, seed_lab in enumerate(pass_seeds):
                        palette = self._construct_palette(
                            seed_lab, k, ref_task, i * 17 + km + pass_idx * 1000, km,
                            pinned_labs if pinned_labs else None,
                            exclude_proxies if exclude_proxies else None)
                        labs = [list(c) for c in palette]
                        if exc_labs and any(
                                delta_e76(lab, ex) < min_de for lab in labs for ex in exc_labs):
                            continue
                        add_candidate(labs)

                n_half = math.ceil(k / 2)
                for pass_idx in range(n_passes):
                    exclude_proxies = set()
                    for ps in selected_proxy_sets:
                        exclude_proxies.update(list(ps)[:n_half])
                    run_pass(pass_idx, exclude_proxies)

                    sorted_so_far = sorted(color_candidates.values(), key=by_score_then_spread)
                    next_best = None
                    for c in sorted_so_far:
                        proxies = self._proxy_set(c["labs"])
                        if all(_cosine_sim(proxies, ps) < 0.5 for ps in selected_proxy_sets):
                            next_best = c
                            break
                    if next_best is None and sorted_so_far:
                        next_best = sorted_so_far[0]
                    if next_best is not None:
                        selected_proxy_sets.append(self._proxy_set(next_best["labs"]))

        shape_scores = {}
        if "shape" in allowed or "redundant" in allowed:
            shape_pool = [s["id"] for s in self.shapes if s["id"] not in exc_shapes]
            pins = [i for i in o["pinShapes"] if i not in exc_shapes]
            shape_scores = self._score_sets(
                self._unseen_shape_combos(pins, shape_pool, k, rand),
                self._score_shape_set, tw, km)

        results = []
        if "color" in allowed:
            if not color_candidates:
                warnings.warn("CatPAL: every generated color palette was removed by the exclude list.")
            ordered = sorted(color_candidates.values(), key=by_score_then_spread)
            diverse = self._diverse_filter(
                ordered, top, lambda c: self._proxy_set(c["labs"]), lambda c: c["labs"])
            for c in diverse:
                results.append(Palette(
                    enc="color", score=c["score"], mean_de=c["meanDe"], color_labs=c["labs"],
                    color_hex=[lab_to_hex(*lab) for lab in c["labs"]]))

        if "shape" in allowed:
            ordered = sorted(shape_scores.values(), key=lambda e: -e["score"])
            for e in self._diverse_filter(ordered, top, lambda e: _oset(e["ids"])):
                results.append(Palette(enc="shape", score=e["score"], shape_ids=e["ids"]))

        if "redundant" in allowed and color_candidates and shape_scores:
            thresh_c = self._weighted_beta_threshold(tw, self._beta_color)
            thresh_s = self._weighted_beta_threshold(tw, self._beta_shape)
            c_high, c_low = self._split_by_strength(
                color_candidates.values(),
                lambda c: [self._nearest_pool_id(lab) for lab in c["labs"]],
                tw, self._beta_color, thresh_c)
            s_high, s_low = self._split_by_strength(
                shape_scores.values(), lambda e: e["ids"], tw, self._beta_shape, thresh_s)
            candidates = []
            for q, cb, sb in (("Q1", c_high, s_high), ("Q2", c_high, s_low),
                              ("Q3", c_low, s_high), ("Q4", c_low, s_low)):
                if not cb or not sb:
                    continue
                dg = self._w_delta_g(q, tw, km)
                for cs in cb[:top]:
                    for ss in sb[:top]:
                        candidates.append(Palette(
                            enc="redundant", score=(cs["score"] + ss["score"]) / 2 + dg,
                            color_labs=cs["labs"],
                            color_hex=[lab_to_hex(*lab) for lab in cs["labs"]],
                            shape_ids=ss["ids"]))
            candidates.sort(key=lambda r: -r.score)
            n_colors = len(self.colors)
            results.extend(self._diverse_filter(
                candidates, top,
                lambda r: _oset([self._nearest_pool_id(lab) for lab in r.color_labs]
                                + [n_colors + i for i in r.shape_ids])))

        results.sort(key=lambda r: -r.score)
        return results[:top]

    # ── Greedy palette construction ────────────────────────────────────────────
    def _construct_palette(self, seed_lab, k, task, rng_seed, km=None,
                           pinned_labs=None, excluded_proxies=None):
        score_k = km if km is not None else map_k(k)
        rng = SeededRng(rng_seed)
        palette = [list(lab) for lab in pinned_labs] if pinned_labs else [list(seed_lab)]
        min_de = 25.0
        n_candidates = 300
        nearest = self._nearest_pool_id
        pw = self._pw_color_acc

        palette_proxies = [nearest(lab) for lab in palette]
        used_proxies = set(palette_proxies)

        def pair_acc(p, q):
            if p == q:
                return 0.5
            acc = pw(p, q, task, score_k)
            return 0.5 if acc is None else acc

        base_sum, base_cnt = 0, 0
        for x in range(len(palette_proxies)):
            for y in range(x + 1, len(palette_proxies)):
                base_sum += pair_acc(palette_proxies[x], palette_proxies[y])
                base_cnt += 1

        def far_enough(c, floor):
            for p in palette:
                if delta_e76(c, p) < floor:
                    return False
            return True

        for _ in range(k - len(palette)):
            candidates = [_sample_lab(rng, 25, 80, 20, 70) for _ in range(n_candidates)]
            spaced = [(c, nearest(c)) for c in candidates if far_enough(c, min_de)]

            valid = [(c, p) for c, p in spaced
                     if p not in used_proxies
                     and not (excluded_proxies and p in excluded_proxies)]
            if not valid and excluded_proxies:
                valid = [(c, p) for c, p in spaced if p not in used_proxies]
            if not valid:
                valid = spaced
            if not valid:
                extra = [_sample_lab(rng, 25, 80, 20, 70) for _ in range(1000)]
                valid = [(c, None) for c in extra if far_enough(c, min_de)]
            if not valid:
                break

            best_score, best_c, best_proxy = -math.inf, None, -1
            for c, proxy in valid:
                if proxy is None:
                    proxy = nearest(c)
                total, cnt = base_sum, base_cnt
                for px in palette_proxies:
                    total += pair_acc(proxy, px)
                    cnt += 1
                score = total / cnt if cnt > 0 else 0.5
                if score > best_score:
                    best_score, best_c, best_proxy = score, c, proxy

            for px in palette_proxies:
                base_sum += pair_acc(best_proxy, px)
                base_cnt += 1
            palette.append(best_c)
            palette_proxies.append(best_proxy)
            used_proxies.add(best_proxy)
        return palette

    def _score_unseen_color_set(self, labs, task, k):
        proxies = [self._nearest_pool_id(lab) for lab in labs]
        total, cnt = 0, 0
        for x in range(len(proxies)):
            for y in range(x + 1, len(proxies)):
                if proxies[x] == proxies[y]:
                    total += 0.5
                else:
                    acc = self._pw_color_acc(proxies[x], proxies[y], task, k)
                    total += acc if acc is not None else 0.5
                cnt += 1
        return total / cnt if cnt > 0 else 0.5

    # ══════════════════════════════════════════════════════════════════════════
    # Public API
    # ══════════════════════════════════════════════════════════════════════════

    def recommend(self, k=None, task=None, enc="color", top=5, *,
                  n_runs=None, seed=None, pin_hex=(), pin_shapes=(),
                  exclude=None, rng_seed=None) -> List[Palette]:
        """Recommend palettes, best first. See the README for every option.

        k: number of categories (2-10).
        task: task id 1-7, task key, ``{task: weight}`` dict, or None for all tasks.
        enc: "color", "shape", "redundant", "all", or a list of the first three.
        top: number of palettes to return.
        rng_seed: integer for reproducible results.
        """
        _check_common(top, rng_seed)
        _check_k(k)
        encs = list(enc) if isinstance(enc, (list, tuple)) else [enc]
        for e in encs:
            if e != "all" and e not in _ENCODINGS:
                raise ValueError(
                    'CatPAL: enc must be "color", "shape", "redundant", "all", or a list '
                    "of the first three; got %r." % (e,))
        if n_runs is not None and (not _is_int(n_runs) or n_runs < 1):
            raise ValueError("CatPAL: n_runs must be a positive integer.")
        if seed is not None and not (
                isinstance(seed, (list, tuple)) and len(seed) == 3
                and all(_finite_number(v) for v in seed)):
            raise TypeError("CatPAL: seed must be an [L, a, b] list of three numbers.")
        o = {
            "k": k, "top": top, "task": resolve_task(task),
            "allowed": set(_ENCODINGS) if "all" in encs else set(encs),
            "exclude": _normalize_exclude(exclude),
            "pinShapes": _check_id_list(list(pin_shapes), "pin_shapes"),
            "pinHex": _check_hex_list(list(pin_hex), "pin_hex"),
            "seed": list(seed) if seed is not None else None,
            "rngSeed": rng_seed,
        }
        o["nRuns"] = 20 if n_runs is None else n_runs
        return self._unseen_mode(o)

    def shape_pool(self) -> List[Dict[str, Any]]:
        """The 39 shapes tested in the experiments (id, type, ...)."""
        return [dict(s) for s in self.shapes]

    def suggest_swap(self, result, slot_type, slot_idx, *, k, task=None, top=5,
                     exclude=None, n_samples=500, rng_seed=None) -> List[Swap]:
        """Score replacements for one color or shape of ``result``, best first.

        The rest of the palette is held fixed. ``slot_type`` is "color" or
        "shape"; ``slot_idx`` is the position within the palette.
        """
        _check_common(top, rng_seed)
        _check_k(k)
        exclude = _normalize_exclude(exclude)
        km = map_k(k)
        tw = self._resolve_task_weights(resolve_task(task))
        get = result.get if isinstance(result, dict) else lambda name: getattr(result, name, None)
        current = get("score")
        color_labs, shape_ids = get("color_labs"), get("shape_ids")

        alts: List[dict] = []
        if slot_type == "color" and color_labs:
            others = [lab for j, lab in enumerate(color_labs) if j != slot_idx]
            rng = SeededRng(math.floor(_make_rand(rng_seed)() * 1e9))
            for _ in range(n_samples):
                Ls = rng.uniform(25, 80)
                Cs = rng.uniform(20, 70)
                hs = rng.uniform(0, 360) * math.pi / 180
                lab = [Ls, Cs * math.cos(hs), Cs * math.sin(hs)]
                if any(delta_e76(lab, p) < 25 for p in others):
                    continue
                new_labs = [lab if j == slot_idx else other for j, other in enumerate(color_labs)]
                wscore = 0
                for t, w in tw:
                    wscore += w * self._score_unseen_color_set(new_labs, t, km)
                alts.append({"lab": lab, "hex": lab_to_hex(*lab), "score": wscore})
        elif slot_type == "shape" and shape_ids:
            exc_shapes = set(exclude["shapeIds"])
            occupied = {s for j, s in enumerate(shape_ids) if j != slot_idx}
            for s in self.shapes:
                sid = s["id"]
                if sid in occupied or sid in exc_shapes or sid == shape_ids[slot_idx]:
                    continue
                new_ids = sorted(sid if j == slot_idx else i for j, i in enumerate(shape_ids))
                alts.append({"id": sid,
                             "score": self._w_score(self._score_shape_set, new_ids, tw, km)})

        alts.sort(key=lambda a: -a["score"])
        return [Swap(delta=a["score"] - current, **a) for a in alts[:top]]
