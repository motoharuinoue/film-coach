"""対象選手の追跡結果の JSON 書き出し（packages/schema/target-track.v1.schema.json）。"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from ..application.track_target import TargetTrack
from .schema import validate

TRACK_SCHEMA = "target-track.v1.schema.json"


def _r(v: float, nd: int = 2) -> float:
    return round(v, nd)


def track_to_json(tt: TargetTrack) -> dict[str, Any]:
    data: dict[str, Any] = {
        "schemaVersion": 1,
        "video": {
            "name": tt.video.name,
            "fps": tt.video.fps,
            "width": tt.video.width,
            "height": tt.video.height,
            "frameCount": tt.video.frame_count,
        },
        "hint": {"x": tt.hint.x, "y": tt.hint.y, "t": tt.hint.t},
        "segments": [{"trackId": s.track_id, "start": s.start, "end": s.end} for s in tt.segments],
        "peopleTracked": tt.people_tracked,
        "cuts": list(tt.cuts),
        "frames": [
            {
                "i": f.index,
                "t": _r(f.t, 4),
                "box": None
                if f.box is None
                else [_r(f.box.x1), _r(f.box.y1), _r(f.box.x2), _r(f.box.y2), _r(f.box.score, 3)],
                "kp": None if f.keypoints is None else [[_r(x), _r(y), _r(c, 3)] for x, y, c in f.keypoints],
                "interpolated": f.interpolated,
            }
            for f in tt.frames
        ],
    }
    validate(TRACK_SCHEMA, data)
    return data


def write_track(tt: TargetTrack, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(track_to_json(tt), ensure_ascii=False), encoding="utf-8")
