"""お手本：YouTube から取り込み、お手本の選手を追跡して投球を解析した映像を、判定の基準として登録したもの。

重み（P × C × Q × K × M、ADR-0006）の計算は画面（apps/web/src/domain/weighting.ts）で行う。
ここでは、その材料（YouTube の統計・発信者の信頼・手動調整）と、元になった映像を持つ。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

ReferenceKind = Literal["model", "drill", "ng"]
"""お手本の投球／ドリル解説／NG 例"""

DEFAULT_PLAYER_HEIGHT_CM = 188.0
"""お手本の選手の身長が分からないときの値（NFL の QB の平均くらい）"""


@dataclass(frozen=True, slots=True)
class Manual:
    """手動調整：ピン留め（×1.5）・除外（×0）・星（1〜5）"""

    pinned: bool = False
    excluded: bool = False
    stars: int = 3


@dataclass(frozen=True, slots=True)
class YouTubeStats:
    """登録したとき（または取り直したとき）の YouTube の統計。非公開の値は None"""

    views: int
    likes: int | None
    comments: int | None
    subscribers: int | None
    duration_sec: int
    published_at: str
    fetched_at: str


@dataclass(frozen=True, slots=True)
class Reference:
    id: str
    video_id: str
    """元になった映像（取り込んだ YouTube の区間）の ID"""
    youtube_id: str
    title: str
    channel: str
    channel_id: str
    license: str
    kind: ReferenceKind
    trusted_channel: bool
    player_height_cm: float
    stats: YouTubeStats
    manual: Manual = field(default_factory=Manual)
    created_at: str = ""


class ReferenceError(ValueError):
    """お手本として受け付けられない入力"""


def check_manual(m: Manual) -> Manual:
    if not 1 <= m.stars <= 5:
        raise ReferenceError("星は 1〜5 で付けてください")
    return m


def check_height(cm: float) -> float:
    if not 120 <= cm <= 230:
        raise ReferenceError("お手本の選手の身長は 120〜230 cm で入れてください")
    return cm
