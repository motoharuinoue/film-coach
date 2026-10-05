"""場面の切り替わりの検出（OpenCV の実装）を、作った画像で確かめる。モデルも動画もいらない。"""

import numpy as np

from film_coach.infrastructure.video_cv import OpenCvShotDetector

H, W = 192, 108


def field(shift: int = 0, players: tuple[int, ...] = (30, 70)) -> np.ndarray:
    """芝の上に選手が並ぶ画（BGR）。shift でカメラを横に振る"""
    img = np.zeros((H, W, 3), np.uint8)
    img[: H // 3] = (230, 180, 120)  # 空
    img[H // 3 :] = (60, 150, 40)  # 芝
    for x in players:
        x0 = (x + shift) % W
        img[90:150, x0 : x0 + 12] = (40, 40, 200)
    return img


def cuts(frames: list[np.ndarray], **kw: float) -> list[int]:
    d = OpenCvShotDetector(**kw)  # type: ignore[arg-type]
    return [i for i, f in enumerate(frames) if d.is_cut(f)]


def test_色が大きく変わったらカット() -> None:
    other = np.full((H, W, 3), (200, 40, 160), np.uint8)
    assert cuts([field()] * 20 + [other] * 20) == [20]


def test_色が同じでも_画の形が変われば_カット() -> None:
    # 同じ競技場の別の画角：色の分布はほぼ同じで、選手と空の位置が違う
    a = [field(players=(20,))] * 20
    b = np.flipud(field(players=(80,)))
    assert cuts([*a, *[b] * 20]) == [20]


def test_カメラを少しずつ振るだけなら切らない() -> None:
    assert cuts([field(shift=s) for s in range(0, 60, 2)]) == []


def test_明るさが変わるだけなら切らない() -> None:
    base = field()
    darker = (base * 0.8).astype(np.uint8)
    assert cuts([base] * 10 + [darker] * 10) == []


def test_真っ暗な間は_形を比べず_何度も切らない() -> None:
    black = np.zeros((H, W, 3), np.uint8)
    assert cuts([field()] * 10 + [black] * 30 + [field()] * 10) == [10, 40]


def test_前のカットのすぐあとは切らない() -> None:
    x = np.full((H, W, 3), (200, 40, 160), np.uint8)
    frames = [field()] * 10 + [x] * 3 + [field()] * 10  # 3 フレームだけ別の画（フラッシュなど）
    assert cuts(frames, min_frames=8) == [10]
    assert cuts(frames, min_frames=2) == [10, 13]
