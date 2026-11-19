# CatPAL

Task-aware palette recommendation for categorical data visualization.

Tell CatPAL how many categories you have and what your readers need to do with
the chart (spot outliers, compare clusters, judge correlation, ...). It returns
color palettes, shape palettes, or redundant color + shape palettes, ranked by
how accurately people performed that task with them in crowdsourced experiments.

This repository contains the recommendation engine as a library for
**JavaScript** and **Python**. Both have no dependencies, bundle the model data,
and return the same palettes for the same input.

- Paper: [CatPAL: Task-Aware Learning for Categorical Palette Recommendation](https://arxiv.org/abs/2608.09108)
- Web tool: https://catpal-palette-automation.web.app

## Install

```sh
npm install catpal      # JavaScript / TypeScript
pip install catpal      # Python 3.9+
```

Or install straight from this repository:

```sh
pip install "git+https://github.com/CU-VisuaLab/CatPAL.git#subdirectory=python"
```

For JavaScript from a clone, see [Development](#development).

## Quick start

**JavaScript**

```js
import { recommend } from "catpal";

const palettes = recommend({ k: 6, task: "outlier-detection" });

palettes[0].colorHex;  // ["#264AA8", "#D6594E", "#97CBEB", ...]
palettes[0].score;     // 0.93  (predicted accuracy; 0.5 is chance)
```

**Python**

```python
import catpal

palettes = catpal.recommend(k=6, task="outlier-detection")

palettes[0].color_hex  # ["#264AA8", "#D6594E", "#97CBEB", ...]
palettes[0].score      # 0.93
```

**Browser, no build step**

```html
<script src="https://cdn.jsdelivr.net/npm/catpal"></script>
<script>
  const palettes = catpal.recommend({ k: 6, task: "outlier-detection" });
</script>
```

Results are returned best first. Without a seed each call explores different
colors; pass `rngSeed` / `rng_seed` to make a call reproducible.

## Tasks

Pass a task by id or by key. Pass several with weights to blend them, or leave
`task` out to weight all seven equally.

| id | key | Task |
| --- | --- | --- |
| 1 | `cluster-identification` | Cluster identification |
| 2 | `spatial-distribution` | Spatial distribution |
| 3 | `dispersion-estimation` | Dispersion estimation |
| 4 | `outlier-detection` | Outlier detection |
| 5 | `correlation-identification` | Correlation identification |
| 6 | `quantity-comparison` | Quantity comparison |
| 7 | `proximity-judgment` | Proximity judgment |

```js
recommend({ k: 6, task: { "outlier-detection": 0.6, "cluster-identification": 0.4 } });
```

```python
catpal.recommend(k=6, task={"outlier-detection": 0.6, "cluster-identification": 0.4})
```

## Options

| JavaScript | Python | Default | Meaning |
| --- | --- | --- | --- |
| `k` | `k` | required | Number of categories, 2 to 10. |
| `task` | `task` | all tasks | Task id, key, or `{task: weight}`. |
| `enc` | `enc` | `"color"` | `"color"`, `"shape"`, `"redundant"` (color + shape), `"all"`, or a list. |
| `top` | `top` | `5` | How many palettes to return. |
| `rngSeed` | `rng_seed` | none | Integer; makes the result reproducible. |
| `pinHex` | `pin_hex` | none | Hex colors that must appear in every palette (e.g. brand colors). See the note below. |
| `pinShapes` | `pin_shapes` | none | Shape ids that must appear. See the note below. |
| `exclude` | `exclude` | none | Things to avoid: `hexCodes` / `hex_codes` (colors), `shapeIds` / `shape_ids`. |
| `nRuns` | `n_runs` | `20` | Construction attempts per pass. More is slower and explores more. |
| `seed` | `seed` | none | An `[L, a, b]` color to start every palette from. |

**Pinning more than `k` colors or shapes.** With fewer pinned items than `k`,
CatPAL keeps them all and fills the remaining slots. With more than `k`, it
adds nothing of its own: every result is a `k`-sized subset of what you
pinned, ranked by predicted performance, best first. This is a way to ask
"which `k` of my colors (or shapes) work best for this task?"

Invalid options raise an error that says what was wrong.

## Results

Each result describes one palette. Fields that do not apply are `null` / `None`.

| JavaScript | Python | Meaning |
| --- | --- | --- |
| `enc` | `enc` | `"color"`, `"shape"`, or `"redundant"`. |
| `score` | `score` | Predicted accuracy for your task(s): mean pairwise accuracy, where 0.5 is chance. |
| `colorHex` | `color_hex` | The colors, as `#RRGGBB`. |
| `colorLabs` | `color_labs` | The same colors in CIELAB. |
| `shapeIds` | `shape_ids` | Shape ids; turn them into artwork with `shapeSvg` / `shape_svg`. |
| `meanDe` | `mean_de` | Mean pairwise color difference (ΔE76) within the palette. |

In Python a result is a `Palette` object; call `.to_dict()` for a plain dict.

## More examples

**Keep brand colors and avoid others**

```js
recommend({
  k: 6,
  task: "cluster-identification",
  pinHex: ["#1f77b4", "#ff7f0e"],
  exclude: { hexCodes: ["#4B0082"] },
});
```

```python
catpal.recommend(
    k=6,
    task="cluster-identification",
    pin_hex=["#1f77b4", "#ff7f0e"],
    exclude={"hex_codes": ["#4B0082"]},
)
```

**Shapes, and color + shape together**

```js
import { recommend, shapeSvg } from "catpal";

const [best] = recommend({ k: 4, task: "outlier-detection", enc: "redundant" });
best.colorHex;                       // one color per category
best.shapeIds;                       // one shape per category
const svg = shapeSvg(best.shapeIds[0], { color: best.colorHex[0] });
```

```python
best = catpal.recommend(k=4, task="outlier-detection", enc="redundant")[0]
svg = catpal.shape_svg(best.shape_ids[0], color=best.color_hex[0])
```

`enc: "all"` compares color, shape, and redundant palettes and returns the
best overall.

**Replace one color or shape**

```js
import { recommend, suggestSwap } from "catpal";

const [palette] = recommend({ k: 6, task: 4 });
const options = suggestSwap(palette, "color", 2, { k: 6, task: 4 });
options[0];  // { hex, labs, score, delta }  (delta = change in score)
```

```python
palette = catpal.recommend(k=6, task=4)[0]
options = catpal.suggest_swap(palette, "color", 2, k=6, task=4)
options[0]  # Swap(score=..., delta=..., hex=..., lab=[...])
```

**The tested shapes**

`getShapePool()` / `shape_pool()` returns the 39 shapes used in the
experiments. Colors are always generated, so they have no ids.

## How it works

- The model data holds, for every pair of tested colors (and every pair of
  tested shapes), how accurately people did each task when those two were used
  together. A palette's score is the mean of its pairwise accuracies.
- The experiments used 3, 6 and 9 categories. Other sizes are scored with the
  nearest of those: 2-4 → 3, 5-7 → 6, 8-10 → 9.
- CatPAL builds new color palettes greedily from random starting colors, as
  the web tool does, keeping every pair at least ΔE76 25 apart. A new color is
  scored through the tested color nearest to it.
- A redundant palette's score is the average of its color and shape scores,
  adjusted by the gain (or loss) measured when both encodings were shown
  together.

The paper has the full method and its evaluation.

## JavaScript and Python parity

Both packages are tested against the same file of expected outputs
(`tests/golden/cases.json`), so the same options and seed give the same
palettes in either language. The JavaScript engine is also tested to return
exactly what the web tool's engine returns when given the same random numbers
(`tests/golden/web-engine.json` holds that engine's recorded outputs).

The pure-Python engine is slower: a default call takes about two seconds,
against a few milliseconds in JavaScript. Lower `n_runs` or `top` if you need
it faster.

## Development

```
data/      canonical model data and shape artwork
js/        npm package      (src/engine.js is the engine)
python/    PyPI package     (src/catpal/engine.py is a port of the JS engine)
tests/     expected outputs shared by both test suites, and the web tool's
           recorded outputs
scripts/   sync_data.py copies data/ and the licenses into both packages
```

```sh
# JavaScript: build and test
cd js && npm install && npm test

# Python: test from the source tree
cd python && PYTHONPATH=src python -m unittest discover -s tests
```

To use the libraries from a clone:

```sh
pip install ./python
cd js && npm install && npm run build    # then: npm install /path/to/CatPAL/js
```

When changing engine behavior, change both engines, then regenerate the golden
file with `node js/scripts/make-golden.mjs` and rerun both test suites. When the
model data changes, replace `data/catpal_model_data.json` and run
`python scripts/sync_data.py`.

## Citation

If you use CatPAL, please cite the paper:

> Chin Tseng, Arran Zeyu Wang, Yunqi Li, and Danielle Albers Szafir.
> CatPAL: Task-Aware Learning for Categorical Palette Recommendation.
> arXiv:2608.09108, 2026. https://arxiv.org/abs/2608.09108

```bibtex
@article{tseng2026catpal,
  title   = {CatPAL: Task-Aware Learning for Categorical Palette Recommendation},
  author  = {Tseng, Chin and Wang, Arran Zeyu and Li, Yunqi and Szafir, Danielle Albers},
  journal = {arXiv preprint arXiv:2608.09108},
  year    = {2026},
  url     = {https://arxiv.org/abs/2608.09108}
}
```

## License

Code: [MIT](LICENSE). Model data and shape artwork:
[CC BY 4.0](LICENSE-DATA), which asks that you credit the paper.
