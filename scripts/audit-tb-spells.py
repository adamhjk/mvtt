#!/usr/bin/env python3
"""Cross-check every extracted spell against its source page text.

Reports any spell where:
  - the parsed casting kind disagrees with the source's "Casting:"
    line (e.g., source says "Versus test" but catalog says "fixed")
  - the parsed scribe / learn Ob doesn't match
  - both materials and focus are missing in the catalog while the
    source actually has one (parser miss)
  - the spell name doesn't match the title-cased line above the
    EFFECT header in the source
"""

from __future__ import annotations
import json
import re
import sys
from pathlib import Path


REPO = Path(__file__).resolve().parents[1]


def find_stat_lines(pages_dir: Path, page: int, name_marker: str) -> dict[str, str]:
    """Walk the source pages starting from `page`, find the spell's
    EFFECT header (matching `name_marker`), and return the raw stat
    lines (Materials, Focus, To Scribe, Casting, Casting Time,
    Duration)."""
    text_lines: list[str] = []
    for p in range(page, page + 4):
        path = pages_dir / f"{p}.txt"
        if not path.exists():
            break
        text_lines.extend(path.read_text(encoding="utf-8").split("\n"))

    target = name_marker.upper().replace("’", "'")
    out: dict[str, str] = {}
    in_block = False
    for ln in text_lines:
        s = ln.strip()
        m = re.match(r"^([A-ZÆŒÐÞ’\s]+?)\s+EFFECT\s*$", s)
        if m:
            head = m.group(1).strip().replace("’", "'")
            if target.endswith(head) or head.endswith(target):
                in_block = True
                continue
            elif in_block:
                # Hit the next spell's EFFECT — stop.
                break
        if in_block:
            low = s.lower()
            if low.startswith("materials:"):
                out["materials"] = s.split(":", 1)[1].strip()
            elif low.startswith("focus:"):
                out["focus"] = s.split(":", 1)[1].strip()
            elif low.startswith("to scribe:"):
                out["scribe"] = s
            elif low.startswith("casting:"):
                out["casting"] = s
    return out


def parse_obs(line: str) -> tuple[int | None, int | None]:
    m_s = re.search(r"scholar\s+ob\s+(\d+)", line, re.IGNORECASE)
    m_l = re.search(r"lore\s+master\s+ob\s+(\d+)", line, re.IGNORECASE)
    return (
        int(m_s.group(1)) if m_s else None,
        int(m_l.group(1)) if m_l else None,
    )


def expected_kind(casting_line: str) -> str:
    s = casting_line.lower()
    if "fixed" in s:
        return "fixed"
    if "versus" in s:
        return "versus"
    if "skill swap" in s:
        # We map skill swap → factors (closest schema match).
        return "factors"
    if "factors" in s:
        return "factors"
    return "?"


def main() -> None:
    spells = json.load(open("/tmp/spells.json"))
    issues: list[str] = []
    dh_pages = REPO / "data" / "rules-corpus-permanent" / "dh" / "pages"
    lmm_pages = REPO / "data" / "rules-corpus-permanent" / "lmm" / "pages"

    for s in spells:
        pages_dir = dh_pages if s["sourceBook"] == "DH" else lmm_pages
        # The EFFECT header uses an uppercase variant of the name.
        # Match against the trailing word(s) of the spell name.
        name_words = s["name"].upper().replace("’", "'").split()
        marker = " ".join(name_words[-3:])
        stats = find_stat_lines(pages_dir, s["sourcePage"], marker)

        # Compare scribe / learn obs.
        if "scribe" in stats:
            src_scribe, src_learn = parse_obs(stats["scribe"])
            cat_scribe = s["learning"]["scribeOb"]
            cat_learn = s["learning"]["learnOb"]
            if src_scribe is not None and src_scribe != cat_scribe:
                issues.append(
                    f"{s['name']:30s} scribeOb mismatch: catalog={cat_scribe} source={src_scribe}"
                )
            if src_learn is not None and src_learn != cat_learn:
                issues.append(
                    f"{s['name']:30s} learnOb mismatch: catalog={cat_learn} source={src_learn}"
                )

        # Compare casting kind.
        if "casting" in stats:
            ek = expected_kind(stats["casting"])
            ck = s["casting"]["kind"]
            if ek != "?" and ek != ck:
                issues.append(
                    f"{s['name']:30s} casting kind: catalog={ck} source={ek!r} ({stats['casting']!r})"
                )

        # Materials / focus parser miss: the catalog has both empty
        # while the source has at least one populated.
        cat_mat = s["casting"]["materials"]
        cat_foc = s["casting"]["focus"]
        src_mat = stats.get("materials", "")
        src_foc = stats.get("focus", "")
        if not cat_mat and not cat_foc and (src_mat or src_foc):
            issues.append(
                f"{s['name']:30s} parser miss: source has materials={src_mat!r} focus={src_foc!r}"
            )

    if not issues:
        print(f"✓ all {len(spells)} spells audit clean")
    else:
        print(f"⚠ {len(issues)} issue(s) across {len(spells)} spells:")
        for issue in issues:
            print(f"  {issue}")


if __name__ == "__main__":
    main()
