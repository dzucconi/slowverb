#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CLEAN_ROOT = ROOT / "data" / "wayback-lyrics" / "clean"
REVIEW_DIR = CLEAN_ROOT / "review"
ENGLISH_DIR = CLEAN_ROOT / "lyrics"
NON_ENGLISH_DIR = CLEAN_ROOT / "non-english"


def unique_target_path(base_dir: Path, source_name: str) -> Path:
    candidate = base_dir / source_name
    stem = Path(source_name).stem
    suffix = Path(source_name).suffix
    idx = 2
    while candidate.exists():
        candidate = base_dir / f"{stem} ({idx}){suffix}"
        idx += 1
    return candidate


def preview_text(path: Path, max_lines: int = 18) -> str:
    text = path.read_text(encoding="utf-8", errors="replace")
    lines = text.splitlines()
    shown = lines[:max_lines]
    body = "\n".join(shown)
    if len(lines) > max_lines:
        body += f"\n... ({len(lines) - max_lines} more lines)"
    return body


def prompt_action() -> str:
    while True:
        raw = input("[e] english  [n] non-english  [s] skip  [q] quit: ").strip().lower()
        if raw in {"e", "n", "s", "q"}:
            return raw
        print("Please choose one of: e, n, s, q")


def main() -> None:
    if not REVIEW_DIR.exists():
        raise SystemExit(f"Review directory not found: {REVIEW_DIR}")
    ENGLISH_DIR.mkdir(parents=True, exist_ok=True)
    NON_ENGLISH_DIR.mkdir(parents=True, exist_ok=True)

    files = sorted(REVIEW_DIR.glob("*.txt"), key=lambda p: p.name.casefold())
    if not files:
        print("No files in review directory.")
        return

    moved_english = 0
    moved_non_english = 0
    skipped = 0

    total = len(files)
    for idx, file_path in enumerate(files, start=1):
        print("\n" + "=" * 72)
        print(f"[{idx}/{total}] {file_path.name}")
        print("-" * 72)
        print(preview_text(file_path))
        print("-" * 72)
        action = prompt_action()

        if action == "q":
            print("Stopped by user.")
            break
        if action == "s":
            skipped += 1
            continue

        target_dir = ENGLISH_DIR if action == "e" else NON_ENGLISH_DIR
        target_path = unique_target_path(target_dir, file_path.name)
        file_path.rename(target_path)

        if action == "e":
            moved_english += 1
        else:
            moved_non_english += 1

    remaining = len(list(REVIEW_DIR.glob("*.txt")))
    print("\nReview session complete.")
    print(f"Moved to english: {moved_english}")
    print(f"Moved to non-english: {moved_non_english}")
    print(f"Skipped: {skipped}")
    print(f"Remaining in review: {remaining}")


if __name__ == "__main__":
    main()
