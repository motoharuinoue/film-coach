from itertools import pairwise
from typing import Any

import pytest

from film_coach.application.analyze_pose import analyze_pose
from film_coach.domain.metrics import METRIC_BY_KEY, AnalysisExtras, compute_metrics, invalid_reason, only_valid
from film_coach.domain.phases import detect_events, phase_at, to_phases
from film_coach.domain.pose import PoseSequence, smooth_sequence
from film_coach.infrastructure.json_pose import sequence_from_json


def test_イベントがドロップからフォローの順に並ぶ(base_sequence: PoseSequence) -> None:
    e = detect_events(smooth_sequence(base_sequence))
    assert 0 < e.set_start < e.stride_start < e.plant <= e.release < e.follow_start <= e.last
    assert e.last == len(base_sequence.frames) - 1


def test_リリースを合成データのリリース時刻の前後2フレームで検出する(base_sequence: PoseSequence) -> None:
    e = detect_events(smooth_sequence(base_sequence))
    assert abs(e.release - round(1.16 * base_sequence.fps)) <= 2


def test_フェーズが隙間なくつながる(base_sequence: PoseSequence) -> None:
    e = detect_events(smooth_sequence(base_sequence))
    phases = to_phases(e)
    for prev, cur in pairwise(phases):
        assert cur.start == prev.end
    assert phase_at(phases, e.release) == "release"
    assert phase_at(phases, 0) == "drop"


def test_ステップが狭いケースはステップ幅が小さく肘が低い(parity_cases: list[dict[str, Any]]) -> None:
    base, narrow = (analyze_pose(sequence_from_json(c["sequence"]), "side") for c in parity_cases[:2])
    assert narrow.metrics["strideRatio"] < base.metrics["strideRatio"]
    assert base.metrics["elbowHeight"] - narrow.metrics["elbowHeight"] > 3


def test_外から渡した値だけを指標に含める(base_sequence: PoseSequence) -> None:
    seq = smooth_sequence(base_sequence)
    e = detect_events(seq)
    assert "hipShoulderSep" not in compute_metrics(seq, e)
    with_extras = compute_metrics(seq, e, AnalysisExtras(hip_shoulder_sep=44, sequence_gap_s=0.04))
    assert with_extras["hipShoulderSep"] == 44
    assert with_extras["sequenceGap"] == pytest.approx(40)


def test_カメラ角度で測れない指標を捨てる() -> None:
    assert only_valid({"strideRatio": 0.5, "hipShoulderSep": 40}, "side") == {"strideRatio": 0.5}
    assert "後方から" in invalid_reason(METRIC_BY_KEY["hipShoulderSep"], "side")


def test_ユースケースは平滑化した骨格と測れる指標だけを返す(base_sequence: PoseSequence) -> None:
    a = analyze_pose(base_sequence, "behind")
    assert a.sequence != base_sequence
    assert "strideRatio" not in a.metrics  # 後方からでは測れない
    assert "elbowHeight" in a.metrics
