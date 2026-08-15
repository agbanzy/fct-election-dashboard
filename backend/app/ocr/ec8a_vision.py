"""Read an INEC EC8A result sheet with a vision model.

Tesseract cannot do this job. EC8A vote counts are handwritten, and tesseract
is an engine for printed text: on real Osun 2026 sheets it read the printed
headers correctly and turned the handwritten figures into noise — "Number of
Accredited Voters" came back as "Des", one sheet yielded nothing at all, and
another produced APC 122 with no PDP row, which is not a plausible result so
much as a regex landing on whatever digits were nearby.

That failure mode is the dangerous one. A blank read is obvious; a confident
wrong number looks like a result.

What makes this tractable is a property of the form itself: **every score is
recorded twice, in figures and in words.** INEC designed that as a
tamper-check for humans, and it doubles as a machine-verifiable one. Two
independent readings of the same value that agree are strong evidence; two
that disagree mean the sheet is unreadable and must be dropped. The party
votes must also sum to the recorded total. Those checks are the confidence
score here — not a model's self-report, which is just another opinion.

Nothing this module returns is authoritative. Everything is machine-read and
carries `verified=False` until a human accepts it.
"""

from __future__ import annotations

import base64
import json
import logging
import os
import re
from dataclasses import dataclass, field

import requests

log = logging.getLogger(__name__)

API_URL = "https://api.anthropic.com/v1/messages"
API_VERSION = "2023-06-01"
MODEL = "claude-sonnet-5"

# Words → integer, for checking the written column against the figures.
_UNITS = {
    "zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
    "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
    "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14,
    "fifteen": 15, "sixteen": 16, "seventeen": 17, "eighteen": 18,
    "nineteen": 19,
}
_TENS = {
    "twenty": 20, "thirty": 30, "forty": 40, "fourty": 40, "fifty": 50,
    "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90,
}

PROMPT = """You are reading a scanned INEC EC8A polling-unit result sheet from a Nigerian election.

Transcribe EXACTLY what is written. Do not infer, correct, or complete anything.

For every political party row that has a score recorded, report:
  - party: the party code as printed (e.g. APC, PDP, ADC, A, AA, ADP, ZLP)
  - figures: the number written in the "IN FIGURES" column, as an integer
  - words: the text written in the "IN WORDS" column, verbatim

Also report, as integers where legible:
  registered, accredited, rejected, total_valid

Rules:
  - If a field is blank, illegible, overwritten, or you are unsure, use null.
    Never guess. A null is far more useful than a wrong number.
  - Report only rows that actually carry a score. Skip empty party rows.
  - Do not perform arithmetic. Do not reconcile figures against words.
    Report each exactly as written, even where they disagree.

Return ONLY a JSON object, no prose:
{"parties":[{"party":"APC","figures":122,"words":"one hundred and twenty two"}],
 "registered":null,"accredited":null,"rejected":null,"total_valid":null}"""


@dataclass(frozen=True)
class VisionReading:
    party_votes: dict[str, int]
    registered: int | None
    accredited: int | None
    rejected: int | None
    total_valid: int | None
    confidence: float
    #: Why the sheet was rejected or downgraded — surfaced to reviewers.
    problems: list[str] = field(default_factory=list)
    raw: str = ""


def words_to_int(text: str) -> int | None:
    """Parse the written column. Returns None when it cannot be read cleanly.

    Deliberately strict: this exists to disagree with the figures column when
    the two really differ, so anything it cannot parse confidently must come
    back as None rather than a best guess.
    """
    if not text:
        return None
    t = re.sub(r"[^a-z ]", " ", text.lower())
    t = t.replace(" and ", " ")
    tokens = [w for w in t.split() if w]
    if not tokens:
        return None

    total = 0
    current = 0
    seen = False
    for w in tokens:
        if w in _UNITS:
            current += _UNITS[w]
            seen = True
        elif w in _TENS:
            current += _TENS[w]
            seen = True
        elif w == "hundred":
            if current == 0:
                current = 1
            current *= 100
            seen = True
        elif w == "thousand":
            if current == 0:
                current = 1
            total += current * 1000
            current = 0
            seen = True
        else:
            # An unknown token means we are not reading this cleanly.
            return None
    if not seen:
        return None
    return total + current


#: Long edge, in pixels, that sheets are reduced to before upload. INEC scans
#: arrive at 3-4MB; the model bills by image tokens, so sending them raw costs
#: several times more per sheet for detail well past what the handwriting
#: needs. 1600px keeps the figure and word columns clearly legible.
MAX_EDGE = 1600


def _downscale(image_bytes: bytes) -> bytes:
    """Shrink a scan for upload. Returns the original if Pillow is missing."""
    try:
        import io as _io

        from PIL import Image
    except ImportError:
        return image_bytes
    try:
        img = Image.open(_io.BytesIO(image_bytes))
        if max(img.size) <= MAX_EDGE:
            return image_bytes
        img.thumbnail((MAX_EDGE, MAX_EDGE), Image.LANCZOS)
        if img.mode not in ("RGB", "L"):
            img = img.convert("RGB")
        buf = _io.BytesIO()
        img.save(buf, format="JPEG", quality=85)
        return buf.getvalue()
    except Exception:  # noqa: BLE001 — a scan we cannot resize is still worth sending
        log.warning("ec8a_vision: downscale failed; sending original")
        return image_bytes


def read_ec8a(image_bytes: bytes, *, api_key: str | None = None, timeout: int = 60) -> VisionReading | None:
    """Read one sheet. Returns None when the reader is unavailable.

    Unavailable (no key, transport failure) is distinct from unreadable
    (a sheet whose two columns disagree): the first should be retried, the
    second must never be.
    """
    key = api_key or os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        log.info("ec8a_vision: no ANTHROPIC_API_KEY; reader unavailable")
        return None

    b64 = base64.standard_b64encode(_downscale(image_bytes)).decode()
    try:
        resp = requests.post(
            API_URL,
            headers={
                "x-api-key": key,
                "anthropic-version": API_VERSION,
                "content-type": "application/json",
            },
            json={
                "model": MODEL,
                "max_tokens": 2000,
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "image",
                                "source": {
                                    "type": "base64",
                                    "media_type": "image/jpeg",
                                    "data": b64,
                                },
                            },
                            {"type": "text", "text": PROMPT},
                        ],
                    }
                ],
            },
            timeout=timeout,
        )
    except requests.RequestException as exc:
        log.warning("ec8a_vision: request failed: %s", exc)
        return None

    if resp.status_code != 200:
        log.warning("ec8a_vision: HTTP %s: %s", resp.status_code, resp.text[:200])
        return None

    try:
        body = resp.json()
    except ValueError:
        log.warning("ec8a_vision: non-JSON 200 response")
        return None

    # Find the text block rather than assuming it is first. Responses can lead
    # with a thinking block, and indexing [0] silently turned those sheets into
    # "unavailable" — a systematic parsing bug wearing the costume of a run of
    # unreadable scans.
    text = next(
        (
            b.get("text", "")
            for b in (body.get("content") or [])
            if isinstance(b, dict) and b.get("type") == "text"
        ),
        None,
    )
    if not text:
        log.warning(
            "ec8a_vision: 200 with no text block (stop_reason=%s, types=%s)",
            body.get("stop_reason"),
            [b.get("type") for b in (body.get("content") or []) if isinstance(b, dict)],
        )
        return None

    return _score(text)


def _score(text: str) -> VisionReading:
    """Turn a raw model reading into a scored one.

    Confidence comes from the sheet disagreeing with itself or not, never from
    the model's own certainty.
    """
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        return VisionReading({}, None, None, None, None, 0.0, ["no JSON in response"], text)
    try:
        data = json.loads(m.group(0))
    except json.JSONDecodeError:
        return VisionReading({}, None, None, None, None, 0.0, ["malformed JSON"], text)

    problems: list[str] = []
    votes: dict[str, int] = {}
    agreed = 0
    rows = 0

    for row in data.get("parties") or []:
        if not isinstance(row, dict):
            continue
        code = str(row.get("party") or "").upper().strip()
        figures = row.get("figures")
        if not code or not isinstance(figures, int):
            continue
        rows += 1
        spelled = words_to_int(str(row.get("words") or ""))
        if spelled is None:
            problems.append(f"{code}: words column unreadable")
            continue
        if spelled != figures:
            # The sheet contradicts itself. Drop the party rather than pick a
            # column — there is no basis for preferring one over the other.
            problems.append(f"{code}: figures {figures} != words {spelled}")
            continue
        votes[code] = figures
        agreed += 1

    total_valid = data.get("total_valid") if isinstance(data.get("total_valid"), int) else None

    # Arithmetic check: the parties must add up to the recorded total.
    if total_valid is not None and votes:
        summed = sum(votes.values())
        if summed != total_valid:
            problems.append(f"party votes sum to {summed}, sheet says {total_valid}")

    # Confidence is the share of scored rows that survived cross-checking,
    # halved when the arithmetic does not close.
    confidence = (agreed / rows) if rows else 0.0
    if any("sum to" in p for p in problems):
        confidence *= 0.5
    if rows == 0:
        problems.append("no party rows read")

    return VisionReading(
        party_votes=votes,
        registered=data.get("registered") if isinstance(data.get("registered"), int) else None,
        accredited=data.get("accredited") if isinstance(data.get("accredited"), int) else None,
        rejected=data.get("rejected") if isinstance(data.get("rejected"), int) else None,
        total_valid=total_valid,
        confidence=round(confidence, 4),
        problems=problems,
        raw=text,
    )
