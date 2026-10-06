"""投げ始め（ドロップから／その場から）と、映っていない区間からは測らない指標。"""

from dataclasses import replace

import pytest
from test_throws import project, track_of

from film_coach.application.throws import analyze_throws
from film_coach.domain.approach import ApproachInfo, decide_approach, detect_approach, drop_depth
from film_coach.domain.metrics import MIN_SET_S, compute_metrics
from film_coach.domain.phases import detect_events, stride_found, stride_seen
from film_coach.domain.pose import KP, Keypoint, PoseFrame, PoseSequence, smooth_sequence
from film_coach.domain.throws import DROP_M
from film_coach.infrastructure.json_throws import throws_from_json, throws_to_json


def frames_from(seq: PoseSequence, start: int, still: int = 0) -> PoseSequence:
    """start 以降の骨格。still フレームだけ、最初の姿勢で止まっている構えを前に足す"""
    frames = [seq.frames[start]] * still + list(seq.frames[start:])
    return PoseSequence(seq.fps, seq.height_m, tuple(PoseFrame(i / seq.fps, f.kp) for i, f in enumerate(frames)))


def frozen_front_foot(seq: PoseSequence) -> PoseSequence:
    """前足（左足首）が最初の位置から動かない列。ステップが見つからない"""
    i = KP["lAnkle"]
    first = seq.frames[0].kp[i]
    frames = (replace(f, kp=(*f.kp[:i], Keypoint(first.x, first.y, f.kp[i].c), *f.kp[i + 1 :])) for f in seq.frames)
    return replace(seq, frames=tuple(frames))


@pytest.fixture
def smoothed(base_sequence: PoseSequence) -> PoseSequence:
    return smooth_sequence(base_sequence)


# ---- 映っていない区間からは測らない ----


def test_ステップが見つからなければ_ステップと接地をリリースにそろえ_足の指標を出さない(smoothed: PoseSequence) -> None:
    seq = frozen_front_foot(smoothed)
    e = detect_events(seq)
    assert e.stride_start == e.plant == e.release and not stride_found(e)
    m = compute_metrics(seq, e)
    assert not {"releaseTime", "strideRatio", "frontKnee", "headStability"} & set(m)
    assert {"elbowHeight", "elbowAngle", "releaseHeight", "trunkTilt"} <= set(m)


def test_ステップの途中から映っていれば_始動からリリースだけ出さない(smoothed: PoseSequence) -> None:
    e = detect_events(smoothed)
    cut = frames_from(smoothed, e.stride_start + 2)
    ce = detect_events(cut)
    assert ce.stride_start == 0 and stride_found(ce) and not stride_seen(ce)
    m = compute_metrics(cut, ce)
    assert "releaseTime" not in m and "headStability" not in m
    assert m["strideRatio"] == pytest.approx(compute_metrics(smoothed, e)["strideRatio"], abs=1e-9)


def test_頭の上下動は_ステップの前が短すぎれば出さない(smoothed: PoseSequence) -> None:
    e = detect_events(smoothed)
    need = round(MIN_SET_S * smoothed.fps)
    short = frames_from(smoothed, e.stride_start - (need - 2))
    long = frames_from(smoothed, e.stride_start - (need + 2))
    assert "headStability" not in compute_metrics(short, detect_events(short))
    assert "headStability" in compute_metrics(long, detect_events(long))


# ---- 投げ始め ----


def test_ステップの前に骨盤が後ろへ下がっていれば_ドロップから(smoothed: PoseSequence) -> None:
    a = detect_approach(smoothed, detect_events(smoothed), "side")
    assert a.kind == "drop" and a.drop_m is not None and a.drop_m >= DROP_M


def test_下がらずに構えてから踏み出していれば_その場から(smoothed: PoseSequence) -> None:
    e = detect_events(smoothed)
    seq = frames_from(smoothed, e.set_start, still=30)  # セットの姿勢で 0.5 秒構えてから投げる
    a = detect_approach(seq, detect_events(seq), "side")
    assert a.kind == "standing" and a.drop_m is not None and a.drop_m < DROP_M


def test_構えが映っていない_横から以外_ステップがなければ_分からない(smoothed: PoseSequence) -> None:
    e = detect_events(smoothed)
    late = frames_from(smoothed, e.set_start + (e.stride_start - e.set_start) // 2 + 1)
    assert detect_approach(late, detect_events(late), "side").kind == "unknown"
    assert detect_approach(smoothed, e, "behind") == ApproachInfo("unknown", None)
    frozen = frozen_front_foot(smoothed)
    assert detect_approach(frozen, detect_events(frozen), "side").kind == "unknown"


def test_指定すればそれに従い_下がった距離は測れれば添える(smoothed: PoseSequence) -> None:
    e = detect_events(smoothed)
    a = decide_approach(smoothed, e, "side", "standing")
    assert a.kind == "standing" and a.drop_m == pytest.approx(drop_depth(smoothed, e.stride_start))
    assert decide_approach(smoothed, e, "behind", "drop") == ApproachInfo("drop", None)


def test_下がった距離は_一度前へ出てから下がった分も測る() -> None:
    xs = [0.0, 0.3, 0.1, -0.4, -0.2]
    seq = PoseSequence(60, 1.8, tuple(PoseFrame(i / 60, (Keypoint(x, 1.0, 0.9),) * 17) for i, x in enumerate(xs)))
    assert drop_depth(seq, 4) == pytest.approx(0.7)
    assert drop_depth(seq, 1) == 0


# ---- 投球の解析と保存 ----


def test_投球ごとに投げ始めを見分け_JSONに書いて読み戻せる(base_sequence: PoseSequence) -> None:
    rep = project(base_sequence, direction=-1)
    ta = analyze_throws(track_of([rep[0]] * 60 + rep + [rep[-1]] * 30, 60), 1.8)
    assert ta.approach_mode == "auto" and ta.reps[0].approach.kind == "drop"
    back = throws_from_json(throws_to_json(ta))
    assert back.reps[0].approach == ApproachInfo("drop", round(ta.reps[0].approach.drop_m or 0, 3))
    fixed = analyze_throws(track_of([rep[0]] * 60 + rep + [rep[-1]] * 30, 60), 1.8, approach="standing")
    assert fixed.approach_mode == "standing" and fixed.reps[0].approach.kind == "standing"


def test_投げ始めを入れる前の解析結果は_分からないとして読む(base_sequence: PoseSequence) -> None:
    rep = project(base_sequence, direction=-1)
    data = throws_to_json(analyze_throws(track_of([rep[0]] * 60 + rep + [rep[-1]] * 30, 60), 1.8))
    del data["approachMode"]
    for r in data["reps"]:
        del r["approach"]
    back = throws_from_json(data)
    assert back.approach_mode == "auto" and back.reps[0].approach == ApproachInfo("unknown", None)
