"""ドリル動画：改善点に添える、練習ドリルを解説した YouTube の動画（の開始位置）。

お手本と違って骨格は解析しない。動画は取り込まず（ダウンロードしない）、YouTube の埋め込みかリンクで見る（ADR-0005）。
どの指標を、どちら側（お手本の範囲より小さい／大きい）に外れたときに直すドリルかを持つ。指標は「大きいほど良い」ではないため。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from .metrics import METRIC_KEYS, MetricKey
from .youtube import is_youtube_id

DrillSide = Literal["low", "high", "any"]
"""お手本の範囲より小さいとき／大きいとき／どちらでも"""

MAX_LABEL = 40
"""ドリルの名前の長さの上限"""
MAX_TARGETS = 10
"""1 本のドリル動画に付けられる指標の数の上限"""


@dataclass(frozen=True, slots=True)
class DrillTarget:
    metric: MetricKey
    side: DrillSide


@dataclass(frozen=True, slots=True)
class Drill:
    id: str
    youtube_id: str
    title: str
    """YouTube の動画のタイトル"""
    channel: str
    start_sec: int
    """ドリルの説明が始まる位置（秒）"""
    label: str
    """ドリルの名前（例：ライン目印のステップ・アンド・スロー）"""
    targets: tuple[DrillTarget, ...]
    created_at: str


class DrillError(ValueError):
    """ドリル動画として受け付けられない入力"""


def check_drill(youtube_id: str, label: str, start_sec: int, targets: list[DrillTarget]) -> str:
    """入力を確かめ、前後の空白を除いた名前を返す"""
    if not is_youtube_id(youtube_id):
        raise DrillError(f"YouTube の動画 ID ではありません：{youtube_id!r}")
    label = label.strip()
    if not label or len(label) > MAX_LABEL:
        raise DrillError(f"ドリルの名前は 1〜{MAX_LABEL} 文字で入れてください")
    if start_sec < 0:
        raise DrillError("開始位置は 0 秒以上にしてください")
    if not targets or len(targets) > MAX_TARGETS:
        raise DrillError(f"直す指標を 1〜{MAX_TARGETS} 個選んでください")
    if any(t.metric not in METRIC_KEYS for t in targets):
        raise DrillError("対応していない指標が含まれています")
    if len({t.metric for t in targets}) != len(targets):
        raise DrillError("同じ指標が 2 回選ばれています")
    return label
