"""CLI の入口。依存（ポートの実装）は bootstrap.py から受け取る。"""

from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import TextIO

from ..application.analyze_pose import RepAnalysis, analyze_pose
from ..application.ports import AnalysisWriter, PoseSequenceReader
from ..domain.camera import CAMERA_ANGLES, CameraAngle
from ..domain.metrics import METRICS
from ..domain.phases import PHASE_LABEL


@dataclass(frozen=True, slots=True)
class CliDeps:
    reader: PoseSequenceReader
    writer: AnalysisWriter


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="film-coach", description="Film Coach の解析サービス")
    sub = p.add_subparsers(dest="command", required=True)
    a = sub.add_parser("analyze-pose", help="骨格の時系列（JSON）からフェーズと QB 指標を出す")
    a.add_argument("pose", type=Path, help="pose-sequence.v1.schema.json に沿った JSON")
    a.add_argument("--camera", choices=CAMERA_ANGLES, default="side", help="撮影の角度（測れる指標が変わる）")
    a.add_argument("--out", type=Path, help="解析結果の JSON の書き出し先")
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
