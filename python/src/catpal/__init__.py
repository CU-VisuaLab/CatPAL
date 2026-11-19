"""catpal — task-aware categorical palette recommendation.

The model data is bundled, so the module-level functions work out of the box::

    import catpal
    palettes = catpal.recommend(k=6, task="outlier-detection")
    palettes[0].color_hex
"""

import json
from importlib import resources
from typing import Any, Dict, List, Optional

from .engine import (
    TASKS,
    CatPAL,
    Palette,
    SeededRng,
    Swap,
    Task,
    delta_e76,
    hex_to_lab,
    lab_to_hex,
    map_k,
    resolve_task,
)

__version__ = "0.1.0"

__all__ = [
    "recommend", "suggest_swap", "shape_pool", "shape_svg",
    "get_model", "load_model_data",
    "CatPAL", "Palette", "Swap", "Task", "TASKS", "SeededRng",
    "delta_e76", "hex_to_lab", "lab_to_hex", "map_k", "resolve_task",
    "__version__",
]

_model: Optional[CatPAL] = None
_shapes: Optional[Dict[str, str]] = None


def _read_json(name: str) -> Any:
    with resources.files(__package__).joinpath("data", name).open(encoding="utf-8") as f:
        return json.load(f)


def load_model_data() -> Dict[str, Any]:
    """The bundled model data (fitted from the crowdsourced experiments)."""
    return _read_json("catpal_model_data.json")


def get_model() -> CatPAL:
    """The shared model instance built from the bundled data."""
    global _model
    if _model is None:
        _model = CatPAL(load_model_data())
    return _model


def recommend(k=None, task=None, enc="color", top=5, **options) -> List[Palette]:
    """Recommend palettes, best first. See ``CatPAL.recommend`` and the README."""
    return get_model().recommend(k, task, enc, top, **options)


recommend.__doc__ = CatPAL.recommend.__doc__


def suggest_swap(result, slot_type, slot_idx, **options) -> List[Swap]:
    """Score replacements for one color or shape of ``result``, best first."""
    return get_model().suggest_swap(result, slot_type, slot_idx, **options)


def shape_pool() -> List[Dict[str, Any]]:
    """The 39 shapes tested in the experiments."""
    return get_model().shape_pool()


def shape_svg(shape_id: int, color: Optional[str] = None) -> str:
    """SVG markup for a shape id (0-38), as found in a result's ``shape_ids``.

    Pass ``color`` (any CSS color) to draw it in that color instead of black.
    """
    global _shapes
    if _shapes is None:
        _shapes = _read_json("shapes.json")
    svg = _shapes.get(str(shape_id)) if isinstance(shape_id, int) else None
    if svg is None:
        raise ValueError("CatPAL: unknown shape id %r (expected 0-38)." % (shape_id,))
    if not color:
        return svg
    if not isinstance(color, str) or any(ch in color for ch in '"<>'):
        raise TypeError("CatPAL: color must be a CSS color string.")
    return svg.replace("#000", color).replace("<svg ", '<svg fill="%s" ' % color, 1)
