"""ルールベースのフェーズ分割。apps/web/src/domain/phases.ts と同じ規則で実装する。"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal

from .pose import PoseSequence, dist, js_round, kp, pelvis_series, speed_series

PhaseKey = Literal["drop", "set", "stride", "release", "follow"]

PHASE_LABEL: dict[PhaseKey, str] = {
    "drop": "ドロップ",
    "set": "セット",
    "stride": "ステップ",
    "release": "リリース",
    "follow": "フォロー",
}


@dataclass(frozen=True, slots=True)
class Events:
    """フレーム番号で表したイベント"""

    set_start: int
    stride_start: int
    plant: int
    release: int
    follow_start: int
    last: int

    def to_json(self) -> dict[str, int]:
        return {
            "setStart": self.set_start,
            "strideStart": self.stride_start,
            "plant": self.plant,
            "release": self.release,
            "followStart": self.follow_start,
            "last": self.last,
        }


@dataclass(frozen=True, slots=True)
class Phase:
    key: PhaseKey
    start: int
    end: int


def _find(n: int, pred: Callable[[int], bool]) -> int:
    """条件を満たす最初のフレーム番号。なければ -1（Array.prototype.findIndex と同じ）"""
    return next((i for i in range(n) if pred(i)), -1)


def detect_events(seq: PoseSequence) -> Events:
    fps, frames = seq.fps, seq.frames
    n = len(frames)
    last = n - 1
    pelvis = pelvis_series(seq)
    pelvis_speed = []
    for i in range(n):
        a, b = max(0, i - 1), min(last, i + 1)
        pelvis_speed.append(0.0 if a == b else dist(pelvis[b], pelvis[a]) * fps / (b - a))
    ankle_l = [kp(f, "lAnkle") for f in frames]
    ankle_l_speed = speed_series(seq, "lAnkle")
    wrist_speed = speed_series(seq, "rWrist")

    min_drop = js_round(0.25 * fps)
    # セット：ドロップで動いた骨盤が止まる
    set_start = _find(n, lambda i: i > min_drop and pelvis_speed[i] < 0.45)
    if set_start < 0:
        set_start = min_drop
    # ステップ：前足（左）が地面から離れる
    stride_start = _find(n, lambda i: i > set_start and ankle_l[i].y > 0.1)
    if stride_start < 0:
        stride_start = set_start + 1
    # 接地：前足が地面に戻り、止まる
    plant = _find(n, lambda i: i > stride_start + 2 and ankle_l[i].y < 0.095 and ankle_l_speed[i] < 0.35)
    if plant < 0:
        plant = stride_start + 1
    # リリース：接地前後で投げる手首が最も速い瞬間
    lo = max(0, plant - js_round(0.1 * fps))
    hi = min(last, plant + js_round(0.3 * fps))
    release = lo
    for i in range(lo, hi + 1):
        if wrist_speed[i] > wrist_speed[release]:
            release = i
    # フォロースルー：手首の速さがピークの 45% を下回る
    peak = wrist_speed[release]
    follow_start = _find(n, lambda i: i > release and wrist_speed[i] < peak * 0.45)
    if follow_start < 0:
        follow_start = min(last, release + 3)
    return Events(set_start, stride_start, plant, release, follow_start, last)


def to_phases(e: Events) -> list[Phase]:
    return [
        Phase("drop", 0, e.set_start),
        Phase("set", e.set_start, e.stride_start),
        Phase("stride", e.stride_start, e.plant),
        Phase("release", e.plant, e.follow_start),
        Phase("follow", e.follow_start, e.last),
    ]


def phase_at(phases: list[Phase], frame: int) -> PhaseKey:
    return next((p.key for p in phases if p.start <= frame < p.end), phases[-1].key)
