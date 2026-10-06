"""ユースケース：改善点に添えるドリル動画を登録する、一覧する、消す。

動画は取り込まない（YouTube の動画 ID と開始位置、タイトル・チャンネルだけを残す）。
タイトルとチャンネルは、画面が検索の結果から渡す（YouTube Data API の無料枠を使わない）。
"""

from __future__ import annotations

from typing import Protocol

from ..domain.drill import Drill, DrillTarget, check_drill
from . import library
from .library import NotFoundError


class DrillStore(Protocol):
    """ドリル動画の置き場所"""

    def new_id(self) -> str: ...

    def save(self, drill: Drill) -> None: ...

    def list(self) -> list[Drill]: ...

    def delete(self, drill_id: str) -> bool:
        """消したら True、なければ False"""
        ...


def create_drill(
    drills: DrillStore,
    youtube_id: str,
    title: str,
    channel: str,
    start_sec: int,
    label: str,
    targets: list[DrillTarget],
) -> Drill:
    clean = check_drill(youtube_id, label, start_sec, targets)
    drill = Drill(drills.new_id(), youtube_id, title, channel, start_sec, clean, tuple(targets), library._now())
    drills.save(drill)
    return drill


def list_drills(drills: DrillStore) -> list[Drill]:
    """新しいものから順に"""
    return sorted(drills.list(), key=lambda d: d.created_at, reverse=True)


def delete_drill(drills: DrillStore, drill_id: str) -> None:
    if not drills.delete(drill_id):
        raise NotFoundError(f"ドリル動画 {drill_id} はありません")
