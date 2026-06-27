"""CareerProfile helpers for ResumePilot.

The platform can pass plain dictionaries into this package. These helpers keep
the expected shape explicit without requiring a heavier runtime dependency.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Mapping, Optional


JsonDict = Dict[str, Any]


@dataclass(frozen=True)
class ProfileItem:
    """A normalized item with optional source evidence ids."""

    data: JsonDict
    source_ids: List[str]


def as_dict(value: Any) -> JsonDict:
    if isinstance(value, Mapping):
        return dict(value)
    return {}


def as_list(value: Any) -> List[Any]:
    if isinstance(value, list):
        return value
    if value is None:
        return []
    return [value]


def compact_dict(data: Mapping[str, Any]) -> JsonDict:
    """Drop empty values recursively while preserving booleans and zeroes."""

    compacted: JsonDict = {}
    for key, value in data.items():
        if isinstance(value, Mapping):
            nested = compact_dict(value)
            if nested:
                compacted[key] = nested
        elif isinstance(value, list):
            items = []
            for item in value:
                if isinstance(item, Mapping):
                    nested_item = compact_dict(item)
                    if nested_item:
                        items.append(nested_item)
                elif item not in (None, ""):
                    items.append(item)
            if items:
                compacted[key] = items
        elif value not in (None, ""):
            compacted[key] = value
    return compacted


def get_first(data: Mapping[str, Any], keys: Iterable[str], default: Any = "") -> Any:
    for key in keys:
        value = data.get(key)
        if value not in (None, ""):
            return value
    return default


def source_ids_for(item: Any, fallback: Optional[List[str]] = None) -> List[str]:
    """Extract source ids from profile items.

    ResumePilot should attach ids from `evidence[]` to edited fields whenever a
    user confirms new information in chat. Plain strings can use the caller's
    fallback source ids.
    """

    fallback = list(fallback or [])
    if not isinstance(item, Mapping):
        return fallback

    raw = item.get("source_ids") or item.get("sourceIds") or item.get("evidence_ids") or item.get("evidenceIds")
    if isinstance(raw, str):
        return [raw]
    if isinstance(raw, list):
        return [str(value) for value in raw if value]
    return fallback


def text_for(value: Any, *keys: str) -> str:
    if isinstance(value, Mapping):
        for key in keys:
            raw = value.get(key)
            if raw not in (None, ""):
                return str(raw).strip()
        return ""
    return str(value).strip() if value not in (None, "") else ""
