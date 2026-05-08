#!/usr/bin/env python3
"""Extract Torchbearer spell stat blocks from rules-corpus-permanent.

Reads pages/N.txt files in the DH corpus (and LMM later), finds each
spell stat block, and emits a TS-typed array conforming to the
TbSpellTemplate interface.

Heuristic: a spell starts when we see a line matching
`<SPELL NAME IN UPPERCASE> EFFECT`. We then collect:
  - the line above (the title-cased name)
  - "To Scribe: Scholar Ob N   To Learn: Lore Master Ob M"
  - "Casting: <kind...> Casting Time: <time>"
  - "Duration: <free text>"
  - "Materials: <free text>" or "Focus: <free text>"

Outputs JSON to stdout; we then transform to TS in a follow-up step.
"""

from __future__ import annotations
import json
import re
import sys
from pathlib import Path
from typing import Optional


SCHOOL_KEYWORDS = {
    "abjuration": "Abjuration",
    "conjuration": "Conjuration",
    "divination": "Divination",
    "enchantment": "Enchantment",
    "evocation": "Evocation",
    "illusion": "Illusion",
    "necromancy": "Necromancy",
    "transmutation": "Transmutation",
}


def slug(s: str) -> str:
    # ASCII-fold special chars first so "Dæmonic" → "daemonic",
    # "Ægis" → "aegis", "Wizard's" → "wizards" (etc.). Then collapse
    # everything non-alphanumeric to hyphens.
    folded = (
        s.replace("Æ", "Ae")
        .replace("æ", "ae")
        .replace("Œ", "Oe")
        .replace("œ", "oe")
        .replace("Ð", "D")
        .replace("ð", "d")
        .replace("Þ", "Th")
        .replace("þ", "th")
        .replace("’", "")
        .replace("‘", "")
    )
    out = re.sub(r"[^a-zA-Z0-9]+", "-", folded).strip("-").lower()
    return out


_WATERMARK_RE = re.compile(r"\s*Adam\s+Jacob\s*\(Order\s+#\d+\)\s*")


def strip_watermark(s: str) -> str:
    return _WATERMARK_RE.sub("", s).strip()


# Best-effort spell → school inference. Sources: starting-school table
# (DH p.41 — magicians) and the school keyword tags in spell prose.
# Spells that appear in multiple schools get one canonical pick (the
# GM can override via the Arcane page's edit affordance). Unmapped
# spells default to "Other".
SCHOOL_BY_NAME: dict[str, str] = {
    # First circle (DH)
    "Aetheric Appendage": "Conjuration",
    "Aetherial Premonition": "Divination",
    "Arcane Semblance": "Illusion",
    "Celestial Music": "Enchantment",
    "Dæmonic Stupefaction": "Necromancy",
    "Daemonic Stupefaction": "Necromancy",
    "Dweomercraft": "Transmutation",
    "Lightness of Being": "Transmutation",
    "Mystic Porter": "Evocation",
    "Supernal Vision": "Divination",
    "Swarm": "Evocation",
    "Thread of Friendship": "Enchantment",
    "Wayfinder’s Friend": "Divination",
    "Wisdom of the Sages": "Necromancy",
    "Wizard’s Ægis": "Abjuration",
    "Word of Binding": "Abjuration",
    "Wyrd Lights": "Conjuration",
    # Second circle (DH)
    "Destiny of Heroes": "Divination",
    "Eye of Omens": "Divination",
    "Eyes of the Bat": "Transmutation",
    "Flames of the Shroud": "Necromancy",
    "Numinous Sigil": "Enchantment",
    "Phantasmal Vision": "Illusion",
    "Rhyme of Opening": "Transmutation",
    "Somnific Trance": "Enchantment",
    "Shroud of Shadows": "Illusion",
    "Veil of the Chameleon": "Illusion",
    "Water Lung": "Transmutation",
    "Wizard’s Bane": "Necromancy",
    # Third circle (DH)
    "Apotropaic Circle": "Abjuration",
    "Balefire": "Evocation",
    "Beast Cloak": "Transmutation",
    "Conference of Birds": "Divination",
    "Devilish Laughter": "Enchantment",
    "Empyreal Messenger": "Conjuration",
    "Eye of the Overworld": "Divination",
    "Incandescent Beacon": "Evocation",
    "Lightning Step": "Transmutation",
    "Sign of Abrogation": "Abjuration",
    "Sorcerous Suggestion": "Enchantment",
    "Simulacrum": "Illusion",
    "Stormcrow": "Conjuration",
    "Tangletongue": "Enchantment",
    # Fourth circle (LMM)
    "Athanasia": "Necromancy",
    "Hammer of Heaven": "Evocation",
    "Inclusion of the Hugr": "Necromancy",
    "Sowing the Dragon’s Teeth": "Conjuration",
    "Unearthly Trance": "Necromancy",
    "Wormtongue": "Enchantment",
    # Fifth circle (LMM)
    "Caustic Miasma": "Evocation",
    "Hidden Fortress": "Conjuration",
    "Shadowgate": "Conjuration",
}


def detect_school(name: str) -> str:
    return SCHOOL_BY_NAME.get(name, "Other")


def parse_casting_kind(s: str) -> tuple[str, Optional[int], Optional[str]]:
    """Return (kind, fixedOb, versusSkill)."""
    s = s.strip()
    low = s.lower()
    # "Fixed (Arcanist Ob 3)" → fixed Ob 3
    m = re.match(r"fixed\s*\(arcanist\s+ob\s+(\d+)\)", low)
    if m:
        return ("fixed", int(m.group(1)), None)
    # "Fixed obstacle (see below)" → fixed, ob unknown (set per-cast)
    if low.startswith("fixed"):
        return ("fixed", None, None)
    # "Versus test"
    if "versus" in low:
        return ("versus", None, "arcanist")
    # "Skill swap" — these spells let you substitute Arcanist for
    # another skill. Treat as factors for v1; the rules text in the
    # page reference covers the swap mechanics.
    if "skill swap" in low:
        return ("factors", None, None)
    if "factors" in low:
        return ("factors", None, None)
    return ("fixed", None, None)


def parse_casting_time(s: str) -> str:
    s = s.strip().lower()
    if "free" in s:
        return "free"
    if "one turn" in s or "1 turn" in s:
        return "one-turn"
    if "two turns" in s or "three turns" in s or "multi" in s or "special" in s:
        return "multi-turn"
    return "action"


def parse_ob(line: str, label: str) -> Optional[int]:
    m = re.search(rf"{label}.*?ob\s+(\d+)", line, re.IGNORECASE)
    if m:
        return int(m.group(1))
    return None


def looks_like_name(line: str) -> bool:
    # Spell names are short title-cased phrases, usually two-three words.
    # They precede the "X EFFECT" header. Reject anything that contains
    # lowercase paragraph punctuation.
    t = line.strip()
    if not t:
        return False
    if len(t) > 60:
        return False
    if t.endswith((".", ",", ":", "!", "?")):
        return False
    # Must start with a capital letter or special character.
    if not (t[0].isupper() or t[0] in "ÆŒÐÞ"):
        return False
    return True


def extract_spells_from_book(
    pages_dir: Path,
    book: str,
    circle_by_page: dict[int, int],
) -> list[dict]:
    """Extract spell stat blocks from a book's pages dir. Operates on
    the full concatenated book text so stat blocks that span a page
    boundary still resolve cleanly."""
    page_files = sorted(pages_dir.glob("*.txt"), key=lambda p: int(p.stem))
    # Build a flat line list with each line tagged with its source
    # page number — so we can know which page a given EFFECT header
    # is on, and infer the spell's circle from the page.
    tagged: list[tuple[int, str]] = []
    for page_path in page_files:
        page_num = int(page_path.stem)
        for ln in page_path.read_text(encoding="utf-8").split("\n"):
            tagged.append((page_num, ln))

    spells: list[dict] = []

    i = 0
    while i < len(tagged):
        page_num, line = tagged[i]
        # Look for "FOO EFFECT" — a line that's all uppercase ending
        # in " EFFECT" (the canonical stat block header).
        m = re.match(r"^([A-ZÆŒÐÞ’\s]+?)\s+EFFECT\s*$", line.strip())
        if m:
            # Skip if the page isn't in our spell range (e.g., LMM
            # invocation chapter pages have EFFECT headers too).
            if page_num not in circle_by_page:
                i += 1
                continue
            fallback_circle = circle_by_page[page_num]
            spell_name_upper = m.group(1).strip()
            # The full title sits above the EFFECT header, separated by
            # 1–4 lines of prose. Walk back and collect each
            # title-shaped line (caps-only, no terminal punctuation,
            # short); prefer the one whose suffix matches the EFFECT
            # header's words (e.g. "Wizard's Ægis" → "ÆGIS EFFECT"
            # picks the line ending in Ægis, not just "Ægis").
            name = None
            best_score = -1
            upper_ascii = spell_name_upper.replace("’", "'").upper()
            tail_words = upper_ascii.split()
            for back in range(1, 14):
                if i - back < 0:
                    break
                _, raw_cand = tagged[i - back]
                cand = raw_cand.strip()
                if not cand:
                    continue
                if not looks_like_name(cand):
                    continue
                # The title ends with the spell name; score by how many
                # trailing words from the EFFECT-header's caps-name
                # match the candidate's trailing tokens.
                cand_upper = cand.upper().replace("’", "'")
                cand_words = cand_upper.split()
                # The EFFECT-header words must appear (in order) at the
                # tail of the candidate.
                if (
                    len(cand_words) >= len(tail_words)
                    and cand_words[-len(tail_words):] == tail_words
                ):
                    # Prefer the LONGEST match — i.e. the candidate
                    # with the most extra prefix words ("Wizard's Ægis"
                    # beats "Ægis").
                    score = len(cand_words)
                    if score > best_score:
                        best_score = score
                        name = cand
                # Stop walking back once we hit another EFFECT header
                # (i.e. the previous spell's stat block).
                if re.match(r"^([A-ZÆŒÐÞ’\s]+?)\s+EFFECT\s*$", cand):
                    break
            if not name:
                name = spell_name_upper.title()

            # Now scan forward for the stat lines — generous window
            # (60 lines) since the prose is multi-paragraph.
            scribe_ob: Optional[int] = None
            learn_ob: Optional[int] = None
            casting_line: Optional[str] = None
            casting_time_line: Optional[str] = None
            duration: Optional[str] = None
            materials = ""
            focus = ""

            # Track which field we last started; the line *after* a
            # Materials/Focus line often continues onto the next line
            # with no new key prefix (PDF line-wrap), so we splice
            # those continuations into the same field.
            FIELD_KEYS = (
                "to scribe:",
                "to learn:",
                "casting:",
                "casting time:",
                "duration:",
                "materials:",
                "focus:",
            )
            last_field: str | None = None  # "materials" | "focus" | None
            j = i + 1
            end = min(len(tagged), i + 60)
            while j < end:
                _, raw = tagged[j]
                ln = raw.strip()
                if not ln:
                    last_field = None
                    j += 1
                    continue
                low = ln.lower()
                if low.startswith("to scribe:"):
                    scribe_ob = parse_ob(ln, "scholar")
                    learn_ob = parse_ob(ln, "lore master")
                    last_field = None
                elif low.startswith("casting:"):
                    rest = ln.split(":", 1)[1]
                    if "Casting Time:" in rest or "casting time:" in rest.lower():
                        m2 = re.split(r"casting\s+time\s*:", rest, flags=re.IGNORECASE, maxsplit=1)
                        casting_line = m2[0].strip()
                        casting_time_line = m2[1].strip() if len(m2) > 1 else ""
                    else:
                        casting_line = rest.strip()
                    last_field = None
                elif low.startswith("casting time:"):
                    casting_time_line = ln.split(":", 1)[1].strip()
                    last_field = None
                elif low.startswith("duration:"):
                    duration = strip_watermark(ln.split(":", 1)[1].strip())
                    last_field = None
                elif low.startswith("materials:"):
                    materials = strip_watermark(ln.split(":", 1)[1].strip())
                    last_field = "materials"
                elif low.startswith("focus:"):
                    focus = strip_watermark(ln.split(":", 1)[1].strip())
                    last_field = "focus"
                else:
                    # Continuation: PDF line-wrap split a multi-line
                    # value across two lines. Splice it in unless the
                    # next line is a new field, the next spell's
                    # EFFECT header, or section punctuation like
                    # "FOO QUALITIES" / "FOO FACTORS".
                    if last_field is not None:
                        is_new_field = any(low.startswith(k) for k in FIELD_KEYS)
                        is_next_block = (
                            re.match(r"^([A-ZÆŒÐÞ’\s]+?)\s+EFFECT\s*$", ln)
                            or re.match(r"^[A-ZÆŒÐÞ’\s]+ (FACTORS|QUALITIES|DURATION|CASTING)\s*$", ln)
                        )
                        if not is_new_field and not is_next_block:
                            cont = strip_watermark(ln)
                            if cont:
                                if last_field == "materials":
                                    materials = (materials + " " + cont).strip()
                                elif last_field == "focus":
                                    focus = (focus + " " + cont).strip()
                            j += 1
                            continue
                    last_field = None
                # Stop scanning once we hit the next spell's header.
                m_next = re.match(r"^([A-ZÆŒÐÞ’\s]+?)\s+EFFECT\s*$", ln)
                if m_next and j > i + 1:
                    break
                j += 1

            if scribe_ob is None and learn_ob is None and casting_line is None:
                # Probably not a real stat block — skip.
                i += 1
                continue

            kind, fixed_ob, versus_skill = parse_casting_kind(casting_line or "")
            ctime = parse_casting_time(casting_time_line or "")
            spell_id = f"tb/spell/{slug(name)}"

            # Trim "[bracketed]" tags off materials/focus — they are inventory
            # locations like "[carried 1 or worn/neck]". Keep only the
            # human-readable description.
            materials = re.sub(r"\s*\[[^\]]*\]\s*", "", materials).strip()
            focus = re.sub(r"\s*\[[^\]]*\]\s*", "", focus).strip()

            spells.append(
                {
                    "id": spell_id,
                    "name": name,
                    "circle": fallback_circle,
                    "school": detect_school(name),
                    "sourceBook": book,
                    "sourcePage": page_num,
                    "casting": {
                        "kind": kind,
                        "fixedOb": fixed_ob,
                        "versusSkill": versus_skill,
                        "castingTime": ctime,
                        "duration": duration or "",
                        "materials": materials,
                        "focus": focus,
                    },
                    "learning": {
                        "scribeOb": scribe_ob if scribe_ob is not None else 2,
                        "learnOb": learn_ob if learn_ob is not None else 2,
                    },
                }
            )
            i += 5
            continue
        i += 1

    return spells


# Page → circle mapping for DH. Sourced from the print layout of the
# Spells reference: p.184–192 = first circle; p.193–199 = second
# circle; p.200–207 = third circle. Verified by the section headers
# "First Circle Spells" / "Second Circle Spells" / "Third Circle Spells"
# at the start of each block.
DH_CIRCLE_BY_PAGE = {}
for p in range(183, 192 + 1):
    DH_CIRCLE_BY_PAGE[p] = 1
for p in range(193, 199 + 1):
    DH_CIRCLE_BY_PAGE[p] = 2
for p in range(200, 207 + 1):
    DH_CIRCLE_BY_PAGE[p] = 3

# LMM circles: fourth + fifth circle spell sections (LMM p.59–65).
# Pages 41–58 are theurge / shaman invocations (different system —
# those carry "EFFECT" headers but they're invocations, not spells)
# and pages 66+ are the equipment chapter.
LMM_CIRCLE_BY_PAGE = {}
for p in range(59, 62 + 1):
    LMM_CIRCLE_BY_PAGE[p] = 4
for p in range(63, 65 + 1):
    LMM_CIRCLE_BY_PAGE[p] = 5


def run() -> None:
    out: list[dict] = []
    repo = Path(__file__).resolve().parents[1]

    dh_pages = repo / "data" / "rules-corpus-permanent" / "dh" / "pages"
    lmm_pages = repo / "data" / "rules-corpus-permanent" / "lmm" / "pages"

    out.extend(extract_spells_from_book(dh_pages, "DH", DH_CIRCLE_BY_PAGE))
    out.extend(extract_spells_from_book(lmm_pages, "LMM", LMM_CIRCLE_BY_PAGE))

    # Deduplicate by id, preferring the first occurrence (the
    # alphabetical reference) over any examples in earlier chapters.
    seen: dict[str, dict] = {}
    for s in out:
        if s["id"] not in seen:
            seen[s["id"]] = s
    json.dump(list(seen.values()), sys.stdout, indent=2)


if __name__ == "__main__":
    run()
