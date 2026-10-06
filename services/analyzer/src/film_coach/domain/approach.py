"""投げ始め：ドロップしてから投げたか、その場で構えてから投げたか。

頭の上下動のように、ドロップの有無で値の意味が変わる指標がある（ドロップ中は頭が上下するのが普通）。
判定では、投げ始めが同じお手本とだけ比べる（apps/web の zonesFor）。ここでは投球ごとに投げ始めを見分ける。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from .camera import CameraAngle
from .metrics import MIN_SET_S
from .phases import Events, stride_found
from .pose import PoseSequence, js_round, pelvis_series
from .throws import DROP_M

Approach = Literal["drop", "standing", "unknown"]
"""ドロップから／その場から／分からない"""
ApproachMode = Literal["auto", "drop", "standing"]
"""投げ始めの決め方：骨格から見分ける／利用者が指定する"""

APPROACH_LABEL: dict[Approach, str] = {"drop": "ドロップから", "standing": "その場から", "unknown": "分からない"}

DROP_CAMERAS: tuple[CameraAngle, ...] = ("side",)
"""ドロップの深さを測れる角度。後方・正面からでは、前後の動きが奥行きになって測れない"""


@dataclass(frozen=True, slots=True)
class ApproachInfo:
    kind: Approach
    drop_m: float | None
    """ステップの前に骨盤が後ろへ下がった距離（m）。測れない角度なら None"""


def drop_depth(seq: PoseSequence, until: int) -> float:
    """until（含む）までに、骨盤が後ろへ下がった距離の最大（m）。前へ出てから下がった分も、その前の最も前の位置から測る"""
    deepest = 0.0
    front = -float("inf")
    for p in pelvis_series(seq)[: until + 1]:
        front = max(front, p.x)
        deepest = max(deepest, front - p.x)
    return deepest


def detect_approach(seq: PoseSequence, e: Events, camera: CameraAngle) -> ApproachInfo:
    """投げ始めを骨格から見分ける。

    - ステップの前に、骨盤が DROP_M 以上後ろへ下がっていればドロップから
    - 下がっていなくて、ステップの前の構えが MIN_SET_S 以上映っていればその場から
    - 構えが映っていない（ステップの途中から映っている）、ステップが見つからない、横から以外の角度なら分からない
    """
    if camera not in DROP_CAMERAS or not stride_found(e):
        return ApproachInfo("unknown", None)
    depth = drop_depth(seq, e.stride_start)
    if depth >= DROP_M:
        return ApproachInfo("drop", depth)
    if e.stride_start >= js_round(MIN_SET_S * seq.fps):
        return ApproachInfo("standing", depth)
    return ApproachInfo("unknown", depth)


def decide_approach(seq: PoseSequence, e: Events, camera: CameraAngle, mode: ApproachMode) -> ApproachInfo:
    """利用者が指定していればそれに従い、ドロップの深さは測れれば添える。自動なら骨格から見分ける"""
    found = detect_approach(seq, e, camera)
    return found if mode == "auto" else ApproachInfo(mode, found.drop_m)
