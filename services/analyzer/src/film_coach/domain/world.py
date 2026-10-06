"""画像の座標（ピクセル）から、ワールド 2D（メートル、x は投げる方向、y は上向き、地面が 0）に直す。

横から固定カメラで撮った映像を前提にする。カメラが動く映像や、斜めから撮った映像では長さが狂う。
- 縮尺：太もも・すね・体幹の長さ（姿勢で変わりにくい）の合計を、身長に対する標準の比率で割り、
  画像の上での身長を見積もる
- 地面：低いほうの足首の位置の中央値を、足首の高さ（身長比）に合わせる
- 向き：投げる手首が速く動くときの横の向きを、ワールドの x の正にする
- 利き腕：手首の速さが大きいほうを投げる腕とする。ドメインの規則は右投げで書いているので、
  左投げなら左右の関節を入れ替える
"""

from __future__ import annotations

import math
import statistics
from collections.abc import Sequence
from dataclasses import dataclass
from itertools import pairwise
from typing import Literal

from .pose import KP, NUM_KEYPOINTS, Keypoint, KeypointName, PoseFrame, PoseSequence

ImagePoint = tuple[float, float, float]
"""画像の上の関節 [x, y, 信頼度]（y は下向き）"""
ImagePose = Sequence[ImagePoint]
"""COCO-17 の 17 関節"""

SEGMENT_RATIO = 0.245 + 0.246 + 0.288
"""太もも・すね・体幹（肩〜股関節）の長さの合計の、身長に対する比率（Winter, Biomechanics and Motor Control of
Human Movement の人体寸法）"""
ANKLE_RATIO = 0.039
"""足首の関節の高さの、身長に対する比率（同上）"""
MIN_CONF = 0.3
"""長さや速さの見積もりに使う関節の信頼度の下限"""

Hand = Literal["right", "left"]

# 左右の入れ替え（COCO-17 の番号の組）
MIRROR = [0, 2, 1, 4, 3, 6, 5, 8, 7, 10, 9, 12, 11, 14, 13, 16, 15]


@dataclass(frozen=True, slots=True)
class WorldTransform:
    """画像の座標 → ワールド 2D。world = ((x − origin_x) · direction · m_per_px, (ground_y − y) · m_per_px + ankle_m)"""

    m_per_px: float
    origin_x: float
    """ワールドの x = 0 にあたる画像の x"""
    ground_y: float
    """地面に着いた足首の画像の y"""
    direction: Literal[1, -1]
    """画像の右へ投げるなら 1、左へ投げるなら -1"""
    ankle_m: float
    """地面に着いた足首の高さ（m）"""

    def to_world(self, x: float, y: float) -> tuple[float, float]:
        return (x - self.origin_x) * self.direction * self.m_per_px, (self.ground_y - y) * self.m_per_px + self.ankle_m

    def to_image(self, x: float, y: float) -> tuple[float, float]:
        return self.origin_x + x / (self.direction * self.m_per_px), self.ground_y - (y - self.ankle_m) / self.m_per_px


def _p(pose: ImagePose, name: KeypointName) -> ImagePoint:
    return pose[KP[name]]


def _len(a: ImagePoint, b: ImagePoint) -> float | None:
    return math.hypot(a[0] - b[0], a[1] - b[1]) if a[2] >= MIN_CONF and b[2] >= MIN_CONF else None


def _mid(a: ImagePoint, b: ImagePoint) -> ImagePoint:
    return (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, min(a[2], b[2])


def body_length_px(pose: ImagePose) -> float | None:
    """太もも・すね・体幹の長さの合計（画像のピクセル）。横から見ると奥の脚が短く見えるので、左右の長いほうを使う"""
    thigh = [_len(_p(pose, "lHip"), _p(pose, "lKnee")), _len(_p(pose, "rHip"), _p(pose, "rKnee"))]
    shank = [_len(_p(pose, "lKnee"), _p(pose, "lAnkle")), _len(_p(pose, "rKnee"), _p(pose, "rAnkle"))]
    shoulders = _mid(_p(pose, "lShoulder"), _p(pose, "rShoulder"))
    hips = _mid(_p(pose, "lHip"), _p(pose, "rHip"))
    trunk = _len(shoulders, hips)
    t = [v for v in thigh if v is not None]
    s = [v for v in shank if v is not None]
    if not t or not s or trunk is None:
        return None
    total = max(t) + max(s) + trunk
    return total if total > 0 else None


def _wrist_speeds(poses: Sequence[ImagePose], fps: float, name: KeypointName) -> list[tuple[float, float]]:
    """(速さ px/s, 横の速度 px/s)。信頼度の低いフレームは 0"""
    out: list[tuple[float, float]] = []
    for i in range(len(poses)):
        a, b = max(0, i - 1), min(len(poses) - 1, i + 1)
        pa, pb = _p(poses[a], name), _p(poses[b], name)
        if a == b or pa[2] < MIN_CONF or pb[2] < MIN_CONF:
            out.append((0.0, 0.0))
            continue
        dt = (b - a) / fps
        vx, vy = (pb[0] - pa[0]) / dt, (pb[1] - pa[1]) / dt
        out.append((math.hypot(vx, vy), vx))
    return out


def _top_mean(values: list[float], k: int) -> float:
    return sum(sorted(values, reverse=True)[:k]) / max(1, min(k, len(values)))


OVERHEAD_MARGIN = 0.05
"""肩より上とみなす高さ（画像の上での身長比）"""
MIN_OVERHEAD_FRAMES = 3
"""投げる腕を、肩より上にいた長さで決めるのに要るフレーム数"""


def _overhead_frames(poses: Sequence[ImagePose], wrist: KeypointName, shoulder: KeypointName, margin_px: float) -> int:
    """手首が肩より上（画像の y が小さい）にあったフレームの数。信頼度の低い関節は数えない"""
    n = 0
    for p in poses:
        w, s = _p(p, wrist), _p(p, shoulder)
        if w[2] >= MIN_CONF and s[2] >= MIN_CONF and w[1] < s[1] - margin_px:
            n += 1
    return n


def throwing_hand(poses: Sequence[ImagePose], fps: float, body_px: float = 0.0) -> Hand:
    """投げる腕。肩より上にいた時間が長いほうの手首にする（振りかぶってからリリースまで、投げる腕は肩より上にある）。

    手首の速さでは決めない。スロー再生の映像では、投げたあとのグラブ側の手の動きや、左右の取り違えの数フレームの
    ほうが速く出ることがあるため。どちらの手首もほとんど肩より上に来なければ、速いフレームの平均で決める。
    """
    margin = OVERHEAD_MARGIN * body_px
    right = _overhead_frames(poses, "rWrist", "rShoulder", margin)
    left = _overhead_frames(poses, "lWrist", "lShoulder", margin)
    if max(right, left) >= MIN_OVERHEAD_FRAMES:
        return "left" if left > right else "right"
    k = max(3, round(fps * 0.05))
    right_speed = _top_mean([s for s, _ in _wrist_speeds(poses, fps, "rWrist")], k)
    left_speed = _top_mean([s for s, _ in _wrist_speeds(poses, fps, "lWrist")], k)
    return "left" if left_speed > right_speed else "right"


LEAD_PAIRS: dict[Hand, tuple[tuple[KeypointName, KeypointName], ...]] = {
    "right": (("lShoulder", "rShoulder"), ("lHip", "rHip"), ("lAnkle", "rAnkle")),
    "left": (("rShoulder", "lShoulder"), ("rHip", "lHip"), ("rAnkle", "lAnkle")),
}
"""投げる向きの手がかりにする（前の側, 後ろの側）の関節の組。右投げなら左が前（投げる側）"""
MIN_LEAD_SPREAD = 0.03
"""体の向きで投げる向きを決めるのに要る、左右の関節の横のずれの中央値（画像の上での身長比）"""


def throw_direction(poses: Sequence[ImagePose], fps: float, hand: Hand, body_px: float = 0.0) -> Literal[1, -1]:
    """投げる向き。横から見ると、前の側（右投げなら左の肩・腰・足）が投げる側にある（カメラがどちら側でも同じ）。

    肩・腰・足首の左右の横のずれの中央値で決める。手首の速さの向きでは決めない。スロー再生の映像では、
    振りかぶる（後ろへ引く）動きのほうが速く出て、向きが逆になることがあるため。
    体の向きで決めきれないとき（ずれが小さい）だけ、手首が最も速い数フレームの向きで決める。
    """
    diffs: list[float] = []
    for p in poses:
        for front, back in LEAD_PAIRS[hand]:
            pa, pb = _p(p, front), _p(p, back)
            if pa[2] >= MIN_CONF and pb[2] >= MIN_CONF:
                diffs.append(pa[0] - pb[0])
    if diffs and abs(statistics.median(diffs)) >= MIN_LEAD_SPREAD * body_px:
        return 1 if statistics.median(diffs) > 0 else -1
    speeds = _wrist_speeds(poses, fps, "rWrist" if hand == "right" else "lWrist")
    k = max(3, round(fps * 0.05))
    top = sorted(speeds, key=lambda s: s[0], reverse=True)[:k]
    return 1 if sum(vx for _, vx in top) >= 0 else -1


def mirror_pose(pose: ImagePose) -> list[ImagePoint]:
    """左右の関節を入れ替える（左投げを右投げの規則で扱うため）"""
    return [pose[j] for j in MIRROR]


REPAIR_CONF = 0.45
"""これより信頼度の低い関節は、前後のフレームから補う。速く振った腕は像が流れ、手首を胴体の上に取り違えやすい
（そのときの信頼度は 0.2〜0.4 ほど）"""
MAX_FILL_S = 0.2
"""補う間の長さの上限（秒）。これより長く信頼度が低ければ、そのままにする"""


def repair_low_confidence(
    poses: Sequence[ImagePose], fps: float, min_conf: float = REPAIR_CONF
) -> list[list[ImagePoint]]:
    """関節ごとに、信頼度の低いフレームの位置を、前後の信頼できるフレームの線形補間で置き換える。信頼度はそのまま残す"""
    out = [list(p) for p in poses]
    n = len(out)
    max_gap = max(1, round(MAX_FILL_S * fps))
    for j in range(NUM_KEYPOINTS):
        good = [i for i in range(n) if out[i][j][2] >= min_conf]
        for a, b in pairwise(good):
            if 1 < b - a <= max_gap + 1:
                (xa, ya, _), (xb, yb, _) = out[a][j], out[b][j]
                for i in range(a + 1, b):
                    r = (i - a) / (b - a)
                    out[i][j] = (xa + (xb - xa) * r, ya + (yb - ya) * r, out[i][j][2])
    return out


SPIKE_MAX_FRAMES = 3
"""飛びとみなす、続けて外れているフレーム数の上限"""
SPIKE_DISTANCE = 0.15
"""飛びとみなす、前後のフレームからの距離（画像の上での身長比）"""


def remove_spikes(poses: Sequence[ImagePose], body_px: float) -> list[list[ImagePoint]]:
    """関節ごとに、1〜SPIKE_MAX_FRAMES フレームだけ遠くへ飛んで戻る位置（取り違え）を、前後の線形補間で置き換える。

    飛びの条件：その間の位置がどれも前後のフレームから SPIKE_DISTANCE × 身長より離れていて、前後のフレームどうしは
    その半分より近い（行って戻る）。本当に速い腕の動きは前後の位置が離れていくので、置き換えない。
    信頼度が少し高めに出た取り違え（スロー再生で数フレーム続くもの）を、信頼度だけでは補えないため。
    """
    out = [list(p) for p in poses]
    n = len(out)
    limit = SPIKE_DISTANCE * body_px
    for j in range(NUM_KEYPOINTS):
        i = 1
        while i < n - 1:
            fixed = False
            for span in range(1, SPIKE_MAX_FRAMES + 1):
                end = i + span  # 飛びのあとの最初のフレーム
                if end >= n:
                    break
                a, b = out[i - 1][j], out[end][j]
                gap = math.hypot(b[0] - a[0], b[1] - a[1])
                away = min(
                    min(
                        math.hypot(out[k][j][0] - a[0], out[k][j][1] - a[1]),
                        math.hypot(out[k][j][0] - b[0], out[k][j][1] - b[1]),
                    )
                    for k in range(i, end)
                )
                if away > limit and gap < away / 2:
                    for k in range(i, end):
                        r = (k - (i - 1)) / (end - (i - 1))
                        out[k][j] = (a[0] + (b[0] - a[0]) * r, a[1] + (b[1] - a[1]) * r, out[k][j][2])
                    i = end
                    fixed = True
                    break
            if not fixed:
                i += 1
    return out


def body_px_of(poses: Sequence[ImagePose], ratio: float = SEGMENT_RATIO) -> float | None:
    """画像の上での身長の見積もり（太もも・すね・体幹の長さの中央値から）"""
    lengths = [v for p in poses if (v := body_length_px(p)) is not None]
    return statistics.median(lengths) / ratio if lengths else None


class NotEnoughPoseError(ValueError):
    """骨格が足りず、縮尺や地面を見積もれない"""


def estimate_transform(
    poses: Sequence[ImagePose], fps: float, height_m: float, ratio: float = SEGMENT_RATIO
) -> tuple[WorldTransform, Hand]:
    """映像全体の骨格から、縮尺・地面・投げる向き・利き腕を見積もる"""
    lengths = [v for p in poses if (v := body_length_px(p)) is not None]
    if len(lengths) < max(5, len(poses) // 4):
        raise NotEnoughPoseError("脚と体幹がはっきり映ったフレームが少なく、縮尺を見積もれません")
    body_px = statistics.median(lengths) / ratio
    ankles = [
        max(a[1], b[1])
        for p in poses
        if (a := _p(p, "lAnkle"))[2] >= MIN_CONF and (b := _p(p, "rAnkle"))[2] >= MIN_CONF
    ]
    if not ankles:
        raise NotEnoughPoseError("足首が映っておらず、地面の位置を見積もれません")
    hand = throwing_hand(poses, fps, body_px)
    direction = throw_direction(poses, fps, hand, body_px)
    transform = WorldTransform(
        m_per_px=height_m / body_px,
        origin_x=0.0,
        ground_y=statistics.median(ankles),
        direction=direction,
        ankle_m=ANKLE_RATIO * height_m,
    )
    return transform, hand


def to_world(
    poses: Sequence[ImagePose], times: Sequence[float], fps: float, height_m: float, tf: WorldTransform, hand: Hand
) -> PoseSequence:
    """画像の骨格の列を、ワールド 2D の PoseSequence にする。左投げなら左右を入れ替える。

    信頼度は下限を 0.01 にする（平滑化で信頼度を重みに使うので、0 だと割れなくなる）。
    """
    frames: list[PoseFrame] = []
    for t, pose in zip(times, poses, strict=True):
        pts = mirror_pose(pose) if hand == "left" else list(pose)
        if len(pts) != NUM_KEYPOINTS:
            raise ValueError(f"関節の数が {len(pts)} です（{NUM_KEYPOINTS} のはず）")
        kps = []
        for x, y, c in pts:
            wx, wy = tf.to_world(x, y)
            kps.append(Keypoint(wx, wy, max(0.01, c)))
        frames.append(PoseFrame(t, tuple(kps)))
    return PoseSequence(fps, height_m, tuple(frames))
