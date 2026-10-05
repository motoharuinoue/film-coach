import pytest

from film_coach.domain.tracking import (
    Box,
    IouTracker,
    Track,
    crosses_cut,
    fill_gaps,
    iou,
    link_tracks,
    merge_boxes,
    pick_track,
)


def walk(x0: float, vx: float, frames: range, y: float = 300, h: float = 180) -> dict[int, Box]:
    """一定の速さで横に歩く人の枠"""
    return {f: Box(x0 + vx * f, y, x0 + vx * f + 70, y + h, 0.9) for f in frames}


def test_iouは同じ枠で1_離れた枠で0() -> None:
    a = Box(0, 0, 10, 10)
    assert iou(a, a) == pytest.approx(1)
    assert iou(a, Box(20, 20, 30, 30)) == 0
    assert iou(a, Box(5, 0, 15, 10)) == pytest.approx(50 / 150)


def test_歩く2人を別々の追跡としてつなぐ() -> None:
    a, b = walk(100, 3, range(30)), walk(600, -2, range(30))
    tracker = IouTracker()
    for f in range(30):
        tracker.update(f, [a[f], b[f]])
    assert len(tracker.tracks) == 2
    assert all(len(t.boxes) == 30 for t in tracker.tracks)


def test_信頼度の低い検出からは新しい追跡を始めない() -> None:
    tracker = IouTracker()
    tracker.update(0, [Box(0, 0, 50, 100, 0.35)])
    assert tracker.tracks == []


def test_点を含む枠の追跡を選び_近くのフレームも探す() -> None:
    t1, t2 = Track(1, walk(100, 0, range(10, 20))), Track(2, walk(400, 0, range(0, 20)))
    assert pick_track([t1, t2], 15, 130, 380) is t1
    assert pick_track([t1, t2], 5, 130, 380) is t1  # フレーム 5 にはいないが、10 にいる
    assert pick_track([t1, t2], 15, 900, 380) is None


def test_人の陰で途切れた追跡を_位置と大きさでつなぎ直す() -> None:
    before = Track(1, walk(100, 4, range(0, 40)))
    after = Track(2, walk(100, 4, range(50, 90)))  # 10 フレーム見失ったあと、同じ速さで続く
    other = Track(3, walk(900, 0, range(45, 90)))  # 遠くにいる別の人
    tall = Track(4, walk(100, 4, range(48, 90), h=400))  # 位置は近いが大きさが違う
    chain = link_tracks([before, after, other, tall], before)
    assert [t.id for t in chain] == [1, 2]


def test_後ろ向きにもつなぐ() -> None:
    head = Track(1, walk(100, 4, range(0, 30)))
    seed = Track(2, walk(100, 4, range(40, 80)))
    assert [t.id for t in link_tracks([head, seed], seed)] == [1, 2]


def test_遠すぎる追跡や間が長すぎる追跡はつながない() -> None:
    a = Track(1, walk(100, 4, range(0, 30)))
    far_gap = Track(2, walk(100, 4, range(60, 90)))  # 30 フレーム空いている
    assert [t.id for t in link_tracks([a, far_gap], a, max_gap=20)] == [1]


def test_つないだ追跡を1本にまとめ_短い抜けを補間する() -> None:
    a, b = Track(1, walk(100, 4, range(0, 10))), Track(2, walk(100, 4, range(15, 20)))
    boxes, filled = fill_gaps(merge_boxes([a, b]))
    assert sorted(boxes) == list(range(20))
    assert filled == {10, 11, 12, 13, 14}
    assert boxes[12].x1 == pytest.approx(100 + 4 * 12)  # 等速なので補間も同じ位置


def test_長い抜けは補間しない() -> None:
    boxes, filled = fill_gaps({0: Box(0, 0, 10, 10), 50: Box(0, 0, 10, 10)}, max_gap=20)
    assert filled == set()
    assert sorted(boxes) == [0, 50]


# ---- 場面の切り替わり（カット） ----


def test_カットはその前後のフレームの間にあるかで判定する() -> None:
    cuts = frozenset({40})
    assert crosses_cut(39, 40, cuts) and crosses_cut(10, 50, cuts)
    assert not crosses_cut(40, 45, cuts) and not crosses_cut(30, 39, cuts)


def test_カットのあとは_同じ位置にいても前の場面の追跡を続けない() -> None:
    a = walk(100, 3, range(60))
    tracker = IouTracker()
    for f in range(60):
        tracker.update(f, [a[f]], cut=f == 40)
    assert [(t.first, t.last) for t in tracker.tracks] == [(0, 39), (40, 59)]


def test_カットの向こうは探さず_つながず_補間しない() -> None:
    cuts = frozenset({40})
    before, after = Track(1, walk(100, 4, range(0, 36))), Track(2, walk(100, 4, range(42, 80)))
    assert pick_track([before], 41, 250, 380) is before  # カットを知らなければ、前の場面の 35 フレーム目で見つかる
    assert pick_track([before], 41, 250, 380, cuts=cuts) is None
    assert [t.id for t in link_tracks([before, after], before, cuts=cuts)] == [1]
    assert [t.id for t in link_tracks([before, after], after, cuts=cuts)] == [2]
    boxes, filled = fill_gaps(merge_boxes([before, after]), cuts=cuts)
    assert filled == set() and 38 not in boxes
