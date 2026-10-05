"""対象選手の追跡結果の JSON 入出力（packages/schema/target-track.v1.schema.json）。"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from ..application.track_target import TargetFrame, TargetHint, TargetTrack, TrackSegment
from ..domain.library import VideoInfo
from ..domain.motion import Affine
from ..domain.tracking import Box
from .schema import validate

TRACK_SCHEMA = "target-track.v1.schema.json"


def _r(v: float, nd: int = 2) -> float:
    return round(v, nd)


def _affine(m: Affine) -> list[float]:
    return [round(m.a, 6), round(m.b, 6), round(m.tx, 2), round(m.c, 6), round(m.d, 6), round(m.ty, 2)]


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
        "camera": None if tt.camera is None else [_affine(m) for m in tt.camera],
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


def track_from_json(data: dict[str, Any]) -> TargetTrack:
    # 以前に書き出した結果には cuts（場面の切り替わり）と camera（カメラの動き）がないので、なしとみなす
    data = {**data, "cuts": data.get("cuts", []), "camera": data.get("camera")}
    validate(TRACK_SCHEMA, data)
    v, h = data["video"], data["hint"]
    frames = [
        TargetFrame(
            int(f["i"]),
            float(f["t"]),
            None if f["box"] is None else Box(*(float(n) for n in f["box"])),
            None if f["kp"] is None else [(float(x), float(y), float(c)) for x, y, c in f["kp"]],
            bool(f["interpolated"]),
        )
        for f in data["frames"]
    ]
    return TargetTrack(
        VideoInfo(v["name"], float(v["fps"]), int(v["width"]), int(v["height"]), int(v["frameCount"])),
        TargetHint(float(h["x"]), float(h["y"]), float(h["t"])),
        [TrackSegment(int(s["trackId"]), int(s["start"]), int(s["end"])) for s in data["segments"]],
        frames,
        int(data["peopleTracked"]),
        [int(c) for c in data["cuts"]],
        None if data["camera"] is None else [Affine(*(float(v) for v in m)) for m in data["camera"]],
    )


def read_track(source: Path) -> TargetTrack:
    return track_from_json(json.loads(source.read_text(encoding="utf-8")))
