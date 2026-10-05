"""ユースケース track_target を、ポートの代役（フェイク）で確かめる。モデルも動画もいらない。"""

from collections.abc import Iterator

import pytest

from film_coach.application.track_target import (
    Frame,
    ImageKeypoint,
    TargetFrame,
    TargetHint,
    TargetNotFoundError,
    track_target,
)
from film_coach.domain.library import VideoInfo
from film_coach.domain.tracking import Box

N = 60


class FakeVideo:
    """フレームの中身はフレーム番号だけ"""

    def __init__(self) -> None:
        self.reads = 0

    def info(self) -> VideoInfo:
        return VideoInfo("fake.mov", 30, 1920, 1080, N)

    def frames(self) -> Iterator[tuple[int, Frame]]:
        self.reads += 1
        yield from ((i, i) for i in range(N))


class FakeDetector:
    """対象選手（右へ歩く）と、止まっている別の人。対象選手は 20〜31 フレームで人の陰に隠れる（追跡の待ちより長い）"""

    def detect(self, frame: Frame) -> list[Box]:
        i = int(frame)  # type: ignore[call-overload]
        people = [Box(1600, 300, 1670, 480, 0.9)]
        if not 20 <= i <= 31:
            people.append(Box(100 + 5 * i, 300, 170 + 5 * i, 480, 0.85))
        return people


class FakePose:
    def __init__(self) -> None:
        self.calls: list[Box] = []

    def estimate(self, frame: Frame, box: Box) -> list[ImageKeypoint]:
        self.calls.append(box)
        return [(box.cx, box.cy, 0.9)] * 17


class FakeSink:
    def __init__(self) -> None:
        self.written: list[TargetFrame] = []
        self.closed = False

    def write(self, frame: Frame, result: TargetFrame) -> None:
        self.written.append(result)

    def close(self) -> None:
        self.closed = True


def test_指した人を追い_隠れた間も補間して_その人だけ骨格を出す() -> None:
    video, pose, sink = FakeVideo(), FakePose(), FakeSink()
    tt = track_target(video, FakeDetector(), pose, TargetHint(x=135 + 5 * 10, y=400, t=10 / 30), sink)
    assert video.reads == 2  # 検出と骨格推定で 2 回読む
    assert tt.people_tracked == 3  # 止まっている人、対象選手（隠れる前）、対象選手（隠れた後）
    assert len(tt.segments) == 2  # 隠れる前後をつないだ
    assert tt.coverage == 1.0
    assert [f.index for f in tt.frames if f.interpolated] == list(range(20, 32))
    assert len(pose.calls) == N  # 対象選手のぶんだけ。止まっている人の骨格は出さない
    assert all(b.x1 < 1000 for b in pose.calls)
    assert sink.closed and len(sink.written) == N


def test_指した場所に人がいなければ分かるように失敗する() -> None:
    with pytest.raises(TargetNotFoundError, match="見つかりません"):
        track_target(FakeVideo(), FakeDetector(), FakePose(), TargetHint(x=960, y=900, t=1))


def test_進み具合を段階ごとに知らせる() -> None:
    seen: list[tuple[str, int, int]] = []
    track_target(
        FakeVideo(), FakeDetector(), FakePose(), TargetHint(185, 400, 10 / 30), progress=lambda *a: seen.append(a)
    )
    assert seen[0] == ("detect", 1, N) and seen[N - 1] == ("detect", N, N)
    assert seen[-1] == ("pose", N, N)
