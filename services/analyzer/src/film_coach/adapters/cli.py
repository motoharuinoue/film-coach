"""CLI の入口。依存（ポートの実装）は bootstrap.py から受け取る。"""

from __future__ import annotations

import argparse
import sys
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import TextIO

from ..application.analyze_pose import RepAnalysis, analyze_pose
from ..application.ports import AnalysisWriter, ModelStore, PoseSequenceReader
from ..application.track_target import (
    FrameSink,
    PersonDetector,
    PoseEstimator,
    TargetHint,
    TargetNotFoundError,
    TargetTrack,
    VideoReader,
    track_target,
)
from ..domain.camera import CAMERA_ANGLES, CameraAngle
from ..domain.library import VideoInfo
from ..domain.metrics import METRICS
from ..domain.phases import PHASE_LABEL


@dataclass(frozen=True, slots=True)
class CliDeps:
    reader: PoseSequenceReader
    writer: AnalysisWriter
    models: ModelStore
    open_video: Callable[[Path], VideoReader]
    detector: Callable[[], PersonDetector]
    pose: Callable[[], PoseEstimator]
    preview: Callable[[Path, VideoInfo, str], FrameSink]
    """書き出し先のフォルダに、確認用の動画（全体のプレビューと、対象選手を追うフォーカス動画）を作る"""
    write_track: Callable[[TargetTrack, Path], None]
    output_dir: Callable[[Path], Path]
    """動画ごとの既定の書き出し先"""
    serve: Callable[[str, int], None]
    """HTTP の解析サービスを起動する"""


def _point(text: str) -> tuple[float, float]:
    try:
        x, y = (float(v) for v in text.split(","))
    except ValueError as e:
        raise argparse.ArgumentTypeError("x,y の形で指定してください（例：1440,430）") from e
    return x, y


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="film-coach", description="Film Coach の解析サービス")
    sub = p.add_subparsers(dest="command", required=True)

    a = sub.add_parser("analyze-pose", help="骨格の時系列（JSON）からフェーズと QB 指標を出す")
    a.add_argument("pose", type=Path, help="pose-sequence.v1.schema.json に沿った JSON")
    a.add_argument("--camera", choices=CAMERA_ANGLES, default="side", help="撮影の角度（測れる指標が変わる）")
    a.add_argument("--out", type=Path, help="解析結果の JSON の書き出し先")

    m = sub.add_parser("models", help="骨格推定のモデル")
    m.add_argument("action", choices=["list", "download"], help="list：置いてあるか確かめる / download：取得する")

    t = sub.add_parser("track", help="大勢が映る映像から 1 人を追い、その人の骨格を出す")
    t.add_argument("video", type=Path, help="動画ファイル")
    t.add_argument("--at", type=float, required=True, help="対象選手を指す時刻（秒）")
    t.add_argument(
        "--point", type=_point, required=True, help="その時刻に対象選手が映っている画像上の位置 x,y（ピクセル）"
    )
    t.add_argument("--label", default="TARGET", help="プレビューで枠に付ける名前（例：#5）")
    t.add_argument("--out", type=Path, help="書き出し先のフォルダ（既定は data/outputs/<動画名>）")
    t.add_argument("--no-preview", action="store_true", help="確認用の動画（preview.mp4・focus.mp4）を作らない")

    s = sub.add_parser("serve", help="画面から使う HTTP の解析サービスを起動する（127.0.0.1 だけで待ち受ける）")
    s.add_argument("--port", type=int, default=8787)
    return p


def print_analysis(a: RepAnalysis, out: TextIO) -> None:
    fps = a.sequence.fps
    out.write(f"フレーム数 {len(a.sequence.frames)}（{fps:g} fps）\n\nフェーズ\n")
    for ph in a.phases:
        out.write(f"  {PHASE_LABEL[ph.key]:<6} {ph.start:>4} 〜 {ph.end:>4}（{ph.start / fps:.2f}s〜）\n")
    out.write(f"  リリース {a.events.release}（{a.events.release / fps:.2f}s）\n\n指標\n")
    for m in METRICS:
        v = a.metrics.get(m.key)
        text = "判定不可（この角度では測れない）" if v is None else f"{v:.{m.digits}f} {m.unit}".rstrip()
        out.write(f"  {m.label:<16} {text}\n")


def _progress(out: TextIO) -> Callable[[str, int, int], None]:
    names = {"detect": "全員の検出と追跡", "pose": "対象選手の骨格推定"}
    shown: dict[str, int] = {}

    def report(stage: str, done: int, total: int) -> None:
        pct = done * 100 // max(1, total)
        if pct >= shown.get(stage, -10) + 10 or done == total:
            shown[stage] = pct
            out.write(f"  {names.get(stage, stage)} {pct:3d}%（{done}/{total}）\n")
            out.flush()

    return report


def print_track(tt: TargetTrack, out: TextIO) -> None:
    fps = tt.video.fps
    found = [f for f in tt.frames if f.box is not None]
    filled = sum(f.interpolated for f in tt.frames)
    out.write(f"\n追跡した人数 {tt.people_tracked}\n")
    out.write(f"対象選手の枠があるフレーム {len(found)}/{len(tt.frames)}（{tt.coverage:.0%}）、うち補間 {filled}\n")
    out.write(f"つないだ追跡 {len(tt.segments)} 本\n")
    for s in tt.segments:
        out.write(f"  #{s.track_id:<4} {s.start / fps:6.2f}s 〜 {s.end / fps:6.2f}s\n")


def run(argv: list[str], deps: CliDeps, out: TextIO = sys.stdout) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "analyze-pose":
        camera: CameraAngle = args.camera
        analysis = analyze_pose(deps.reader.read(args.pose), camera)
        print_analysis(analysis, out)
        if args.out:
            deps.writer.write(analysis, args.out)
            out.write(f"\n書き出しました：{args.out}\n")
        return 0

    if args.command == "serve":
        out.write(f"解析サービスを起動します：http://127.0.0.1:{args.port}/api/health\n")
        deps.serve("127.0.0.1", args.port)
        return 0

    if args.command == "models":
        if args.action == "download":
            deps.models.download(lambda s: print(s, file=out))
        for role, mb, present, path in deps.models.status():
            out.write(f"  {'あり' if present else 'なし'}  {role}（{mb:.0f} MB）  {path}\n")
        return 0

    # track
    video = deps.open_video(args.video)
    info = video.info()
    dest: Path = args.out or deps.output_dir(args.video)
    x, y = args.point
    out.write(f"{info.name}：{info.width}×{info.height}、{info.fps:g} fps、{info.frame_count} フレーム\n")
    out.write(f"{args.at:.2f} 秒の ({x:.0f}, {y:.0f}) にいる人を追います\n")
    sink = None if args.no_preview else deps.preview(dest, info, args.label)
    try:
        tt = track_target(video, deps.detector(), deps.pose(), TargetHint(x, y, args.at), sink, _progress(out))
    except TargetNotFoundError as e:
        out.write(f"\n{e}\n")
        return 1
    print_track(tt, out)
    deps.write_track(tt, dest / "track.json")
    out.write(f"\n書き出しました：{dest / 'track.json'}\n")
    if sink:
        out.write(f"プレビュー：{dest / 'preview.mp4'}\nフォーカス：{dest / 'focus.mp4'}\n")
    return 0
