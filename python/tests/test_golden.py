"""The Python engine must reproduce the golden outputs shared with the JS package."""

import json
import math
import os
import unittest

import catpal

GOLDEN = os.path.join(os.path.dirname(__file__), "..", "..", "tests", "golden", "cases.json")

# JavaScript option / result names → Python names.
OPTION_NAMES = {
    "nRuns": "n_runs", "rngSeed": "rng_seed", "pinHex": "pin_hex",
    "pinShapes": "pin_shapes",
    "nSamples": "n_samples",
}
RESULT_NAMES = {
    "colorHex": "color_hex", "colorLabs": "color_labs",
    "shapeIds": "shape_ids", "meanDe": "mean_de",
    "labs": "lab",
}


def to_kwargs(opts):
    return {OPTION_NAMES.get(name, name): value for name, value in opts.items()}


def run_case(case):
    if case["kind"] == "recommend":
        return catpal.recommend(**to_kwargs(case["opts"]))
    base = catpal.recommend(**to_kwargs(case["base"]))[0]
    return catpal.suggest_swap(base, case["slotType"], case["slotIdx"], **to_kwargs(case["opts"]))


class GoldenTest(unittest.TestCase):
    def assert_same(self, got, expected, where):
        if isinstance(expected, float) or isinstance(got, float):
            self.assertTrue(
                math.isclose(got, expected, rel_tol=1e-9, abs_tol=1e-9),
                "%s: %r != %r" % (where, got, expected))
        elif isinstance(expected, list):
            self.assertEqual(len(got), len(expected), where)
            for i, (g, e) in enumerate(zip(got, expected)):
                self.assert_same(g, e, "%s[%d]" % (where, i))
        else:
            self.assertEqual(got, expected, where)

    def test_golden_cases(self):
        with open(GOLDEN, encoding="utf-8") as f:
            cases = json.load(f)
        self.assertGreater(len(cases), 20)
        for case in cases:
            with self.subTest(case=case["name"]):
                got = run_case(case)
                self.assertEqual(len(got), len(case["expected"]), "number of results")
                for i, (g, e) in enumerate(zip(got, case["expected"])):
                    for name, value in e.items():
                        attr = RESULT_NAMES.get(name, name)
                        self.assert_same(getattr(g, attr), value, "result %d %s" % (i, name))


if __name__ == "__main__":
    unittest.main()
