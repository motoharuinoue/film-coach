"""ユースケース：大勢が映る映像から、利用者が指した 1 人を追い、その人の骨格を出す。

1 回目の読み込みで全員を検出・追跡し、指した点を含む追跡を選んで、途切れた所をつなぐ。
2 回目の読み込みで、その人の枠だけ骨格を推定する（全員の骨格は出さない）。
フレーム（画像）の中身はポートの実装だけが扱い、この層では中身を見ない。
"""

from __future__ import annotations

from collections.abc import Callable, Iterator
from dataclasses import dataclass
from typing import Protocol

from ..domain.pose import NUM_KEYPOINTS, js_round
from ..domain.tracking import Box, IouTracker, Track, fill_gaps, link_tracks, merge_boxes, pick_track

Frame = object
"""画像。中身はポートの実装（OpenCV など）だけが扱う"""

ImageKeypoint = tuple[float, float, float]
"""画像上の関節の [x, y, 信頼度]"""


@dataclass(frozen=True, slots=True)
class VideoInfo:
    name: str
    fps: float
    width: int
    height: int
    frame_count: int


class VideoReader(Protocol):
    def info(self) -> VideoInfo: ...

    def frames(self) -> Iterator[tuple[int, Frame]]:
        """(フレーム番号, 画像) を先頭から順に返す。呼ぶたびに最初から読む"""
        ...


class PersonDetector(Protocol):
    def detect(self, frame: Frame) -> list[Box]: ...


class PoseEstimator(Protocol):
    def estimate(self, frame: Frame, box: Box) -> list[ImageKeypoint]:
        """枠の中の 1 人の COCO-17 の関節"""
        ...


class FrameSink(Protocol):
    """2 回目の読み込みで、フレームごとの結果を受け取る（プレビュー動画の書き出しなど）"""

    def write(self, frame: Frame, result: TargetFrame) -> None: ...

    def close(self) -> None: ...


class FanoutSink:
    """複数の FrameSink に同じ結果を渡す（プレビューとフォーカス動画を同時に作るなど）"""

    def __init__(self, sinks: list[FrameSink]) -> None:
        self.sinks = sinks

    def write(self, frame: Frame, result: TargetFrame) -> None:
        for s in self.sinks:
            s.write(frame, result)

    def close(self) -> None:
        for s in self.sinks:
            s.close()


@dataclass(frozen=True, slots=True)
class TargetHint:
    """対象選手の指定：t 秒の時点で、画像の (x, y) に映っている人"""

    x: float
    y: float
    t: float


@dataclass(frozen=True, slots=True)
class TargetFrame:
    index: int
    t: float
    box: Box | None
    keypoints: list[ImageKeypoint] | None
    interpolated: bool = False
    """見失った間を、前後の枠から補間したフレームか"""


@dataclass(frozen=True, slots=True)
class TrackSegment:
    track_id: int
    start: int
    end: int


@dataclass(frozen=True, slots=True)
class TargetTrack:
    video: VideoInfo
    hint: TargetHint
    segments: list[TrackSegment]
    """つないだ追跡（つなぎ目がどこにあるかを見せるため）"""
    frames: list[TargetFrame]
    people_tracked: int
    """映像全体で追跡した人数"""

    @property
    def coverage(self) -> float:
        """対象選手の枠があるフレームの割合"""
        return sum(f.box is not None for f in self.frames) / max(1, len(self.frames))


class TargetNotFoundError(LookupError):
    pass


Progress = Callable[[str, int, int], None]
"""(段階, 済んだ数, 全体の数)"""


def _noop(_stage: str, _done: int, _total: int) -> None:
    return None


def track_target(
    video: VideoReader,
    detector: PersonDetector,
    pose: PoseEstimator,
    hint: TargetHint,
    sink: FrameSink | None = None,
    progress: Progress = _noop,
) -> TargetTrack:
    info = video.info()

    # 1 回目：全員を検出して追跡する
    tracker = IouTracker()
    for i, frame in video.frames():
        tracker.update(i, detector.detect(frame))
        progress("detect", i + 1, info.frame_count)

    hint_frame = min(info.frame_count - 1, max(0, js_round(hint.t * info.fps)))
    seed = pick_track(tracker.tracks, hint_frame, hint.x, hint.y)
    if seed is None:
        raise TargetNotFoundError(
            f"{hint.t:.2f} 秒の ({hint.x:.0f}, {hint.y:.0f}) に人が見つかりません。位置か時刻を変えてください"
        )
    chain: list[Track] = link_tracks(tracker.tracks, seed)
    # 人の陰に隠れた短い間は、前後の枠から補間する
    boxes, filled = fill_gaps(merge_boxes(chain))

    # 2 回目：対象選手の骨格だけを推定する
    frames: list[TargetFrame] = []
    for i, frame in video.frames():
        box = boxes.get(i)
        kps = pose.estimate(frame, box) if box else None
        if kps is not None and len(kps) != NUM_KEYPOINTS:
            raise ValueError(f"関節の数が {len(kps)} 個です（{NUM_KEYPOINTS} 個のはず）")
        result = TargetFrame(i, i / info.fps, box, kps, i in filled)
        frames.append(result)
        if sink:
            sink.write(frame, result)
        progress("pose", i + 1, info.frame_count)
    if sink:
        sink.close()

    segments = [TrackSegment(t.id, t.first, t.last) for t in chain]
    return TargetTrack(info, hint, segments, frames, len(tracker.tracks))
