#!/usr/bin/env python3
from __future__ import annotations

import html
import json
import re
import shutil
import unicodedata
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data" / "wayback-lyrics" / "lyrics"
CLEAN_ROOT = ROOT / "data" / "wayback-lyrics" / "clean"
CLEAN_LYRICS_DIR = CLEAN_ROOT / "lyrics"
NON_ENGLISH_DIR = CLEAN_ROOT / "non-english"
REVIEW_DIR = CLEAN_ROOT / "review"
MANIFEST_PATH = CLEAN_ROOT / "manifest.json"
SUMMARY_PATH = CLEAN_ROOT / "summary.json"

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
    "ï¿½": "",
}

NOISE_PATTERNS = [
    re.compile(r"^\s*[\[\]]+\s*$"),
    re.compile(r"^\s*back\s*$", re.IGNORECASE),
    re.compile(r"^\s*print\s*$", re.IGNORECASE),
    re.compile(r"^\s*top\s*$", re.IGNORECASE),
    re.compile(r"^\s*-+\s*submit your lyric\s*-+\s*$", re.IGNORECASE),
    re.compile(r"^\s*thanks to:.*$", re.IGNORECASE),
    re.compile(r"^\s*last referer keywords:.*$", re.IGNORECASE),
    re.compile(r"^\s*all lyrics on this website.*$", re.IGNORECASE),
    re.compile(r"^\s*if you believe any of the lyrics.*$", re.IGNORECASE),
    re.compile(r"^\s*home\s*>\s*lyrics result\s*$", re.IGNORECASE),
]


@dataclass(frozen=True)
class CleanResult:
    title: str
    body: str
    body_fingerprint: str
    quality_score: int



def _smartify_quotes(text: str) -> str:
    """Normalize all quote characters to proper curly/smart quotes."""
    RSQUO = "\u2019"
    LDQUO = "\u201c"
    RDQUO = "\u201d"
    # Normalize variants to straight first, then smartify
    text = text.replace("\u00b4", "'")
    text = text.replace("`", "'")
    text = text.replace("\u2018", "'")
    text = text.replace("\u2019", "'")
    text = text.replace("\u201c", '"')
    text = text.replace("\u201d", '"')
    # Double quotes
    text = re.sub(r'(^|[\s(])"', lambda m: m.group(1) + LDQUO, text, flags=re.MULTILINE)
    text = text.replace('"', RDQUO)
    # Apostrophe within words
    text = re.sub(r"(?<=[a-zA-Z])'(?=[a-zA-Z])", RSQUO, text)
    # Trailing apostrophe
    text = re.sub(r"(?<=[a-zA-Z])'(?=\s|$|[,;:.!?])", RSQUO, text, flags=re.MULTILINE)
    # Leading contraction
    text = re.sub(r"(?<=\s)'(?=[a-zA-Z])", RSQUO, text)
    text = re.sub(r"^'(?=[a-zA-Z])", RSQUO, text, flags=re.MULTILINE)
    # Remaining straight singles
    text = text.replace("'", RSQUO)
    return text


def normalize_text(value: str) -> str:
    text = unicodedata.normalize("NFC", value)
    for source, target in BROKEN_UTF8_FRAGMENTS.items():
        text = text.replace(source, target)
    for source, target in CP1252_MAP.items():
        text = text.replace(source, target)
    # Some pages are double-escaped (e.g. "&amp;#305;"), so decode entities
    # repeatedly until stable (bounded to avoid pathological loops).
    for _ in range(4):
        decoded = html.unescape(text)
        if decoded == text:
            break
        text = decoded
    # Dotless i commonly appears from entity-decoded scrape artifacts in this corpus.
    text = text.replace("ı", "i")
    text = text.replace("�", "\u2019")
    text = _smartify_quotes(text)
    text = text.replace("\\", "")
    text = re.sub(r"<?\s*/?br\s*/?>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", "", text)
    text = re.sub(r"[.…]{2,}", "…", text)
    text = re.sub(r"…(?=[A-Za-z])", "… ", text)
    text = re.sub(r"[\[\({]\s*[xX]\s*(\d+)\s*[\]\)}]", r" ×\1 ", text)
    text = re.sub(r"(?<=[A-Za-z])[xX](\d+)", r" ×\1 ", text)
    text = re.sub(r"\b[xX](\d+)\b", r"×\1", text)
    text = re.sub(r"(?<=[^\s])×", r" ×", text)
    text = re.sub(r"×(\d+)(?=[^\s])", r"×\1 ", text)
    text = re.sub(r"!{2,}", "!", text)
    text = re.sub(r"\?[!?]+", "?", text)
    text = re.sub(r"\[[^\]]*\]", "", text)
    text = text.replace("[", "").replace("]", "")
    text = re.sub(r"\*(\w)", r"\1", text)
    text = re.sub(r"(\w)\*", r"\1", text)
    text = text.replace("*", "")
    text = re.sub(r"--+", "–", text)
    text = text.replace("->", "").replace("|:", "").replace("~", "")
    text = re.sub(r"\(\s*[?…]+\s*\)", "", text)
    text = text.replace("((", "(").replace("))", ")")
    text = _fix_misspellings(text)
    text = _restore_contractions(text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


_MISSPELLINGS = {
    "everytime": "every time",
    "trough": "through",
    "comming": "coming",
    "rythm": "rhythm",
    "belive": "believe",
    "beleive": "believe",
    "dissapear": "disappear",
    "dissapeared": "disappeared",
    "dissapearing": "disappearing",
    "tommorow": "tomorrow",
    "tomorow": "tomorrow",
    "strenght": "strength",
    "allright": "alright",
    "loosing": "losing",
    "seperate": "separate",
    "begining": "beginning",
    "untill": "until",
    "decieve": "deceive",
    "runing": "running",
    "throught": "throughout",
    "wonderfull": "wonderful",
    "peacefull": "peaceful",
    "addicition": "addiction",
    "suprise": "surprise",
}

_MISSPELLING_RE = re.compile(
    r"\b(" + "|".join(re.escape(k) for k in _MISSPELLINGS) + r")\b",
    re.IGNORECASE,
)


def _fix_misspellings(text: str) -> str:
    def _replace(m: re.Match[str]) -> str:
        word = m.group(0)
        replacement = _MISSPELLINGS[word.lower()]
        if word.isupper():
            return replacement.upper()
        if word[0].isupper():
            return replacement[0].upper() + replacement[1:]
        return replacement

    return _MISSPELLING_RE.sub(_replace, text)


_CONTRACTIONS_CS = {
    "Im": "I\u2019m",
    "Ive": "I\u2019ve",
    "Ill": "I\u2019ll",
    "Id": "I\u2019d",
}

_CONTRACTIONS_CI = {
    "dont": "don\u2019t",
    "wont": "won\u2019t",
    "cant": "can\u2019t",
    "didnt": "didn\u2019t",
    "doesnt": "doesn\u2019t",
    "isnt": "isn\u2019t",
    "wasnt": "wasn\u2019t",
    "werent": "weren\u2019t",
    "havent": "haven\u2019t",
    "hasnt": "hasn\u2019t",
    "hadnt": "hadn\u2019t",
    "wouldnt": "wouldn\u2019t",
    "shouldnt": "shouldn\u2019t",
    "couldnt": "couldn\u2019t",
    "mustnt": "mustn\u2019t",
    "musnt": "mustn\u2019t",
    "arent": "aren\u2019t",
    "youre": "you\u2019re",
    "theyre": "they\u2019re",
    "hes": "he\u2019s",
    "shes": "she\u2019s",
    "thats": "that\u2019s",
    "whats": "what\u2019s",
    "youve": "you\u2019ve",
    "theyve": "they\u2019ve",
    "weve": "we\u2019ve",
    "youd": "you\u2019d",
    "theyd": "they\u2019d",
    "hed": "he\u2019d",
    "whos": "who\u2019s",
    "heres": "here\u2019s",
    "theres": "there\u2019s",
    "wheres": "where\u2019s",
    "aint": "ain\u2019t",
}

_CONTRACTION_CS_RE = re.compile(
    r"\b(" + "|".join(re.escape(k) for k in _CONTRACTIONS_CS) + r")\b"
)
_CONTRACTION_CI_RE = re.compile(
    r"\b(" + "|".join(re.escape(k) for k in _CONTRACTIONS_CI) + r")\b",
    re.IGNORECASE,
)
_ITS_RE = re.compile(r"(?<!of )\bits\b", re.IGNORECASE)


def _restore_contractions(text: str) -> str:
    def _cs(m: re.Match[str]) -> str:
        return _CONTRACTIONS_CS[m.group(0)]

    def _ci(m: re.Match[str]) -> str:
        word = m.group(0)
        replacement = _CONTRACTIONS_CI[word.lower()]
        if word.isupper():
            return replacement.upper()
        if word[0].isupper():
            return replacement[0].upper() + replacement[1:]
        return replacement

    def _its(m: re.Match[str]) -> str:
        w = m.group(0)
        if w.isupper():
            return "IT\u2019S"
        if w[0].isupper():
            return "It\u2019s"
        return "it\u2019s"

    text = _CONTRACTION_CS_RE.sub(_cs, text)
    text = _CONTRACTION_CI_RE.sub(_ci, text)
    text = _ITS_RE.sub(_its, text)
    return text


def normalize_title_from_stem(stem: str) -> str:
    title = re.sub(r"\s+\(\d+\)$", "", stem).strip()
    title = normalize_text(title)
    title = title.replace("&amp;", "&")
    title = re.sub(r"[\\/]+", " ", title)
    title = re.sub(r"\s+", " ", title)
    title = re.sub(r"^\s*[-–—]+\s*", "", title)
    return title.strip() or "untitled"


_CREDIT_PATTERNS = [
    re.compile(r"\(\s*u\.?k\.?\s*\)", re.IGNORECASE),
    re.compile(r"\(\s*(?:switzerland|germany|netherlands|sweden|belgium|italy|france|spain|usa?)\s*\)", re.IGNORECASE),
    re.compile(r"(?:written|produced|composed|arranged|performed|remixed|mixed|engineered|mastered|recorded)\s+by\b", re.IGNORECASE),
    re.compile(r"\blyrics\s*(?:by|:)", re.IGNORECASE),
    re.compile(r"\bmusic\s*:", re.IGNORECASE),
    re.compile(r"\bwords (?:and|&) music", re.IGNORECASE),
    re.compile(r"\bcopyright\b", re.IGNORECASE),
    re.compile(r"\ball rights reserved\b", re.IGNORECASE),
    re.compile(r"\bpublish(?:ed|ing|er)\b", re.IGNORECASE),
    re.compile(r"\(p\)\s*\d{4}", re.IGNORECASE),
    re.compile(r"\(c\)\s*\d{4}", re.IGNORECASE),
]


_SECTION_LABEL = re.compile(
    r"^\s*(?:"
    r"(?:verse|chorus|bridge|hook|refrain|intro|outro|pre[- ]?chorus|post[- ]?chorus|interlude|instrumental|coda|solo|breakdown|build|drop|ad[- ]?lib)"
    r"\s*(?:\d+\s*)?\s*(?:[/:&,]\s*(?:verse|chorus|bridge|hook|refrain|intro|outro|pre[- ]?chorus|build|drop|instrumental|interlude)\s*(?:\d+\s*)?)*"
    r"|repeat\s*(?:[×x]?\s*\d+)?"
    r"|[\u201c\u201d\"'][^\"\u2019\u201c\u201d]+[\u201c\u201d\"'\u2019]\s*[-\u2013\u2014]\s*lyrics"
    r"|lyrics"
    r")\s*:?\s*$",
    re.IGNORECASE,
)


def is_noise_line(line: str) -> bool:
    if not line.strip():
        return False
    if all(ch in "_- " for ch in line):
        return True
    if _SECTION_LABEL.match(line.strip()):
        return True
    if any(pattern.search(line) for pattern in _CREDIT_PATTERNS):
        return True
    return any(pattern.match(line) for pattern in NOISE_PATTERNS)


def clean_body(raw: str) -> str:
    text = normalize_text(raw).replace("\r\n", "\n").replace("\r", "\n")
    lines = []
    for line in text.split("\n"):
        normalized = re.sub(r"[ \t]+", " ", line).strip()
        if is_noise_line(normalized):
            continue
        lines.append(normalized)

    out: list[str] = []
    blank_count = 0
    for line in lines:
        if not line:
            blank_count += 1
            if blank_count <= 1:
                out.append("")
            continue
        blank_count = 0
        out.append(line)

    return "\n".join(out).strip()


def body_fingerprint(text: str) -> str:
    lowered = unicodedata.normalize("NFKD", text.casefold())
    lowered = lowered.encode("ascii", "ignore").decode("ascii")
    lowered = re.sub(r"[^a-z0-9]+", "", lowered)
    return lowered


def quality_score(text: str) -> int:
    alpha_chars = sum(1 for ch in text if ch.isalpha())
    line_count = text.count("\n") + 1
    replacement_chars = text.count("�")
    return alpha_chars + (line_count * 2) - (replacement_chars * 50)


def safe_filename(raw: str) -> str:
    name = re.sub(r"\s+", " ", raw).strip()
    name = name.replace("/", "-")
    name = re.sub(r'[<>:"\\|?*]', "", name)
    name = re.sub(r"[. ]+$", "", name)
    return name or "untitled"


LANGUAGE_STOPWORDS: dict[str, set[str]] = {
    "en": {
        "the",
        "and",
        "you",
        "to",
        "of",
        "in",
        "i",
        "it",
        "is",
        "me",
        "my",
        "for",
        "on",
        "that",
        "with",
        "your",
        "we",
        "be",
        "this",
        "im",
        "dont",
    },
    "de": {
        "und",
        "ich",
        "du",
        "nicht",
        "die",
        "der",
        "das",
        "ist",
        "mit",
        "mir",
        "mich",
        "heute",
        "ein",
        "eine",
        "nur",
        "was",
        "denn",
    },
    "es": {
        "que",
        "de",
        "la",
        "el",
        "y",
        "en",
        "no",
        "te",
        "me",
        "mi",
        "yo",
        "tu",
        "por",
        "con",
        "para",
        "una",
    },
    "fr": {
        "je",
        "tu",
        "il",
        "elle",
        "nous",
        "vous",
        "de",
        "la",
        "le",
        "les",
        "et",
        "pas",
        "que",
        "dans",
        "pour",
        "avec",
    },
    "it": {
        "che",
        "di",
        "non",
        "io",
        "tu",
        "e",
        "la",
        "il",
        "mi",
        "ti",
        "per",
        "con",
        "una",
        "sono",
    },
    "nl": {
        "ik",
        "jij",
        "je",
        "niet",
        "de",
        "het",
        "een",
        "en",
        "met",
        "voor",
        "dat",
        "als",
    },
}


def detect_language_bucket(text: str) -> tuple[str, str, float]:
    tokens = re.findall(r"[a-zA-ZÀ-ÿ']+", text.casefold())
    if len(tokens) < 20:
        return "review", "unknown", 0.0

    counts: dict[str, int] = {}
    for lang, words in LANGUAGE_STOPWORDS.items():
        counts[lang] = sum(1 for token in tokens if token in words)

    best_lang = max(counts, key=counts.get)
    best_count = counts[best_lang]
    confidence = best_count / max(len(tokens), 1)

    if best_count == 0:
        return "review", "unknown", 0.0
    if best_lang == "en" and best_count >= 6 and confidence >= 0.03:
        return "english", best_lang, confidence
    if best_lang != "en" and best_count >= 6 and confidence >= 0.03:
        return "non-english", best_lang, confidence
    return "review", best_lang, confidence


def unique_target_path(base_dir: Path, stem: str) -> Path:
    candidate = base_dir / f"{stem}.txt"
    suffix = 2
    while candidate.exists():
        candidate = base_dir / f"{stem} ({suffix}).txt"
        suffix += 1
    return candidate


def bucket_to_dir(bucket: str) -> Path:
    if bucket == "english":
        return CLEAN_LYRICS_DIR
    if bucket == "non-english":
        return NON_ENGLISH_DIR
    return REVIEW_DIR


def inc_bucket_stat(stats: dict[str, object], bucket: str) -> None:
    if bucket == "english":
        stats["english_kept"] = int(stats["english_kept"]) + 1
    elif bucket == "non-english":
        stats["non_english_moved"] = int(stats["non_english_moved"]) + 1
    else:
        stats["review_moved"] = int(stats["review_moved"]) + 1


def dec_bucket_stat(stats: dict[str, object], bucket: str) -> None:
    if bucket == "english":
        stats["english_kept"] = max(0, int(stats["english_kept"]) - 1)
    elif bucket == "non-english":
        stats["non_english_moved"] = max(0, int(stats["non_english_moved"]) - 1)
    else:
        stats["review_moved"] = max(0, int(stats["review_moved"]) - 1)


def clean_single_file(file_path: Path) -> CleanResult | None:
    raw = file_path.read_text(encoding="utf-8", errors="replace")
    title = normalize_title_from_stem(file_path.stem)
    body = clean_body(raw)

    if len(body) < 20 or sum(1 for ch in body if ch.isalpha()) < 12:
        return None

    fingerprint = body_fingerprint(body)
    if len(fingerprint) < 20:
        return None

    return CleanResult(
        title=title,
        body=body,
        body_fingerprint=fingerprint,
        quality_score=quality_score(body),
    )


def main() -> None:
    if not RAW_DIR.exists():
        raise SystemExit(f"Raw lyrics directory not found: {RAW_DIR}")

    if CLEAN_ROOT.exists():
        shutil.rmtree(CLEAN_ROOT)
    CLEAN_LYRICS_DIR.mkdir(parents=True, exist_ok=True)
    NON_ENGLISH_DIR.mkdir(parents=True, exist_ok=True)
    REVIEW_DIR.mkdir(parents=True, exist_ok=True)

    raw_files = sorted(RAW_DIR.glob("*.txt"))
    kept_by_fingerprint: dict[str, dict[str, object]] = {}
    manifest: list[dict[str, object]] = []

    stats = {
        "raw_files": len(raw_files),
        "kept_files": 0,
        "english_kept": 0,
        "non_english_moved": 0,
        "review_moved": 0,
        "dropped_too_short_or_invalid": 0,
        "dropped_as_duplicates": 0,
    }

    for raw_file in raw_files:
        result = clean_single_file(raw_file)
        rel_raw = str(raw_file.relative_to(ROOT))
        if result is None:
            stats["dropped_too_short_or_invalid"] += 1
            manifest.append(
                {
                    "raw_file": rel_raw,
                    "status": "dropped",
                    "reason": "too_short_or_invalid",
                }
            )
            continue

        bucket, lang, confidence = detect_language_bucket(result.body)
        existing = kept_by_fingerprint.get(result.body_fingerprint)
        if existing is not None:
            existing_score = int(existing["quality_score"])
            if result.quality_score > existing_score:
                replaced_raw = str(existing["raw_file"])
                replaced_clean = str(existing["clean_file"])
                (ROOT / replaced_clean).unlink(missing_ok=True)

                previous_bucket = str(existing.get("language_bucket", "review"))
                dec_bucket_stat(stats, previous_bucket)
                inc_bucket_stat(stats, bucket)

                target = unique_target_path(bucket_to_dir(bucket), safe_filename(result.title))
                target.write_text(f"{result.body}\n", encoding="utf-8")
                rel_clean = str(target.relative_to(ROOT))

                existing.update(
                    {
                        "raw_file": rel_raw,
                        "clean_file": rel_clean,
                        "title": result.title,
                        "quality_score": result.quality_score,
                        "language_bucket": bucket,
                        "language_guess": lang,
                        "language_confidence": round(confidence, 4),
                    }
                )
                manifest.append(
                    {
                        "raw_file": rel_raw,
                        "status": "kept",
                        "title": result.title,
                        "clean_file": rel_clean,
                        "language_bucket": bucket,
                        "language_guess": lang,
                        "language_confidence": round(confidence, 4),
                        "dedupe": "replaced_lower_quality_variant",
                    }
                )
                manifest.append(
                    {
                        "raw_file": replaced_raw,
                        "status": "dropped",
                        "reason": "duplicate",
                        "duplicate_of": rel_clean,
                    }
                )
                stats["dropped_as_duplicates"] += 1
            else:
                manifest.append(
                    {
                        "raw_file": rel_raw,
                        "status": "dropped",
                        "reason": "duplicate",
                        "duplicate_of": str(existing["clean_file"]),
                    }
                )
                stats["dropped_as_duplicates"] += 1
            continue

        target_dir = bucket_to_dir(bucket)
        inc_bucket_stat(stats, bucket)

        target = unique_target_path(target_dir, safe_filename(result.title))
        target.write_text(f"{result.body}\n", encoding="utf-8")
        rel_clean = str(target.relative_to(ROOT))
        kept_by_fingerprint[result.body_fingerprint] = {
            "raw_file": rel_raw,
            "clean_file": rel_clean,
            "title": result.title,
            "quality_score": result.quality_score,
            "language_bucket": bucket,
            "language_guess": lang,
            "language_confidence": round(confidence, 4),
        }
        manifest.append(
            {
                "raw_file": rel_raw,
                "status": "kept",
                "title": result.title,
                "clean_file": rel_clean,
                "language_bucket": bucket,
                "language_guess": lang,
                "language_confidence": round(confidence, 4),
            }
        )

    stats["kept_files"] = len(kept_by_fingerprint)
    stats["clean_dir"] = str(CLEAN_LYRICS_DIR.relative_to(ROOT))
    stats["non_english_dir"] = str(NON_ENGLISH_DIR.relative_to(ROOT))
    stats["review_dir"] = str(REVIEW_DIR.relative_to(ROOT))

    kept_manifest = [
        {
            "raw_file": data["raw_file"],
            "clean_file": data["clean_file"],
            "title": data["title"],
            "language_bucket": data["language_bucket"],
            "language_guess": data["language_guess"],
            "language_confidence": data["language_confidence"],
        }
        for data in sorted(
            kept_by_fingerprint.values(),
            key=lambda item: str(item["title"]).casefold(),
        )
    ]

    CLEAN_ROOT.mkdir(parents=True, exist_ok=True)
    MANIFEST_PATH.write_text(json.dumps(kept_manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    SUMMARY_PATH.write_text(json.dumps(stats, ensure_ascii=False, indent=2), encoding="utf-8")

    # Keep a full audit trail for later inspection.
    audit_path = CLEAN_ROOT / "audit.json"
    audit_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"Raw files: {stats['raw_files']}")
    print(f"Kept files: {stats['kept_files']}")
    print(f"English kept: {stats['english_kept']}")
    print(f"Non-English moved: {stats['non_english_moved']}")
    print(f"Review moved: {stats['review_moved']}")
    print(f"Dropped short/invalid: {stats['dropped_too_short_or_invalid']}")
    print(f"Dropped duplicates: {stats['dropped_as_duplicates']}")
    print(f"Wrote clean lyrics to: {CLEAN_LYRICS_DIR}")
    print(f"Wrote manifest to: {MANIFEST_PATH}")
    print(f"Wrote summary to: {SUMMARY_PATH}")


if __name__ == "__main__":
    main()
