import filecmp
import os
import unittest

import catpal

ROOT = os.path.join(os.path.dirname(__file__), "..", "..")


class ApiTest(unittest.TestCase):
    def test_defaults(self):
        results = catpal.recommend(k=4, rng_seed=2)
        self.assertEqual(len(results), 5)
        for p in results:
            self.assertEqual(p.enc, "color")
            self.assertEqual(len(p.color_hex), 4)
            self.assertRegex("".join(p.color_hex), r"^(#[0-9A-F]{6}){4}$")
            self.assertTrue(0.5 < p.score <= 1)
            self.assertEqual(p.to_dict()["color_hex"], p.color_hex)

    def test_reproducible_with_seed_and_runs_without(self):
        a = catpal.recommend(k=7, task=2, enc="all", n_runs=4, rng_seed=42)
        b = catpal.recommend(k=7, task=2, enc="all", n_runs=4, rng_seed=42)
        self.assertEqual(a, b)
        self.assertTrue(catpal.recommend(k=7, task=2, enc="all", n_runs=4))

    def test_task_keys_and_ids(self):
        by_key = catpal.recommend(k=5, task="Outlier Detection", n_runs=4, rng_seed=3)
        by_id = catpal.recommend(k=5, task=4, n_runs=4, rng_seed=3)
        self.assertEqual(by_key, by_id)
        self.assertEqual([t.id for t in catpal.TASKS], list(range(1, 8)))

    def test_generated_colors_are_spaced(self):
        for p in catpal.recommend(k=8, task=1, n_runs=4, rng_seed=5):
            labs = p.color_labs
            for i in range(len(labs)):
                for j in range(i + 1, len(labs)):
                    self.assertGreaterEqual(catpal.delta_e76(labs[i], labs[j]), 25)

    def test_invalid_options(self):
        bad = [
            (dict(), "k \\(number of categories\\)"),
            (dict(k=11), "k \\(number of categories\\)"),
            (dict(k=True), "k \\(number of categories\\)"),
            (dict(k=6, task=8), "unknown task"),
            (dict(k=6, task="nope"), "unknown task"),
            (dict(k=6, task={1: -1}), "non-negative"),
            (dict(k=6, enc="colour"), "enc must be"),
            (dict(k=6, top=0), "top must be"),
            (dict(k=6, rng_seed=1.5), "rng_seed"),
            (dict(k=6, pin_hex=["red"]), "invalid hex"),
            (dict(k=6, exclude={"hex_codes": ["#12"]}), "invalid hex"),
            (dict(k=6, exclude={"shape_ids": [39]}), "invalid id"),
            (dict(k=6, seed=[1, 2]), "seed must be"),
        ]
        for kwargs, pattern in bad:
            with self.subTest(kwargs=kwargs):
                with self.assertRaisesRegex((ValueError, TypeError), pattern):
                    catpal.recommend(**kwargs)

    def test_shape_pool_and_artwork(self):
        self.assertEqual(len(catpal.shape_pool()), 39)
        for i in range(39):
            self.assertRegex(catpal.shape_svg(i), r"(?s)<svg.*</svg>$")
        red = catpal.shape_svg(13, color="#ff0000")
        self.assertIn('fill="#ff0000"', red)
        self.assertIn("stroke: #ff0000", red)
        self.assertNotIn("#000", red)
        with self.assertRaises(ValueError):
            catpal.shape_svg(39)

    def test_color_round_trip(self):
        for h in ["#000000", "#FFFFFF", "#1F77B4", "#D62728", "#7FC97F"]:
            self.assertEqual(catpal.lab_to_hex(*catpal.hex_to_lab(h)), h)

    def test_swap_accepts_dict_results(self):
        base = catpal.recommend(k=4, task=6, enc="shape", rng_seed=17)[0]
        a = catpal.suggest_swap(base, "shape", 0, k=4, task=6)
        b = catpal.suggest_swap(base.to_dict(), "shape", 0, k=4, task=6)
        self.assertEqual(a, b)
        self.assertTrue(all(s.id not in base.shape_ids for s in a))

    def test_packaged_data_matches_canonical(self):
        pkg = os.path.join(os.path.dirname(catpal.__file__), "data")
        for name in ("catpal_model_data.json", "shapes.json"):
            self.assertTrue(
                filecmp.cmp(os.path.join(pkg, name), os.path.join(ROOT, "data", name), shallow=False),
                name)


if __name__ == "__main__":
    unittest.main()
