#!/usr/bin/env python3
"""Copy the canonical data and license files into both packages.

data/catpal_model_data.json, data/shapes/*.svg and the root LICENSE files are
the source of truth; each package carries copies so it can be published alone.
Run this after changing either, then rebuild and rerun the tests:

    python scripts/sync_data.py
"""
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
TARGETS = [ROOT / "js" / "data", ROOT / "python" / "src" / "catpal" / "data"]


def main():
    shapes = {}
    for path in DATA.glob("shapes/*.svg"):
        shapes[int(path.stem)] = path.read_text(encoding="utf-8").strip()
    ids = sorted(shapes)
    assert ids == list(range(len(ids))), "shape files must be numbered 0..n-1"
    with open(DATA / "shapes.json", "w", encoding="utf-8") as f:
        json.dump({str(i): shapes[i] for i in ids}, f, ensure_ascii=False, indent=0)

    for target in TARGETS:
        target.mkdir(parents=True, exist_ok=True)
        for name in ("catpal_model_data.json", "shapes.json"):
            shutil.copyfile(DATA / name, target / name)
        print("synced", target.relative_to(ROOT))
    for package in (ROOT / "js", ROOT / "python"):
        for name in ("LICENSE", "LICENSE-DATA"):
            shutil.copyfile(ROOT / name, package / name)


if __name__ == "__main__":
    main()
