"""骨格の時系列と解析結果の JSON 入出力（PoseSequenceReader / AnalysisWriter の実装）。"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from ..application.analyze_pose import RepAnalysis
from ..domain.pose import Keypoint, PoseFrame, PoseSequence
from .schema import validate

POSE_SCHEMA = "pose-sequence.v1.schema.json"


def sequence_from_json(data: dict[str, Any]) -> PoseSequence:
    validate(POSE_SCHEMA, data)
    frames = tuple(
        PoseFrame(float(f["t"]), tuple(Keypoint(float(x), float(y), float(c)) for x, y, c in f["kp"]))
        for f in data["frames"]
    )
    return PoseSequence(float(data["fps"]), float(data["heightM"]), frames)


def sequence_to_json(seq: PoseSequence) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "keypointLayout": "coco17",
        "space": "world-2d",
        "fps": seq.fps,
        "heightM": seq.height_m,
        "frames": [{"t": f.t, "kp": [[p.x, p.y, p.c] for p in f.kp]} for f in seq.frames],
    }


def analysis_to_json(a: RepAnalysis) -> dict[str, Any]:
    return {
        "camera": a.camera,
        "events": a.events.to_json(),
        "phases": [{"key": p.key, "start": p.start, "end": p.end} for p in a.phases],
        "metrics": a.metrics,
        "sequence": sequence_to_json(a.sequence),
    }


class JsonPoseSequenceReader:
    def read(self, source: Path) -> PoseSequence:
        return sequence_from_json(json.loads(source.read_text(encoding="utf-8")))


class JsonAnalysisWriter:
    def write(self, analysis: RepAnalysis, dest: Path) -> None:
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(json.dumps(analysis_to_json(analysis), ensure_ascii=False), encoding="utf-8")
