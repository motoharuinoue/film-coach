"""コンポジションルート：ポートの実装（infrastructure）を入口（adapters）に差し込む。

層のルールを保つため、adapters と infrastructure の両方を import してよいのはここだけ。
重いライブラリ（OpenCV・onnxruntime）は、使うコマンドのときだけ読み込む。
"""

from __future__ import annotations

import sys
from functools import cache
from pathlib import Path
from typing import TYPE_CHECKING

from .adapters.cli import CliDeps, run
from .application.throws import ThrowAnalysis
from .application.track_target import (
    CameraMotionEstimator,
    FanoutSink,
    FrameSink,
    PersonDetector,
    PoseEstimator,
    ShotBoundaryDetector,
    TargetTrack,
    VideoReader,
)
from .domain.library import VideoInfo
from .infrastructure.json_pose import JsonAnalysisWriter, JsonPoseSequenceReader
from .infrastructure.models import LocalModelStore
from .infrastructure.paths import data_dir

if TYPE_CHECKING:  # FastAPI は serve のときだけ読み込む
    from .adapters.http import HttpDeps


def _open_video(path: Path) -> VideoReader:
    from .infrastructure.video_cv import OpenCvVideoReader

    return OpenCvVideoReader(path)


def _detector() -> PersonDetector:
    from .infrastructure.rtm import RtmPersonDetector

    return RtmPersonDetector()


def _pose() -> PoseEstimator:
    from .infrastructure.rtm import RtmPoseEstimator

    return RtmPoseEstimator()


def _shots() -> ShotBoundaryDetector:
    from .infrastructure.video_cv import OpenCvShotDetector

    return OpenCvShotDetector()


def _motion() -> CameraMotionEstimator:
    from .infrastructure.video_cv import OpenCvCameraMotion

    return OpenCvCameraMotion()


def _preview(dest_dir: Path, info: VideoInfo, label: str) -> FrameSink:
    from .infrastructure.video_cv import FocusVideoWriter, PreviewVideoWriter

    return FanoutSink(
        [
            PreviewVideoWriter(dest_dir / "preview.mp4", info, label),
            FocusVideoWriter(dest_dir / "focus.mp4", info, label),
        ]
    )


def _anonymizer(dest: Path, info: VideoInfo) -> FrameSink:
    from .infrastructure.video_cv import AnonymizedVideoWriter

    return AnonymizedVideoWriter(dest, info)


def _write_track(tt: TargetTrack, dest: Path) -> None:
    from .infrastructure.json_track import write_track

    write_track(tt, dest)


def _read_track(src: Path) -> TargetTrack:
    from .infrastructure.json_track import read_track

    return read_track(src)


def _write_throws(ta: ThrowAnalysis, dest: Path) -> None:
    from .infrastructure.json_throws import write_throws

    write_throws(ta, dest)


def http_deps() -> HttpDeps:
    """HTTP の解析サービスの依存。モデルは最初に使うときに 1 回だけ読み込む"""
    import os

    from .adapters.http import HttpDeps
    from .application.jobs import JobRunner
    from .infrastructure.library_fs import FileDrillStore, FilePracticeStore, FileReferenceStore, FileVideoStore
    from .infrastructure.video_cv import OpenCvFrameGrabber
    from .infrastructure.youtube_api import FileQuotaLedger, YouTubeDataApi
    from .infrastructure.youtube_dlp import YtDlpFetcher

    origins = os.environ.get("FILM_COACH_ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
    return HttpDeps(
        store=FileVideoStore(),
        practices=FilePracticeStore(),
        drills=FileDrillStore(),
        grabber=OpenCvFrameGrabber(),
        fetcher=YtDlpFetcher(),
        jobs=JobRunner(),
        models=LocalModelStore(),
        open_video=_open_video,
        detector=cache(_detector),
        pose=cache(_pose),
        sink_for=_preview,
        allowed_origins=[o.strip() for o in origins.split(",") if o.strip()],
        shots=_shots,
        motion=_motion,
        youtube=YouTubeDataApi(),
        quota=FileQuotaLedger(),
        references=FileReferenceStore(),
    )


def _serve(host: str, port: int) -> None:
    import uvicorn

    from .adapters.http import create_app

    uvicorn.run(create_app(http_deps()), host=host, port=port)


def cli_deps() -> CliDeps:
    return CliDeps(
        reader=JsonPoseSequenceReader(),
        writer=JsonAnalysisWriter(),
        models=LocalModelStore(),
        open_video=_open_video,
        detector=_detector,
        pose=_pose,
        preview=_preview,
        write_track=_write_track,
        output_dir=lambda video: data_dir() / "outputs" / video.stem,
        serve=_serve,
        read_track=_read_track,
        write_throws=_write_throws,
        anonymizer=_anonymizer,
        shots=_shots,
        motion=_motion,
    )


def main() -> None:
    sys.exit(run(sys.argv[1:], cli_deps()))
