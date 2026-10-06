"""VideoStore と PracticeStore のファイル実装。data/library/<id>/ に、記録・元の動画・解析結果を置く。
練習（映像のまとめ）は data/practices/<id>.json、お手本の登録は data/references/<id>.json に置く。

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
from ..domain.drill import Drill
from ..domain.library import VideoRecord
from ..domain.practice import Practice
from ..domain.reference import Reference
from .json_throws import read_throws, write_throws
from .json_track import read_track, write_track
from .paths import data_dir
from .schema import validate

RECORD_SCHEMA = "video-record.v1.schema.json"
PRACTICE_SCHEMA = "practice.v1.schema.json"
REFERENCE_SCHEMA = "reference.v1.schema.json"
DRILL_SCHEMA = "drill.v1.schema.json"
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

    def load_throws(self, video_id: str) -> ThrowAnalysis | None:
        p = self.throws_path(video_id)
        return read_throws(p) if p else None

    def throws_path(self, video_id: str) -> Path | None:
        p = self._dir(video_id) / "outputs" / "throws.json"
        return p if p.exists() else None

    def output_file(self, video_id: str, name: str) -> Path | None:
        if name not in ("preview.mp4", "focus.mp4"):
            return None
        p = self._dir(video_id) / "outputs" / name
        return p if p.exists() else None


class _JsonDir:
    """ID ごとに 1 つの JSON を置くディレクトリ。保存の前と読み込みのあとにスキーマで確かめる"""

    def __init__(self, root: Path, schema: str) -> None:
        self.root = root
        self.schema = schema

    def path(self, item_id: str) -> Path | None:
        # ID は自分で作った 12 桁の 16 進数だけを受け付ける（パスに使うため）
        return self.root / f"{item_id}.json" if _ID.match(item_id) else None

    def write(self, item_id: str, data: dict[str, Any]) -> None:
        path = self.path(item_id)
        if path is None:
            raise ValueError(f"不正な ID です：{item_id!r}")
        validate(self.schema, data)
        self.root.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(path)

    def read(self, item_id: str) -> dict[str, Any] | None:
        path = self.path(item_id)
        if path is None or not path.exists():
            return None
        data: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
        validate(self.schema, data)
        return data

    def ids(self) -> list[str]:
        return [p.stem for p in sorted(self.root.glob("*.json"))] if self.root.exists() else []

    def delete(self, item_id: str) -> bool:
        path = self.path(item_id)
        if path is None or not path.exists():
            return False
        path.unlink()
        return True


class FilePracticeStore:
    def __init__(self, root: Path | None = None) -> None:
        self._dir = _JsonDir(root or data_dir() / "practices", PRACTICE_SCHEMA)
        self.root = self._dir.root

    def new_id(self) -> str:
        return uuid.uuid4().hex[:12]

    def save(self, practice: Practice) -> None:
        self._dir.write(practice.id, dto.practice_to_json(practice))

    def get(self, practice_id: str) -> Practice | None:
        data = self._dir.read(practice_id)
        return dto.practice_from_json(data) if data else None

    def list(self) -> list[Practice]:
        return [p for i in self._dir.ids() if (p := self.get(i))]

    def delete(self, practice_id: str) -> bool:
        return self._dir.delete(practice_id)


class FileDrillStore:
    """ドリル動画の登録を data/drills/<id>.json に置く"""

    def __init__(self, root: Path | None = None) -> None:
        self._dir = _JsonDir(root or data_dir() / "drills", DRILL_SCHEMA)
        self.root = self._dir.root

    def new_id(self) -> str:
        return uuid.uuid4().hex[:12]

    def save(self, drill: Drill) -> None:
        self._dir.write(drill.id, dto.drill_to_json(drill))

    def list(self) -> list[Drill]:
        return [dto.drill_from_json(d) for i in self._dir.ids() if (d := self._dir.read(i))]

    def delete(self, drill_id: str) -> bool:
        return self._dir.delete(drill_id)


class FileReferenceStore:
    """お手本の登録を data/references/<id>.json に置く"""

    def __init__(self, root: Path | None = None) -> None:
        self._dir = _JsonDir(root or data_dir() / "references", REFERENCE_SCHEMA)

    def new_id(self) -> str:
        return uuid.uuid4().hex[:12]

    def save(self, reference: Reference) -> None:
        self._dir.write(reference.id, dto.reference_to_json(reference))

    def get(self, reference_id: str) -> Reference | None:
        data = self._dir.read(reference_id)
        return dto.reference_from_json(data) if data else None

    def list(self) -> list[Reference]:
        return [r for i in self._dir.ids() if (r := self.get(i))]

    def delete(self, reference_id: str) -> bool:
        return self._dir.delete(reference_id)
