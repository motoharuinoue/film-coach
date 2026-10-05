"""カメラの動きを打ち消す変換（ドメイン）と、OpenCV での見積もり。作った画像で確かめる（モデルも動画もいらない）。"""

import numpy as np
import pytest

from film_coach.domain.motion import IDENTITY, Affine, accumulate
from film_coach.domain.tracking import Box
from film_coach.infrastructure.video_cv import OpenCvCameraMotion


def test_変換を合成すると_内側から順に当てる() -> None:
    shift, zoom = Affine(tx=10, ty=-5), Affine(a=2, d=2)
    assert zoom.after(shift).apply(1, 1) == (22, -8)  # (1+10, 1-5) を 2 倍
    assert shift.after(zoom).apply(1, 1) == (12, -3)
    assert IDENTITY.after(shift) == shift


def test_1つ前への変換を積み重ね_場面の切り替わりで始め直す() -> None:
    step = Affine(tx=2)
    cum = accumulate([None, step, step, None, step, step], cuts=frozenset({4}))
    assert [m.apply(0, 0)[0] for m in cum] == [0, 2, 4, 4, 0, 2]  # 見積もれなかったフレームは動きなし


def texture(h: int, w: int, seed: int = 1) -> np.ndarray:
    """背景の模様（角がたくさんある画）"""
    rng = np.random.default_rng(seed)
    small = rng.integers(0, 255, (h // 8, w // 8, 3), dtype=np.uint8)
    return np.kron(small, np.ones((8, 8, 1), dtype=np.uint8))


def test_背景の動きからカメラの動きを見積もり_人の動きには引っ張られない() -> None:
    world = texture(1200, 2400)
    person = texture(304, 120, seed=2)
    motion = OpenCvCameraMotion(width=960)
    got = []
    for k in range(6):
        # カメラが 1 フレームに右へ 12 px、下へ 4 px 振れる → 画は左上へ流れる
        x0, y0 = 100 + 12 * k, 50 + 4 * k
        frame = world[y0 : y0 + 1080, x0 : x0 + 1920].copy()
        # 人は画の中で右へ速く動く（背景とは違う動き）
        px = 600 + 40 * k
        frame[500:804, px : px + 120] = person
        step = motion.step(frame, [Box(px, 500, px + 120, 804, 0.9)])
        if step is not None:
            got.append(step.apply(0, 0))
    assert len(got) == 5
    # 同じ背景の点は、1 つ前のフレームでは右へ 12 px、下へ 4 px の所にあった
    for tx, ty in got:
        assert tx == pytest.approx(12, abs=1.0) and ty == pytest.approx(4, abs=1.0)


def test_模様のない画では見積もらない() -> None:
    motion = OpenCvCameraMotion()
    flat = np.full((1080, 1920, 3), 120, np.uint8)
    assert motion.step(flat, []) is None and motion.step(flat, []) is None
