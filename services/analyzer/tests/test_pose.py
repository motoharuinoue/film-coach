import pytest

from film_coach.domain.pose import (
    Keypoint,
    PoseFrame,
    PoseSequence,
    Vec2,
    joint_angle,
    js_round,
    smooth_sequence,
    speed_series,
)


def still(x: float, y: float) -> tuple[Keypoint, ...]:
    return tuple(Keypoint(x, y, 0.9) for _ in range(17))


def test_直角を90度と計算する() -> None:
    assert joint_angle(Vec2(1, 0), Vec2(0, 0), Vec2(0, 1)) == pytest.approx(90)


def test_一直線なら180度になる() -> None:
    assert joint_angle(Vec2(-1, 0), Vec2(0, 0), Vec2(2, 0)) == pytest.approx(180)


def test_等速で動く関節の速さを中心差分で求め_端は片側差分() -> None:
    fps = 60
    seq = PoseSequence(fps, 1.8, tuple(PoseFrame(i / fps, still(i * 0.05, 1)) for i in range(10)))
    v = speed_series(seq, "rWrist")
    assert v[5] == pytest.approx(3)
    assert v[0] == pytest.approx(3)


def test_止まっている骨格は平滑化しても位置が変わらない() -> None:
    seq = PoseSequence(60, 1.8, tuple(PoseFrame(i / 60, still(0.3, 1.2)) for i in range(8)))
    for f in smooth_sequence(seq).frames:
        assert f.kp[10].x == pytest.approx(0.3)
        assert f.kp[10].y == pytest.approx(1.2)


def test_1フレームだけの外れ値を弱める() -> None:
    frames = tuple(PoseFrame(i / 60, still(0, 0.5 if i == 4 else 0)) for i in range(9))
    assert smooth_sequence(PoseSequence(60, 1.8, frames)).frames[4].kp[0].y < 0.15


@pytest.mark.parametrize(("x", "expected"), [(0.5, 1), (1.5, 2), (2.5, 3), (-0.5, 0), (6.000000000000001, 6)])
def test_JavaScriptと同じ丸め(x: float, expected: int) -> None:
    # Python の round(2.5) は 2（偶数丸め）だが、Math.round(2.5) は 3
    assert js_round(x) == expected
