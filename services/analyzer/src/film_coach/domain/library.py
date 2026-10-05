"""取り込んだ動画の記録と、元の動画を残すかどうかの方針（ADR-0005）。"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

SourceKind = Literal["upload", "youtube"]
TrackStatus = Literal["none", "running", "done", "failed"]


@dataclass(frozen=True, slots=True)
class VideoInfo:
    name: str
    fps: float
    width: int
    height: int
    frame_count: int

    @property
    def duration(self) -> float:
        return self.frame_count / self.fps if self.fps else 0.0


@dataclass(frozen=True, slots=True)
class YouTubeSource:
    """YouTube から取り込んだときの出典。元の動画は持たず、これと派生データだけを残す"""

    video_id: str
    start: int
    end: int
    title: str = ""
    channel: str = ""
    license: str = ""
    """例：youtube（標準ライセンス）、creativeCommon"""


@dataclass(frozen=True, slots=True)
class VideoRecord:
    id: str
    name: str
    source: SourceKind
    info: VideoInfo
    created_at: str
    """ISO 8601（UTC）"""
    youtube: YouTubeSource | None = None
    media_retained: bool = True
    """元の動画（区間）を手元に残しているか"""
    track_status: TrackStatus = "none"
    label: str = ""
    """対象選手に付けた名前（例：#5）"""
    errors: list[str] = field(default_factory=list)


def retain_media_after_analysis(record: VideoRecord) -> bool:
    """解析のあとも元の動画を残すか。

    自分でアップロードした動画は、画面で再生するために残す。YouTube から取り込んだ区間は、
    規約と著作権への配慮から、解析が終わったら消して派生データと出典だけを残す（ADR-0005）。
    """
    return record.source == "upload"
