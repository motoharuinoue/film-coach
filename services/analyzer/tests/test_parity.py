"""TypeScript（apps/web/src/domain）と同じ規則で計算していることを、共通データで確かめる。"""

from typing import Any

import pytest

from film_coach.domain.metrics import compute_metrics
from film_coach.domain.phases import detect_events
from film_coach.domain.pose import smooth_sequence
from film_coach.infrastructure.json_pose import sequence_from_json


def test_共通データに4ケースある(parity_cases: list[dict[str, Any]]) -> None:
    assert len(parity_cases) == 4


@pytest.mark.parametrize("index", range(4))
def test_フェーズと指標がTypeScriptの結果と一致する(parity_cases: list[dict[str, Any]], index: int) -> None:
    case = parity_cases[index]
    seq = smooth_sequence(sequence_from_json(case["sequence"]))
    events = detect_events(seq)
    assert events.to_json() == case["expected"]["events"], case["name"]
    metrics = compute_metrics(seq, events)
    assert set(metrics) == set(case["expected"]["metrics"])
    for key, expected in case["expected"]["metrics"].items():
        assert metrics[key] == pytest.approx(expected, abs=1e-9), f"{case['name']} の {key}"
