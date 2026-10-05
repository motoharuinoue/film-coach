"""画像の座標をワールド 2D に直し、投球を見つけて解析する。合成データを画像に写して確かめる（モデルも動画もいらない）"""

from typing import Any

import pytest

from film_coach.application.throws import analyze_throws
from film_coach.application.track_target import TargetFrame, TargetHint, TargetTrack, TrackSegment
from film_coach.domain.library import VideoInfo
from film_coach.domain.metrics import compute_metrics
from film_coach.domain.phases import detect_events
from film_coach.domain.pose import PoseSequence, smooth_sequence
from film_coach.domain.throws import find_throws
from film_coach.domain.tracking import Box
from film_coach.domain.world import (
    SEGMENT_RATIO,
    NotEnoughPoseError,
    WorldTransform,
    body_length_px,
    estimate_transform,
    mirror_pose,
    to_world,
)
from film_coach.infrastructure.json_pose import sequence_from_json

PX_PER_M = 300.0
"""合成データを画像に写すときの縮尺"""

Pose = list[tuple[float, float, float]]


def project(seq: PoseSequence, direction: int = 1, left: bool = False) -> list[Pose]:
    """ワールド 2D の骨格を画像（1920×1080、y は下向き）に写す。left なら左投げにする（左右を入れ替える）"""
    out = []
    for f in seq.frames:
        pose = [(960 + direction * p.x * PX_PER_M, 1000 - p.y * PX_PER_M, p.c) for p in f.kp]
        out.append(mirror_pose(pose) if left else pose)
    return out


def track_of(poses: list[Pose] | list[Pose | None], fps: float, cuts: list[int] | None = None) -> TargetTrack:
    frames = [TargetFrame(i, i / fps, Box(0, 0, 1, 1) if p else None, p or None) for i, p in enumerate(poses)]
    info = VideoInfo("synth.mov", fps, 1920, 1080, len(poses))
    return TargetTrack(info, TargetHint(0, 0, 0), [TrackSegment(1, 0, len(poses) - 1)], frames, 1, cuts or [])


def segment_ratio(seq: PoseSequence) -> float:
    """合成データの体の寸法での、太もも・すね・体幹の合計の身長比"""
    lengths = [body_length_px([(p.x, p.y, p.c) for p in f.kp]) for f in seq.frames]
    values = sorted(v for v in lengths if v is not None)
    return values[len(values) // 2] / seq.height_m


# ---- 座標の変換 ----


def test_変換は往復すると元に戻る() -> None:
    tf = WorldTransform(m_per_px=0.004, origin_x=500, ground_y=900, direction=-1, ankle_m=0.07)
    x, y = tf.to_world(320, 410)
    assert tf.to_image(x, y) == pytest.approx((320, 410))
    assert tf.to_world(500, 900) == pytest.approx((0, 0.07))
    assert tf.to_world(400, 900)[0] > 0  # 左へ投げる映像では、画像の左がワールドの前


@pytest.mark.parametrize(("direction", "left"), [(1, False), (-1, False), (1, True), (-1, True)])
def test_投げる向きと利き腕を見分け_縮尺と地面を見積もる(
    base_sequence: PoseSequence, direction: int, left: bool
) -> None:
    poses = project(base_sequence, direction, left)
    tf, hand = estimate_transform(poses, base_sequence.fps, base_sequence.height_m)
    assert hand == ("left" if left else "right")
    assert tf.direction == direction
    # 縮尺は、人体寸法の標準の比率と合成データの体の比率の違いのぶんだけずれる
    expected = 1 / PX_PER_M * SEGMENT_RATIO / segment_ratio(base_sequence)
    assert tf.m_per_px == pytest.approx(expected, rel=0.01)
    assert tf.m_per_px == pytest.approx(1 / PX_PER_M, rel=0.05)
    assert tf.ground_y == pytest.approx(1000 - 0.08 * PX_PER_M, abs=3)


def test_骨格が足りなければ見積もらない() -> None:
    blank = [[(0.0, 0.0, 0.1)] * 17] * 30
    with pytest.raises(NotEnoughPoseError):
        estimate_transform(blank, 60, 1.8)


def test_左投げは左右を入れ替えて右投げの規則で扱う(base_sequence: PoseSequence) -> None:
    poses = project(base_sequence, -1, left=True)
    tf, hand = estimate_transform(poses, base_sequence.fps, base_sequence.height_m)
    world = to_world(poses, [f.t for f in base_sequence.frames], base_sequence.fps, 1.8, tf, hand)
    # 投げる手首（rWrist）が、元の右手首と同じ動きになる
    a, b = base_sequence.frames[69].kp[10], world.frames[69].kp[10]
    c = base_sequence.frames[0].kp[10]
    d = world.frames[0].kp[10]
    assert (b.x - d.x) == pytest.approx((a.x - c.x) * tf.m_per_px * PX_PER_M, rel=1e-9)


# ---- 投球を見つける ----


def test_手首の速さのピークで投球を見つける(base_sequence: PoseSequence) -> None:
    windows = find_throws(smooth_sequence(base_sequence))
    assert [w.peak for w in windows] == [69]
    assert windows[0].start == 0 and windows[0].end == len(base_sequence.frames) - 1  # 区間は列の端で切れる


def test_手首が肩より下の速い動き_腕振りなどは投球に数えない(base_sequence: PoseSequence) -> None:
    from film_coach.domain.pose import Keypoint, PoseFrame

    def lower(f: PoseFrame) -> PoseFrame:
        kp = list(f.kp)
        w = kp[10]
        kp[10] = Keypoint(w.x, w.y - 0.8, w.c)  # 投げる手首を 80 cm 下げる（動きの速さは同じ）
        return PoseFrame(f.t, tuple(kp))

    swing = PoseSequence(60, 1.8, tuple(lower(f) for f in base_sequence.frames))
    assert find_throws(smooth_sequence(swing)) == []


def test_止まっているだけなら投球はない(base_sequence: PoseSequence) -> None:
    still = PoseSequence(60, 1.8, tuple([base_sequence.frames[0]] * 120))
    assert find_throws(still) == []


# ---- ユースケース ----


@pytest.mark.parametrize(("direction", "left"), [(1, False), (-1, True)])
def test_画像の骨格から_TypeScriptと同じフェーズと指標を出す(
    parity_cases: list[dict[str, Any]], direction: int, left: bool
) -> None:
    for case in parity_cases:
        seq = sequence_from_json(case["sequence"])
        result = analyze_throws(track_of(project(seq, direction, left), seq.fps), seq.height_m)
        assert result.hand == ("left" if left else "right")
        assert len(result.reps) == 1, case["name"]
        rep = result.reps[0]
        # フェーズの境目の判定はメートルのしきい値なので、縮尺の見積もりのずれで 1〜2 フレームずれることがある
        got_events, want_events = rep.analysis.events.to_json(), case["expected"]["events"]
        assert got_events["release"] == want_events["release"], case["name"]
        for key, frame in want_events.items():
            assert abs(got_events[key] - frame) <= 2, f"{case['name']} の {key}"
        # 角度は縮尺によらないので一致する。長さは縮尺の見積もりのずれ（数 %）のぶんだけ違う
        got, want = rep.analysis.metrics, case["expected"]["metrics"]
        for key in ("frontKnee", "elbowAngle", "trunkTilt"):
            assert got[key] == pytest.approx(want[key], abs=1e-6), f"{case['name']} の {key}"
        for key in ("strideRatio", "releaseHeight", "elbowHeight"):
            assert got[key] == pytest.approx(want[key], rel=0.05), f"{case['name']} の {key}"
        assert got["releaseTime"] == pytest.approx(want["releaseTime"], abs=2 / seq.fps)


def walk(a: Pose, b: Pose, n: int) -> list[Pose]:
    """姿勢 a から b へ、n フレームかけてゆっくり移る（投げ終わってから元の位置に戻る）"""
    return [
        [(pa[0] + (pb[0] - pa[0]) * k / n, pa[1] + (pb[1] - pa[1]) * k / n, pa[2]) for pa, pb in zip(a, b, strict=True)]
        for k in range(1, n + 1)
    ]


def test_長い映像から複数の投球を見つけ_それぞれの位置を映像のフレームで返す(base_sequence: PoseSequence) -> None:
    rep = project(base_sequence)
    n = len(rep)
    back = walk(rep[-1], rep[0], 60) + [rep[0]] * 60  # 1 秒かけて戻り、1 秒構える
    poses = [rep[0]] * 90 + rep + back + rep + [rep[-1]] * 60
    result = analyze_throws(track_of(poses, 60), 1.8)
    assert [r.index for r in result.reps] == [1, 2]
    starts = [90, 90 + n + len(back)]
    releases = [r.start + r.analysis.events.release for r in result.reps]
    assert releases == [s + 69 for s in starts]
    # 区間は構えの終わり（ドロップの始まり）から始まる
    assert all(abs(r.start - s) <= 2 for r, s in zip(result.reps, starts, strict=True))
    # x の原点は区間の最初の骨盤（画像に重ねるときは、投球ごとの変換で戻す）
    for r in result.reps:
        first = r.analysis.sequence.frames[0]
        pelvis_x = (first.kp[11].x + first.kp[12].x) / 2
        assert abs(pelvis_x) < 0.05


def test_骨格が途切れた所と場面の切り替わりはまたがない(base_sequence: PoseSequence) -> None:
    rep = project(base_sequence)
    half = 60
    # 投球の途中で骨格が途切れる → 短い区間に分かれ、どちらも投球として扱わない
    broken: list[Pose | None] = [*rep[:half], None, *rep[half + 1 :]]
    assert analyze_throws(track_of(broken, 60), 1.8).reps == []
    # 投球の途中に場面の切り替わり
    assert analyze_throws(track_of(rep, 60, cuts=[half]), 1.8).reps == []
    # 切り替わりの後ろにある投球は見つける
    idle = [rep[0]] * 60
    result = analyze_throws(track_of(idle + rep, 60, cuts=[60]), 1.8)
    assert [r.start for r in result.reps] == [60]


def test_骨格がまったくなければ分かるように失敗する() -> None:
    with pytest.raises(NotEnoughPoseError):
        analyze_throws(track_of([None] * 30, 60), 1.8)


def test_合成データの指標は_変換を通しても_元の値とほぼ同じ(base_sequence: PoseSequence) -> None:
    # 変換の前後で、平滑化 → フェーズ → 指標の流れがそのまま使えることの確認
    events = detect_events(smooth_sequence(base_sequence))
    metrics = compute_metrics(smooth_sequence(base_sequence), events)
    result = analyze_throws(track_of(project(base_sequence, -1), 60), 1.8)
    assert result.reps[0].analysis.metrics["frontKnee"] == pytest.approx(metrics["frontKnee"], abs=1e-6)


def path(xs: list[float]) -> PoseSequence:
    """全部の関節が同じ点にいる、骨盤の動きだけを持つ列"""
    from film_coach.domain.pose import Keypoint, PoseFrame

    return PoseSequence(60, 1.8, tuple(PoseFrame(i / 60, (Keypoint(x, 1.0, 0.9),) * 17) for i, x in enumerate(xs)))


def test_区間の始まりは_ドロップの前の構えの終わり() -> None:
    from film_coach.domain.throws import motion_start

    # 1 秒構える → 1.5 m 下がる → 0.33 秒セットで止まる → 前へ踏み出して投げる
    xs = [0.0] * 60 + [-1.5 * k / 40 for k in range(1, 41)] + [-1.5] * 20 + [-1.5 + 0.02 * k for k in range(1, 21)]
    # セットの静止ではなく、ドロップの前の構え。速さは中心差分なので、動き出す 1 つ前（59）も動いている扱い
    assert motion_start(path(xs), peak=135) == 58


def test_ドロップのない投球は_構えを少し含めて始める() -> None:
    from film_coach.domain.throws import STILL_S, motion_start

    xs = [0.0] * 60 + [0.01 * k for k in range(1, 41)]  # その場で構え、前へ踏み出して投げる
    assert motion_start(path(xs), peak=90) == 58 - round(STILL_S * 60)


def test_本人が小さく映っていれば注意を添える(base_sequence: PoseSequence) -> None:
    rep = project(base_sequence)
    small = [[(960 + (x - 960) * 0.3, 1000 + (y - 1000) * 0.3, c) for x, y, c in p] for p in rep]
    result = analyze_throws(track_of(small, 60), 1.8)
    assert any("小さく映って" in w for w in result.warnings)
    assert analyze_throws(track_of(rep, 60), 1.8).warnings == []


def test_投球が見つからなければ注意を添える(base_sequence: PoseSequence) -> None:
    rep = project(base_sequence)
    result = analyze_throws(track_of([rep[0]] * 120, 60), 1.8)
    assert result.reps == [] and any("投球が見つかりません" in w for w in result.warnings)
