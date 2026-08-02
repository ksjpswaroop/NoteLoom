#!/usr/bin/env python3
"""Englishify Mandarin UI strings safely.

- Replace a string/template body only when the *entire* body is a known phrase,
  or when the body is predominantly Chinese and has an exact mapping.
- Strip Han characters from // and /* */ comments.
- Leave short CJK synonym tokens in allowlisted search files.
"""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
SKIP_FILES = {SRC / "lib" / "bm25.ts"}
KEEP_SHORT = {
    SRC / "lib" / "rag.ts",
    SRC / "lib" / "skills" / "manager.ts",
    SRC / "lib" / "search-utils.ts",
    SRC / "lib" / "fuzzy-search.ts",
}
HAN = re.compile(r"[\u4e00-\u9fff]")
STRING_RE = re.compile(
    r"(?P<q>['\"])(?P<body>(?:\\.|(?!(?P=q)).)*)(?P=q)|`(?P<tbody>(?:\\.|[^`])*)`"
)


def load_phrases() -> dict[str, str]:
    path = Path(__file__).with_name("englishify-phrases.tsv")
    out: dict[str, str] = {}
    if not path.exists():
        return out
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip() or line.startswith("#") or "\t" not in line:
            continue
        zh, en = line.split("\t", 1)
        out[zh] = en
    return out


def predominately_cjk(s: str) -> bool:
    han = len(HAN.findall(s))
    if han == 0:
        return False
    # letters/digits count
    latin = len(re.findall(r"[A-Za-z0-9]", s))
    return han >= max(1, latin)


def is_short_synonym(s: str) -> bool:
    return len(HAN.findall(s)) <= 4 and len(s) <= 12 and not re.search(r"[。！？；：]", s)


def translate_body(body: str, phrases: dict[str, str], keep_short: bool) -> str:
    if not HAN.search(body):
        return body
    if keep_short and is_short_synonym(body):
        return body
    if body in phrases:
        return phrases[body]
    # For template literals with ${}, translate contiguous Chinese segments that exactly match phrases
    if "${" in body:
        # replace longest exact phrase occurrences carefully
        out = body
        for zh in sorted(phrases.keys(), key=len, reverse=True):
            if zh in out:
                out = out.replace(zh, phrases[zh])
        return out
    if predominately_cjk(body) and body in phrases:
        return phrases[body]
    return body


def strip_han_comments(text: str) -> str:
    def line_comment(m: re.Match[str]) -> str:
        prefix, body = m.group(1), m.group(2)
        if not HAN.search(body):
            return m.group(0)
        body2 = re.sub(r"[ \t]{2,}", " ", HAN.sub("", body)).rstrip()
        return prefix.rstrip() if not body2.strip() else f"{prefix}{body2}"

    text = re.sub(r"(^[ \t]*//)(.*)$", line_comment, text, flags=re.M)

    def block_comment(m: re.Match[str]) -> str:
        inner = m.group(1)
        if not HAN.search(inner):
            return m.group(0)
        inner2 = re.sub(r"[ \t]{2,}", " ", HAN.sub("", inner))
        return f"/*{inner2}*/"

    return re.sub(r"/\*(.*?)\*/", block_comment, text, flags=re.S)


def process(path: Path, phrases: dict[str, str]) -> bool:
    if path in SKIP_FILES:
        return False
    original = path.read_text(encoding="utf-8")
    if not HAN.search(original):
        return False
    keep_short = path in KEEP_SHORT

    def repl(m: re.Match[str]) -> str:
        if m.group("q"):
            q, body = m.group("q"), m.group("body")
            return f"{q}{translate_body(body, phrases, keep_short)}{q}"
        return f"`{translate_body(m.group('tbody'), phrases, keep_short)}`"

    text = STRING_RE.sub(repl, original)
    text = strip_han_comments(text)
    if text != original:
        path.write_text(text, encoding="utf-8")
        return True
    return False


def main() -> None:
    phrases = load_phrases()
    changed = 0
    for path in sorted(list(SRC.rglob("*.ts")) + list(SRC.rglob("*.tsx"))):
        if process(path, phrases):
            changed += 1
            print("updated", path.relative_to(ROOT))
    print("CHANGED", changed)
    remain = []
    for path in sorted(list(SRC.rglob("*.ts")) + list(SRC.rglob("*.tsx"))):
        if path in SKIP_FILES:
            continue
        t = path.read_text(encoding="utf-8", errors="ignore")
        if not HAN.search(t):
            continue
        if path in KEEP_SHORT:
            # only count long leftovers
            if any(
                predominately_cjk(m.group(1) or m.group(2) or "")
                and not is_short_synonym(m.group(1) or m.group(2) or "")
                for m in re.finditer(r"['\"]([^'\"]*)['\"]|`([^`]*)`", t)
            ):
                remain.append(path)
            continue
        remain.append(path)
    print("REMAINING_FILES", len(remain))
    for p in remain[:40]:
        print(" ", p.relative_to(ROOT))


if __name__ == "__main__":
    main()
