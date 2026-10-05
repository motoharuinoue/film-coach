"""ユースケース：動画の取り込み（アップロード・YouTube）、本人を指すためのフレーム、追跡の実行。"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import replace
from pathlib import Path
from typing import BinaryIO, Protocol

from ..domain.camera import CameraAngle
from ..domain.library import VideoInfo, VideoRecord, YouTubeSource, retain_media_after_analysis
from ..domain.youtube import check_segment, parse_youtube_id
from .throws import ThrowAnalysis, analyze_throws
from .track_target import (
    FrameSink,
    PersonDetector,
    PoseEstimator,
    Progress,
    ShotBoundaryDetector,
    TargetHint,
    TargetTrack,
    VideoReader,
    track_target,
)


class VideoStore(Protocol):
    """取り込んだ動画と、その解析結果の置き場所"""

    def new_id(self) -> str: ...

    def media_path(self, video_id: str, suffix: str = ".mp4") -> Path: ...

    def save_upload(self, video_id: str, filename: str, stream: BinaryIO) -> Path: ...

    def save(self, record: VideoRecord) -> None: ...

    def get(self, video_id: str) -> VideoRecord | None: ...

    def list(self) -> list[VideoRecord]: ...

    def media(self, video_id: str) -> Path | None:
        """元の動画（残していなければ None）"""
        ...

    def delete_media(self, video_id: str) -> None: ...

    def output_dir(self, video_id: str) -> Path:
        """追跡結果・プレビュー動画の置き場所"""
        ...

    def save_track(self, video_id: str, track: TargetTrack) -> None:
        """追跡結果を保存する。前の投球の解析は、追跡が変わると合わなくなるので消す"""
        ...

    def track_path(self, video_id: str) -> Path | None: ...

    def load_track(self, video_id: str) -> TargetTrack | None: ...

    def save_throws(self, video_id: str, throws: ThrowAnalysis) -> None: ...

    def throws_path(self, video_id: str) -> Path | None: ...

    def output_file(self, video_id: str, name: str) -> Path | None:
        """preview.mp4 / focus.mp4（なければ None）"""
        ...


class FrameGrabber(Protocol):
    def probe(self, path: Path) -> VideoInfo: ...

    def jpeg_at(self, path: Path, t: float, max_width: int = 1280) -> bytes:
        """t 秒のフレームを JPEG にする"""
        ...


class YouTubeFetcher(Protocol):
    def metadata(self, video_id: str) -> YouTubeSource:
        """題名・チャンネル・ライセンスを取得する（区間は呼び出し側で入れる）"""
        ...

    def fetch_segment(self, video_id: str, start: int, end: int, dest: Path) -> Path:
        """指定した区間だけを取得する"""
        ...


class NotFoundError(LookupError):
    pass


class ImportRejected(ValueError):
    """取り込めない入力（URL・区間・動画の形式）"""


ALLOWED_SUFFIXES = {".mp4", ".mov", ".m4v"}


def _now() -> str:
    from datetime import UTC, datetime

    return datetime.now(UTC).isoformat(timespec="seconds")


def import_upload(store: VideoStore, grabber: FrameGrabber, filename: str, stream: BinaryIO) -> VideoRecord:
    suffix = Path(filename).suffix.lower()
    if suffix not in ALLOWED_SUFFIXES:
        raise ImportRejected(f"{suffix or '拡張子なし'} は取り込めません（mp4 / mov / m4v）")
    vid = store.new_id()
    path = store.save_upload(vid, filename, stream)
    try:
        info = grabber.probe(path)
    except Exception as e:
        store.delete_media(vid)
        raise ImportRejected(f"動画として読めませんでした：{e}") from e
    record = VideoRecord(vid, Path(filename).name, "upload", replace(info, name=Path(filename).name), _now())
    store.save(record)
    return record


def import_youtube(
    store: VideoStore, grabber: FrameGrabber, fetcher: YouTubeFetcher, url: str, start: int, end: int
) -> VideoRecord:
    yt_id = parse_youtube_id(url)
    if yt_id is None:
        raise ImportRejected("YouTube の動画 URL ではありません")
    seg = check_segment(start, end)
    meta = fetcher.metadata(yt_id)
    vid = store.new_id()
    path = fetcher.fetch_segment(yt_id, seg.start, seg.end, store.media_path(vid))
    info = grabber.probe(path)
    source = replace(meta, video_id=yt_id, start=seg.start, end=seg.end)
    name = meta.title or yt_id
    record = VideoRecord(vid, name, "youtube", replace(info, name=name), _now(), youtube=source)
    store.save(record)
    return record


def frame_jpeg(store: VideoStore, grabber: FrameGrabber, video_id: str, t: float) -> bytes:
    path = store.media(video_id)
    if path is None:
        raise NotFoundError("元の動画が残っていません（YouTube から取り込んだ区間は、解析のあとに消しています）")
    return grabber.jpeg_at(path, t)


def get_record(store: VideoStore, video_id: str) -> VideoRecord:
    record = store.get(video_id)
    if record is None:
        raise NotFoundError(f"動画 {video_id} はありません")
    return record


def run_tracking(
    store: VideoStore,
    open_video: Callable[[Path], VideoReader],
    detector: PersonDetector,
    pose: PoseEstimator,
    sink_for: Callable[[Path, VideoInfo, str], FrameSink] | None,
    video_id: str,
    hint: TargetHint,
    label: str,
    progress: Progress,
    shots: ShotBoundaryDetector | None = None,
) -> TargetTrack:
    record = get_record(store, video_id)
    path = store.media(video_id)
    if path is None:
        raise NotFoundError("元の動画が残っていないので、追跡をやり直せません。もう一度取り込んでください")
    store.save(replace(record, track_status="running", label=label, errors=[]))
    retained = retain_media_after_analysis(record)
    try:
        video = open_video(path)
        # 確認用の動画（プレビュー・フォーカス）は元の動画の複製になるので、元の動画を残す映像でだけ作る
        sink = sink_for(store.output_dir(video_id), video.info(), label) if sink_for and retained else None
        track = track_target(video, detector, pose, hint, sink, progress, shots)
    except Exception as e:
        store.save(replace(record, track_status="failed", label=label, errors=[str(e)]))
        raise
    store.save_track(video_id, track)
    if not retained:
        store.delete_media(video_id)
    store.save(replace(record, track_status="done", label=label, media_retained=retained, errors=[]))
    return track


def analyze_footage_throws(
    store: VideoStore, video_id: str, height_m: float, camera: CameraAngle = "side"
) -> ThrowAnalysis:
    """追跡の済んだ映像から投球を見つけて解析し、保存する。骨格だけを使うので、元の動画が消えていても動く"""
    get_record(store, video_id)
    track = store.load_track(video_id)
    if track is None:
        raise NotFoundError("まだ本人を追跡していません。先に本人を選んで追跡してください")
    throws = analyze_throws(track, height_m, camera)
    store.save_throws(video_id, throws)
    return throws
