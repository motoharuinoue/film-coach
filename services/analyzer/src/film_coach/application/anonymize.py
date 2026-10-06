"""ユースケース：公開用に、本人以外と顔をぼかした動画を書き出す。

追跡結果（本人の枠と関節、画像の座標）を使い、フレームごとに書き出し先（FrameSink）へ渡す。
ぼかし方は書き出し先の実装（infrastructure/video_cv.py の AnonymizedVideoWriter）が決める。
README のデモのように、映像を外に出すときだけ使う。元の動画は変えない。
"""

from __future__ import annotations

from dataclasses import replace

from ..domain.world import REPAIR_CONF, repair_low_confidence
from .track_target import FrameSink, ImageKeypoint, TargetFrame, TargetTrack, VideoReader


class TrackMismatchError(ValueError):
    """追跡結果が、その動画のものではない"""


def repaired_frames(frames: list[TargetFrame], fps: float) -> list[TargetFrame]:
    """腕を速く振ったときなどの信頼度の低い関節を、前後のフレームから補う（解析と同じ補い方）。

    補った関節は、残す体の形に入るよう、信頼度を補えた値（REPAIR_CONF）まで上げる。骨格が途切れた所はまたがない
    """
    out = list(frames)
    run: list[int] = []

    def flush() -> None:
        poses = [out[i].keypoints or [] for i in run]
        for i, before, after in zip(run, poses, repair_low_confidence(poses, fps), strict=True):
            kp: list[ImageKeypoint] = [
                (x, y, c if (x, y) == (bx, by) else max(c, REPAIR_CONF))
                for (bx, by, _), (x, y, c) in zip(before, after, strict=True)
            ]
            out[i] = replace(out[i], keypoints=kp)
        run.clear()

    for i, f in enumerate(out):
        if f.keypoints is None or (run and f.index != out[run[-1]].index + 1):
            flush()
        if f.keypoints is not None:
            run.append(i)
    flush()
    return out


def anonymize_video(video: VideoReader, track: TargetTrack, sink: FrameSink) -> int:
    """書き出したフレームの数を返す。追跡結果にないフレーム（本人を見失った所）は、全体をぼかす"""
    info = video.info()
    if (info.width, info.height) != (track.video.width, track.video.height):
        raise TrackMismatchError(
            f"追跡結果の映像の大きさ（{track.video.width}×{track.video.height}）が、動画（{info.width}×{info.height}）と違います"
        )
    by_index = {f.index: f for f in repaired_frames(list(track.frames), info.fps)}
    count = 0
    try:
        for i, frame in video.frames():
            result = by_index.get(i) or TargetFrame(i, i / info.fps, None, None)
            sink.write(frame, result)
            count += 1
    finally:
        sink.close()
    return count
