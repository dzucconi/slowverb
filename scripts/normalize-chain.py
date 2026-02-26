#!/usr/bin/env python3
from __future__ import annotations

import json
import unicodedata
from collections import defaultdict
from pathlib import Path

CHAIN_PATH = Path(__file__).resolve().parent.parent / "public" / "chain.json"

CP1252_MAP = {
    "\x91": "‘",
    "\x92": "’",
    "\x93": "“",
    "\x94": "”",
    "\x96": "–",
    "\x97": "—",
}

BROKEN_UTF8_FRAGMENTS = {
    "\x80\x98": "‘",
    "\x80\x99": "’",
    "\x80\x9c": "“",
    "\x80\x9d": "”",
    "\x80\x93": "–",
    "\x80\x94": "—",
}

TOKEN_FIXES = {
    "youã\x83": "you",
}


def normalize_token(token: str) -> str:
    normalized = unicodedata.normalize("NFC", token)

    for source, target in BROKEN_UTF8_FRAGMENTS.items():
        normalized = normalized.replace(source, target)

    for source, target in CP1252_MAP.items():
        normalized = normalized.replace(source, target)

    # Unify apostrophes to typographic right single quote while preserving style.
    normalized = normalized.replace("'", "’")
    normalized = TOKEN_FIXES.get(normalized, normalized)

    return normalized


def run() -> None:
    chain: dict[str, list[str]] = json.loads(CHAIN_PATH.read_text(encoding="utf-8"))

    rewritten: dict[str, list[str]] = defaultdict(list)
    key_changes = 0
    value_changes = 0

    for key, values in chain.items():
        normalized_key_parts = [normalize_token(part) for part in key.split(" ")]
        normalized_key = " ".join(normalized_key_parts)
        if normalized_key != key:
            key_changes += 1

        normalized_values = []
        for value in values:
            normalized_value = normalize_token(value)
            if normalized_value != value:
                value_changes += 1
            normalized_values.append(normalized_value)

        rewritten[normalized_key].extend(normalized_values)

    CHAIN_PATH.write_text(
        json.dumps(dict(rewritten), ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )

    print(f"Normalized chain at {CHAIN_PATH}")
    print(f"Key changes: {key_changes}")
    print(f"Value changes: {value_changes}")
    print(f"Output keys: {len(rewritten)}")


if __name__ == "__main__":
    run()
