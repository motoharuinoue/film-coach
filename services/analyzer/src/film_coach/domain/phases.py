"""ルールベースのフェーズ分割。apps/web/src/domain/phases.ts と同じ規則で実装する。"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal

from .pose import PoseSequence, js_round, kp, pelvis_series, speed_series

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


STRIDE_SPEED = 0.5
"""前足が前へ動いているとみなす速さ（m/s）"""
DROP_SPEED = 0.5
"""骨盤が後ろへ下がっている（ドロップ）とみなす速さ（m/s）"""
STRIDE_SEARCH_S = 0.8
"""リリースからさかのぼって前足の動きを探す範囲（秒）"""
MIN_STRIDE = 0.04
"""ステップとみなす、前足が続けて前へ動いた距離（身長比）。リリースのときの軸足の小さなひねりと見分ける"""


def _find(n: int, pred: Callable[[int], bool]) -> int:
    """条件を満たす最初のフレーム番号。なければ -1（Array.prototype.findIndex と同じ）"""
    return next((i for i in range(n) if pred(i)), -1)


def _velocity_x(xs: list[float], fps: float) -> list[float]:
    """横（投げる方向）の速度（m/s、前向きが正）。中心差分、端は片側差分"""
    last = len(xs) - 1
    out = []
    for i in range(len(xs)):
        a, b = max(0, i - 1), min(last, i + 1)
        out.append(0.0 if a == b else (xs[b] - xs[a]) * fps / (b - a))
    return out


def detect_events(seq: PoseSequence) -> Events:
    """イベントを、リリースからさかのぼって決める。横の動きの速さだけを使い、足首の高さは使わない
    （実際の映像では、カメラから遠い足ほど画面の上に映り、高さで接地を判定できないため）。

    1. リリース：投げる手首が最も速い瞬間
    2. 接地：さかのぼって、前足（左）が前へ身長の MIN_STRIDE 倍以上動いた区間の、最後のフレームの次
    3. ステップ：さらにさかのぼって、前足が前へ動き始めたフレーム。見つからなければ、ステップと接地を
       リリースと同じフレームにする（ステップの長さ 0 ＝ 見つからない。stride_found）
    4. セット：その前で、骨盤が後ろへ下がっていた（ドロップ）最後のフレームの次。ドロップがなければ 0
    5. フォロースルー：手首の速さがピークの 45% を下回る
    """
    fps, frames = seq.fps, seq.frames
    n = len(frames)
    last = n - 1
    wrist_speed = speed_series(seq, "rWrist")
    ankle_vx = _velocity_x([kp(f, "lAnkle").x for f in frames], fps)
    pelvis_vx = _velocity_x([p.x for p in pelvis_series(seq)], fps)

    lead = min(last, js_round(0.25 * fps))
    release = lead
    for i in range(lead, last + 1):
        if wrist_speed[i] > wrist_speed[release]:
            release = i

    limit = max(0, release - js_round(STRIDE_SEARCH_S * fps))
    ankle_x = [kp(f, "lAnkle").x for f in frames]
    plant = release
    stride_start = release
    # さかのぼって、前足が前へ動いていた区間を探す。短すぎる動き（軸足のひねりなど）は飛ばして、さらにさかのぼる
    i = release
    while i > limit:
        while i > limit and ankle_vx[i] <= STRIDE_SPEED:
            i -= 1
        if ankle_vx[i] <= STRIDE_SPEED:
            break
        end = i
        while i > 0 and ankle_vx[i - 1] > STRIDE_SPEED:
            i -= 1
        if ankle_x[min(last, end + 1)] - ankle_x[i] >= MIN_STRIDE * seq.height_m:
            plant = min(last, end + 1)
            stride_start = i
            break
        i -= 1

    set_start = 0
    for k in range(stride_start - 1, -1, -1):
        if pelvis_vx[k] < -DROP_SPEED:
            set_start = k + 1
            break

    peak = wrist_speed[release]
    follow_start = _find(n, lambda k: k > release and wrist_speed[k] < peak * 0.45)
    if follow_start < 0:
        follow_start = min(last, release + 3)
    return Events(set_start, stride_start, plant, release, follow_start, last)


def stride_found(e: Events) -> bool:
    """ステップが見つかったか。見つからなければ、ステップと接地がリリースと同じフレームになっている"""
    return e.plant > e.stride_start


def stride_seen(e: Events) -> bool:
    """ステップの始まりが区間の中に映っているか。区間の最初から前足が動いていれば、始まりは映っていない"""
    return stride_found(e) and e.stride_start > 0


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
