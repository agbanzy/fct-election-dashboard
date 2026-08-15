"""Tests for the EC8A vision reading and its confidence scoring.

This is the gate between a scanned sheet and a published vote count, so the
cases that matter most are the ones where a reading must be *rejected*.
"""

from __future__ import annotations

import json

from app.ocr.ec8a_vision import _score, words_to_int


def _resp(parties, **kw):
    payload = {"parties": parties, **kw}
    return json.dumps(payload)


class TestWordsToInt:
    def test_reads_the_written_column(self):
        assert words_to_int("one hundred and twenty two") == 122
        assert words_to_int("six") == 6
        assert words_to_int("two thousand one hundred") == 2100
        assert words_to_int("ZERO") == 0

    def test_refuses_what_it_cannot_read_cleanly(self):
        # Anything unparseable must be None, never a best guess — this
        # function exists to disagree with the figures column when the two
        # really differ, so a wrong parse would defeat the whole check.
        assert words_to_int("one hundred and twety") is None
        assert words_to_int("scribble") is None
        assert words_to_int("") is None
        assert words_to_int("---") is None


class TestScoring:
    def test_corroborated_rows_are_kept(self):
        r = _score(
            _resp(
                [
                    {"party": "APC", "figures": 122, "words": "one hundred and twenty two"},
                    {"party": "A", "figures": 195, "words": "one hundred and ninety five"},
                ],
                total_valid=317,
            )
        )
        assert r.party_votes == {"APC": 122, "A": 195}
        assert r.confidence == 1.0
        assert r.problems == []

    def test_row_is_dropped_when_figures_and_words_disagree(self):
        # The sheet contradicts itself. There is no basis for preferring one
        # column, so the party is dropped rather than guessed at.
        r = _score(
            _resp([{"party": "APC", "figures": 122, "words": "one hundred and twelve"}])
        )
        assert "APC" not in r.party_votes
        assert r.confidence == 0.0
        assert any("!=" in p for p in r.problems)

    def test_row_is_dropped_when_words_are_illegible(self):
        r = _score(_resp([{"party": "PDP", "figures": 40, "words": "sqiggle"}]))
        assert r.party_votes == {}
        assert r.confidence == 0.0

    def test_confidence_is_halved_when_arithmetic_does_not_close(self):
        # Every row corroborated, but the parties do not sum to the sheet's own
        # total — so something was missed, and the reading must not publish.
        r = _score(
            _resp(
                [
                    {"party": "APC", "figures": 10, "words": "ten"},
                    {"party": "PDP", "figures": 20, "words": "twenty"},
                ],
                total_valid=200,
            )
        )
        assert r.confidence == 0.5
        assert any("sum to" in p for p in r.problems)

    def test_partial_corroboration_lowers_confidence(self):
        r = _score(
            _resp(
                [
                    {"party": "APC", "figures": 10, "words": "ten"},
                    {"party": "PDP", "figures": 20, "words": "twenny"},
                ]
            )
        )
        assert r.party_votes == {"APC": 10}
        assert r.confidence == 0.5

    def test_garbage_response_scores_zero(self):
        assert _score("I could not read this sheet.").confidence == 0.0
        assert _score("{not json").confidence == 0.0

    def test_empty_sheet_is_not_confident(self):
        r = _score(_resp([]))
        assert r.confidence == 0.0
        assert r.party_votes == {}

    def test_nulls_are_not_coerced_to_numbers(self):
        # A model told to emit null for illegible fields must not have those
        # nulls become zeros downstream.
        r = _score(
            _resp(
                [{"party": "APC", "figures": None, "words": None}],
                total_valid=None,
                accredited=None,
            )
        )
        assert r.party_votes == {}
        assert r.total_valid is None
        assert r.accredited is None
