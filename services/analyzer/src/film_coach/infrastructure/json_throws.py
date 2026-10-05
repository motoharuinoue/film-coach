"""投球の解析結果の JSON 書き出し（packages/schema/throw-analysis.v1.schema.json）。"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from ..application.throws import ThrowAnalysis
from ..domain.pose import Keypoint, PoseSequence
from .schema import validate

THROWS_SCHEMA = "throw-analysis.v1.schema.json"


def _point(p: Keypoint) -> list[float]:
    return [round(p.x, 4), round(p.y, 4), round(p.c, 3)]


def _sequence(seq: PoseSequence) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "keypointLayout": "coco17",
        "space": "world-2d",
        "fps": seq.fps,
        "heightM": seq.height_m,
        "frames": [{"t": round(f.t, 4), "kp": [_point(p) for p in f.kp]} for f in seq.frames],
    }


def throws_to_json(ta: ThrowAnalysis) -> dict[str, Any]:
    data: dict[str, Any] = {
        "schemaVersion": 1,
        "video": {
            "name": ta.video.name,
            "fps": ta.video.fps,
            "width": ta.video.width,
            "height": ta.video.height,
            "frameCount": ta.video.frame_count,
        },
        "heightM": ta.height_m,
        "camera": ta.camera,
        "hand": ta.hand,
        "reps": [
            {
                "index": r.index,
                "start": r.start,
                "end": r.end,
                "transform": {
                    "mPerPx": r.transform.m_per_px,
                    "originX": round(r.transform.origin_x, 2),
                    "groundY": round(r.transform.ground_y, 2),
                    "direction": r.transform.direction,
                    "ankleM": round(r.transform.ankle_m, 4),
                },
                "events": r.analysis.events.to_json(),
                "phases": [{"key": p.key, "start": p.start, "end": p.end} for p in r.analysis.phases],
                "metrics": {k: round(v, 4) for k, v in r.analysis.metrics.items()},
                "sequence": _sequence(r.analysis.sequence),
            }
            for r in ta.reps
        ],
        "warnings": list(ta.warnings),
    }
    validate(THROWS_SCHEMA, data)
    return data


def write_throws(ta: ThrowAnalysis, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(throws_to_json(ta), ensure_ascii=False), encoding="utf-8")
