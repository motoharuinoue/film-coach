"""練習（設計書のデータモデルの Session）：何本かの映像を 1 回の練習としてまとめ、投球を比べる単位。

画面のデモの Session（合成データ）と区別するため、解析サービスでは練習（practice）と呼ぶ。
まとめるのは映像の ID だけで、映像そのものや解析結果は動かさない。
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Literal

from .camera import CameraAngle

PracticeKind = Literal["drill", "game"]

MAX_NAME = 40
"""練習の名前の長さの上限"""
MAX_MEMO = 400
"""メモの長さの上限"""
MAX_VIDEOS = 50
"""1 回の練習にまとめられる映像の数の上限"""


@dataclass(frozen=True, slots=True)
class Practice:
    id: str
    name: str
    date: str
    """練習した日（YYYY-MM-DD）"""
    kind: PracticeKind
    camera: CameraAngle
    memo: str
    video_ids: tuple[str, ...]
    """まとめた映像（並べる順）"""
    created_at: str


class PracticeError(ValueError):
    """練習として受け付けられない入力"""


def check_practice(name: str, day: str, memo: str, video_ids: list[str]) -> str:
    """入力を確かめ、前後の空白を除いた名前を返す"""
    name = name.strip()
    if not name or len(name) > MAX_NAME:
        raise PracticeError(f"名前は 1〜{MAX_NAME} 文字で入れてください")
    try:
        date.fromisoformat(day)
    except ValueError as e:
        raise PracticeError(f"日付は YYYY-MM-DD の形で入れてください：{day!r}") from e
    if len(memo) > MAX_MEMO:
        raise PracticeError(f"メモは {MAX_MEMO} 文字までです")
    if not video_ids:
        raise PracticeError("映像を 1 本以上選んでください")
    if len(video_ids) > MAX_VIDEOS:
        raise PracticeError(f"1 回の練習にまとめられる映像は {MAX_VIDEOS} 本までです")
    if len(set(video_ids)) != len(video_ids):
        raise PracticeError("同じ映像が 2 回選ばれています")
    return name
