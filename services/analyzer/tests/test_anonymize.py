"""公開用に、本人以外と顔をぼかした動画を書き出す。"""

import io
from collections.abc import Iterator
from dataclasses import replace
from pathlib import Path

import numpy as np
import pytest

from film_coach.adapters.cli import run
from film_coach.application.anonymize import TrackMismatchError, anonymize_video, repaired_frames
from film_coach.application.track_target import Frame, TargetFrame, TargetHint, TargetTrack, TrackSegment
from film_coach.bootstrap import cli_deps
from film_coach.domain.library import VideoInfo
from film_coach.domain.tracking import Box
from film_coach.domain.world import REPAIR_CONF
from film_coach.infrastructure.video_cv import anonymize_frame, body_mask

W, H = 640, 360
BOX = Box(250, 60, 390, 340, 0.9)


def pose(wrist_conf: float = 0.9, wrist: tuple[float, float] = (380, 120)) -> list[tuple[float, float, float]]:
    """枠の中に立つ人の骨格（頭は 320,90 のあたり）"""
    kp = [(320.0, 90.0, 0.9)] * 5  # 鼻・目・耳
    kp += [
        (290, 130, 0.9),
        (350, 130, 0.9),
        (280, 190, 0.9),
        (360, 170, 0.9),
        (275, 240, 0.9),
        (wrist[0], wrist[1], wrist_conf),
    ]
    kp += [(300, 230, 0.9), (340, 230, 0.9), (295, 285, 0.9), (345, 285, 0.9), (290, 335, 0.9), (350, 335, 0.9)]
    return kp


def noise() -> np.ndarray:
    return np.random.default_rng(1).integers(0, 255, (H, W, 3), dtype=np.uint8)


def test_本人の体の外と顔はぼかし_体はそのまま残す() -> None:
    img = noise()
    out = anonymize_frame(img, TargetFrame(0, 0.0, BOX, pose()))
    diff = np.abs(out.astype(int) - img.astype(int)).mean(axis=2)
    assert diff[180, 320] == 0  # 胴体の中心
    assert diff[20:40, 20:200].mean() > 30  # 枠の外
    assert diff[80:100, 310:330].mean() > 30  # 顔（モザイク）
    # 枠の中でも、体から離れた所（後ろの人がいるかもしれない所）はぼかす
    assert diff[300:330, 255:270].mean() > 30


def test_本人を見失ったフレームは全体をぼかし_骨格がなければ枠を残す() -> None:
    img = noise()
    out = anonymize_frame(img, TargetFrame(0, 0.0, None, None))
    assert np.abs(out.astype(int) - img.astype(int)).mean() > 30
    mask = body_mask((H, W), TargetFrame(0, 0.0, BOX, None))
    assert mask[200, 260] == 255 and mask[200, 240] == 0


def test_腕を速く振って信頼度の低い関節は_前後から補って体の形に入れる() -> None:
    frames = [
        TargetFrame(0, 0.0, BOX, pose(0.9, (380, 120))),
        TargetFrame(1, 1 / 30, BOX, pose(0.1, (200, 300))),  # 取り違え
        TargetFrame(2, 2 / 30, BOX, pose(0.9, (400, 100))),
        TargetFrame(4, 4 / 30, BOX, pose(0.1, (200, 300))),  # 前のフレームと続いていない
    ]
    fixed = repaired_frames(frames, 30)
    x, y, c = fixed[1].keypoints[10]  # type: ignore[index]
    assert (x, y) == pytest.approx((390, 110)) and c == REPAIR_CONF
    assert fixed[3].keypoints == frames[3].keypoints
    assert fixed[0].keypoints == frames[0].keypoints


class Video:
    def __init__(self, n: int, size: tuple[int, int] = (W, H)) -> None:
        self.n, self.size = n, size

    def info(self) -> VideoInfo:
        return VideoInfo("v.mov", 30, self.size[0], self.size[1], self.n)

    def frames(self) -> Iterator[tuple[int, Frame]]:
        yield from ((i, noise()) for i in range(self.n))


class Sink:
    def __init__(self) -> None:
        self.got: list[TargetFrame] = []
        self.closed = False

    def write(self, frame: Frame, result: TargetFrame) -> None:
        self.got.append(result)

    def close(self) -> None:
        self.closed = True


def track(frames: list[TargetFrame], size: tuple[int, int] = (W, H)) -> TargetTrack:
    return TargetTrack(
        VideoInfo("v.mov", 30, size[0], size[1], 4), TargetHint(320, 200, 0), [TrackSegment(1, 0, 3)], frames, 1, []
    )


def test_動画のフレームを順に渡し_追跡結果にないフレームは見失った扱いにする() -> None:
    sink = Sink()
    n = anonymize_video(Video(4), track([TargetFrame(0, 0, BOX, pose()), TargetFrame(2, 2 / 30, BOX, pose())]), sink)
    assert n == 4 and sink.closed
    assert [f.box is not None for f in sink.got] == [True, False, True, False]


def test_別の動画の追跡結果は断る() -> None:
    with pytest.raises(TrackMismatchError, match="大きさ"):
        anonymize_video(Video(4, (1920, 1080)), track([]), Sink())


def test_CLIのanonymizeで書き出す(tmp_path: Path) -> None:
    sink = Sink()
    deps = replace(
        cli_deps(),
        open_video=lambda _p: Video(3),
        read_track=lambda _p: track([TargetFrame(0, 0, BOX, pose())]),
        anonymizer=lambda _dest, _info: sink,
    )
    out = io.StringIO()
    assert run(["anonymize", "v.mov", "--track", "t.json", "--out", str(tmp_path / "o.mp4")], deps, out) == 0
    assert "3 フレーム" in out.getvalue() and len(sink.got) == 3
    bad = replace(deps, read_track=lambda _p: track([], (1920, 1080)))
    assert run(["anonymize", "v.mov", "--track", "t.json", "--out", "o.mp4"], bad, io.StringIO()) == 1
