# catpal

Task-aware palette recommendation for categorical data visualization.

Tell CatPAL how many categories you have and what your readers need to do with
the chart. It returns color, shape, or redundant color + shape palettes, ranked
by how accurately people performed that task with them in crowdsourced
experiments. Pure Python, no dependencies; the model data is bundled.

```sh
pip install catpal
```

```python
import catpal

palettes = catpal.recommend(k=6, task="outlier-detection")

palettes[0].color_hex  # ["#264AA8", "#D6594E", "#97CBEB", ...]
palettes[0].score      # 0.93  (predicted accuracy; 0.5 is chance)
```

Use the colors directly, for example with matplotlib:

```python
import matplotlib.pyplot as plt

plt.rcParams["axes.prop_cycle"] = plt.cycler(color=palettes[0].color_hex)
```

Full documentation (tasks, every option, shapes, swaps):
https://github.com/CU-VisuaLab/CatPAL#readme

Paper: [CatPAL: Task-Aware Learning for Categorical Palette Recommendation](https://arxiv.org/abs/2608.09108)

Code is MIT licensed. The bundled model data and shape artwork are CC BY 4.0;
please credit the paper.
