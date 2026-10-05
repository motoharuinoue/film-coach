"""コンポジションルート：ポートの実装（infrastructure）を入口（adapters）に差し込む。

層のルールを保つため、adapters と infrastructure の両方を import してよいのはここだけ。
重いライブラリ（OpenCV・onnxruntime）は、使うコマンドのときだけ読み込む。
"""

from __future__ import annotations

import sys
from pathlib import Path

from .adapters.cli import CliDeps, run
from .application.track_target import (
    FanoutSink,
    FrameSink,
    PersonDetector,
    PoseEstimator,
    TargetTrack,
    VideoInfo,
    VideoReader,
)
from .infrastructure.json_pose import JsonAnalysisWriter, JsonPoseSequenceReader
from .infrastructure.models import LocalModelStore
from .infrastructure.paths import data_dir


def _open_video(path: Path) -> VideoReader:
    from .infrastructure.video_cv import OpenCvVideoReader

    return OpenCvVideoReader(path)


def _detector() -> PersonDetector:
    from .infrastructure.rtm import RtmPersonDetector

    return RtmPersonDetector()


def _pose() -> PoseEstimator:
    from .infrastructure.rtm import RtmPoseEstimator

    return RtmPoseEstimator()


def _preview(dest_dir: Path, info: VideoInfo, label: str) -> FrameSink:
    from .infrastructure.video_cv import FocusVideoWriter, PreviewVideoWriter

    return FanoutSink(
        [
            PreviewVideoWriter(dest_dir / "preview.mp4", info, label),
            FocusVideoWriter(dest_dir / "focus.mp4", info, label),
        ]
    )


def _write_track(tt: TargetTrack, dest: Path) -> None:
    from .infrastructure.json_track import write_track

    write_track(tt, dest)


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
    )


def main() -> None:
    sys.exit(run(sys.argv[1:], cli_deps()))
