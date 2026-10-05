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


def throwing_hand(poses: Sequence[ImagePose], fps: float) -> Hand:
    """手首の速いフレームの平均（上位数フレーム）が大きいほうを投げる腕とする。1 フレームだけの誤検出に引っ張られない"""
    k = max(3, round(fps * 0.05))
    right = _top_mean([s for s, _ in _wrist_speeds(poses, fps, "rWrist")], k)
    left = _top_mean([s for s, _ in _wrist_speeds(poses, fps, "lWrist")], k)
    return "left" if left > right else "right"


def throw_direction(poses: Sequence[ImagePose], fps: float, hand: Hand) -> Literal[1, -1]:
    """投げる手首が最も速い数フレームの、横の速度の向き"""
    speeds = _wrist_speeds(poses, fps, "rWrist" if hand == "right" else "lWrist")
    k = max(3, round(fps * 0.05))
    top = sorted(speeds, key=lambda s: s[0], reverse=True)[:k]
    return 1 if sum(vx for _, vx in top) >= 0 else -1


def mirror_pose(pose: ImagePose) -> list[ImagePoint]:
    """左右の関節を入れ替える（左投げを右投げの規則で扱うため）"""
    return [pose[j] for j in MIRROR]


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
    hand = throwing_hand(poses, fps)
    direction = throw_direction(poses, fps, hand)
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
