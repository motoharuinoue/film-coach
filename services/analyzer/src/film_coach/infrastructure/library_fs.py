"""VideoStore と PracticeStore のファイル実装。data/library/<id>/ に、記録・元の動画・解析結果を置く。
練習（映像のまとめ）は data/practices/<id>.json に置く。

data/library/<id>/
  record.json        記録（video-record.v1.schema.json）
  source.<拡張子>    元の動画（YouTube の区間は解析のあとに消す）
  outputs/
    track.json       追跡結果（target-track.v1.schema.json）
    preview.mp4      映像全体のプレビュー
    focus.mp4        対象選手を追うフォーカス動画
"""

from __future__ import annotations

import json
import re
import shutil
import uuid
from pathlib import Path
from typing import Any, BinaryIO

from ..application import dto
from ..application.throws import ThrowAnalysis
from ..application.track_target import TargetTrack
from ..domain.library import VideoRecord
from ..domain.practice import Practice
from .json_throws import write_throws
from .json_track import read_track, write_track
from .paths import data_dir
from .schema import validate

RECORD_SCHEMA = "video-record.v1.schema.json"
PRACTICE_SCHEMA = "practice.v1.schema.json"
_ID = re.compile(r"^[0-9a-f]{12}$")


def record_to_json(r: VideoRecord) -> dict[str, Any]:
    data = dto.record_to_json(r)
    validate(RECORD_SCHEMA, data)
    return data


def record_from_json(d: dict[str, Any]) -> VideoRecord:
    validate(RECORD_SCHEMA, d)
    return dto.record_from_json(d)


class FileVideoStore:
    def __init__(self, root: Path | None = None) -> None:
        self.root = root or data_dir() / "library"

    def _dir(self, video_id: str) -> Path:
        # ID は自分で作った 12 桁の 16 進数だけを受け付ける（パスに使うため）
        if not _ID.match(video_id):
            raise ValueError(f"不正な ID です：{video_id!r}")
        return self.root / video_id

    def new_id(self) -> str:
        return uuid.uuid4().hex[:12]

    def media_path(self, video_id: str, suffix: str = ".mp4") -> Path:
        d = self._dir(video_id)
        d.mkdir(parents=True, exist_ok=True)
        return d / f"source{suffix}"

    def save_upload(self, video_id: str, filename: str, stream: BinaryIO) -> Path:
        dest = self.media_path(video_id, Path(filename).suffix.lower())
        with dest.open("wb") as f:
            shutil.copyfileobj(stream, f, length=1 << 20)
        return dest

    def save(self, record: VideoRecord) -> None:
        d = self._dir(record.id)
        d.mkdir(parents=True, exist_ok=True)
        tmp = d / "record.json.tmp"
        tmp.write_text(json.dumps(record_to_json(record), ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(d / "record.json")

    def get(self, video_id: str) -> VideoRecord | None:
        try:
            path = self._dir(video_id) / "record.json"
        except ValueError:
            return None
        if not path.exists():
            return None
        return record_from_json(json.loads(path.read_text(encoding="utf-8")))

    def list(self) -> list[VideoRecord]:
        if not self.root.exists():
            return []
        records = [self.get(p.name) for p in self.root.iterdir() if p.is_dir() and _ID.match(p.name)]
        return sorted((r for r in records if r), key=lambda r: r.created_at, reverse=True)

    def media(self, video_id: str) -> Path | None:
        d = self._dir(video_id)
        return next((p for p in sorted(d.glob("source.*")) if p.suffix != ".part"), None) if d.exists() else None

    def delete_media(self, video_id: str) -> None:
        d = self._dir(video_id)
        for p in d.glob("source.*"):
            p.unlink(missing_ok=True)

    def output_dir(self, video_id: str) -> Path:
        d = self._dir(video_id) / "outputs"
        d.mkdir(parents=True, exist_ok=True)
        return d

    def save_track(self, video_id: str, track: TargetTrack) -> None:
        write_track(track, self.output_dir(video_id) / "track.json")
        (self.output_dir(video_id) / "throws.json").unlink(missing_ok=True)

    def track_path(self, video_id: str) -> Path | None:
        p = self._dir(video_id) / "outputs" / "track.json"
        return p if p.exists() else None

    def load_track(self, video_id: str) -> TargetTrack | None:
        p = self.track_path(video_id)
        return read_track(p) if p else None

    def save_throws(self, video_id: str, throws: ThrowAnalysis) -> None:
        write_throws(throws, self.output_dir(video_id) / "throws.json")

    def throws_path(self, video_id: str) -> Path | None:
        p = self._dir(video_id) / "outputs" / "throws.json"
        return p if p.exists() else None

    def output_file(self, video_id: str, name: str) -> Path | None:
        if name not in ("preview.mp4", "focus.mp4"):
            return None
        p = self._dir(video_id) / "outputs" / name
        return p if p.exists() else None


class FilePracticeStore:
    def __init__(self, root: Path | None = None) -> None:
        self.root = root or data_dir() / "practices"

    def _path(self, practice_id: str) -> Path | None:
        # ID は自分で作った 12 桁の 16 進数だけを受け付ける（パスに使うため）
        return self.root / f"{practice_id}.json" if _ID.match(practice_id) else None

    def new_id(self) -> str:
        return uuid.uuid4().hex[:12]

    def save(self, practice: Practice) -> None:
        path = self._path(practice.id)
        if path is None:
            raise ValueError(f"不正な ID です：{practice.id!r}")
        data = dto.practice_to_json(practice)
        validate(PRACTICE_SCHEMA, data)
        self.root.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(path)

    def get(self, practice_id: str) -> Practice | None:
        path = self._path(practice_id)
        if path is None or not path.exists():
            return None
        data = json.loads(path.read_text(encoding="utf-8"))
        validate(PRACTICE_SCHEMA, data)
        return dto.practice_from_json(data)

    def list(self) -> list[Practice]:
        if not self.root.exists():
            return []
        found = [self.get(p.stem) for p in sorted(self.root.glob("*.json"))]
        return [p for p in found if p]

    def delete(self, practice_id: str) -> bool:
        path = self._path(practice_id)
        if path is None or not path.exists():
            return False
        path.unlink()
        return True
