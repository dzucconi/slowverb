#!/usr/bin/env python3
from __future__ import annotations

import json
import re
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INPUT_DIR = ROOT / "data" / "wayback-lyrics" / "clean" / "lyrics"
OUTPUT_PATH = ROOT / "public" / "chain.json"
SUMMARY_PATH = ROOT / "data" / "wayback-lyrics" / "clean" / "chain-summary.json"
ORDERS = (2, 3, 4)


def tokenize(line: str) -> list[str]:
    parts = [part.strip() for part in line.split()]
    tokens = [part for part in parts if part]
    return [token for token in tokens if not re.fullmatch(r"[\[\]{}]+", token)]


def iter_lines(text: str) -> list[str]:
    return [line.strip() for line in text.splitlines() if line.strip()]


def build_chain() -> tuple[dict[str, dict[str, list[str]]], dict[str, int]]:
    if not INPUT_DIR.exists():
        raise SystemExit(f"Input directory not found: {INPUT_DIR}")

    chains: dict[str, defaultdict[str, list[str]]] = {
        str(order): defaultdict(list) for order in ORDERS
    }
    stats: dict[str, int] = {
        "input_files": 0,
        "lines_seen": 0,
        "lines_used": 0,
        "tokens_seen": 0,
        "transitions": 0,
        "starter_keys": 0,
    }

    for lyric_file in sorted(INPUT_DIR.glob("*.txt"), key=lambda p: p.name.casefold()):
        stats["input_files"] += 1
        text = lyric_file.read_text(encoding="utf-8", errors="replace")
        for line in iter_lines(text):
            stats["lines_seen"] += 1
            tokens = tokenize(line)
            stats["tokens_seen"] += len(tokens)
            if len(tokens) < 3:
                continue
            stats["lines_used"] += 1

            for order in ORDERS:
                if len(tokens) <= order:
                    continue
                for i in range(len(tokens) - order):
                    key = " ".join(tokens[i : i + order])
                    chains[str(order)][key].append(tokens[i + order])
                    stats["transitions"] += 1

    compact = {order: dict(chain) for order, chain in chains.items()}
    highest_order = str(max(ORDERS))
    stats["starter_keys"] = sum(
        1 for key in compact.get(highest_order, {}) if key[:1].isupper()
    )
    return compact, stats


def main() -> None:
    chain, stats = build_chain()
    if not chain:
        raise SystemExit("No chain entries were produced from clean lyrics.")
    if stats["starter_keys"] == 0:
        raise SystemExit("No starter keys found (keys beginning with A-Z).")

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(
        json.dumps(chain, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )

    SUMMARY_PATH.parent.mkdir(parents=True, exist_ok=True)
    SUMMARY_PATH.write_text(
        json.dumps(
            {
                **stats,
                "orders": list(ORDERS),
                "output_keys": {order: len(c) for order, c in chain.items()},
                "output_path": str(OUTPUT_PATH.relative_to(ROOT)),
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    print(f"Wrote chain: {OUTPUT_PATH}")
    print(f"Wrote summary: {SUMMARY_PATH}")
    print(f"Input files: {stats['input_files']}")
    print(f"Output keys by order: { {order: len(c) for order, c in chain.items()} }")
    print(f"Starter keys: {stats['starter_keys']}")
    print(f"Transitions: {stats['transitions']}")


if __name__ == "__main__":
    main()
