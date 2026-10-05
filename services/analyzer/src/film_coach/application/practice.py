"""ユースケース：映像を練習にまとめる、練習を一覧・取得・削除する。

練習の削除は、まとめ（映像の ID の組）を消すだけで、映像と解析結果は残す。
"""

from __future__ import annotations

from typing import Protocol

from ..domain.camera import CameraAngle
from ..domain.practice import Practice, PracticeKind, check_practice
from . import library
from .library import NotFoundError, VideoStore


class PracticeStore(Protocol):
    """練習の置き場所"""

    def new_id(self) -> str: ...

    def save(self, practice: Practice) -> None: ...

    def get(self, practice_id: str) -> Practice | None: ...

    def list(self) -> list[Practice]: ...

    def delete(self, practice_id: str) -> bool:
        """消したら True、なければ False"""
        ...


def create_practice(
    practices: PracticeStore,
    videos: VideoStore,
    name: str,
    day: str,
    kind: PracticeKind,
    camera: CameraAngle,
    memo: str,
    video_ids: list[str],
) -> Practice:
    clean = check_practice(name, day, memo, video_ids)
    missing = [v for v in video_ids if videos.get(v) is None]
    if missing:
        raise NotFoundError(f"映像 {', '.join(missing)} はありません")
    practice = Practice(practices.new_id(), clean, day, kind, camera, memo, tuple(video_ids), library._now())
    practices.save(practice)
    return practice


def list_practices(practices: PracticeStore) -> list[Practice]:
    """新しい練習から順に（同じ日なら、あとで作ったものから）"""
    return sorted(practices.list(), key=lambda p: (p.date, p.created_at), reverse=True)


def get_practice(practices: PracticeStore, practice_id: str) -> Practice:
    p = practices.get(practice_id)
    if p is None:
        raise NotFoundError(f"練習 {practice_id} はありません")
    return p


def delete_practice(practices: PracticeStore, practice_id: str) -> None:
    if not practices.delete(practice_id):
        raise NotFoundError(f"練習 {practice_id} はありません")
