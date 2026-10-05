"""骨格の型と幾何の計算。関節の並びは COCO-17（RTMPose の出力と同じ）。

座標はワールド 2D（メートル、x は投げる方向、y は上向き、地面が 0）。
apps/web/src/domain/pose.ts と同じ規則で実装する。
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Literal

KeypointName = Literal[
    "nose",
    "lEye",
    "rEye",
    "lEar",
    "rEar",
    "lShoulder",
    "rShoulder",
    "lElbow",
    "rElbow",
    "lWrist",
    "rWrist",
    "lHip",
    "rHip",
    "lKnee",
    "rKnee",
    "lAnkle",
    "rAnkle",
]

KP: dict[KeypointName, int] = {
    "nose": 0,
    "lEye": 1,
    "rEye": 2,
    "lEar": 3,
    "rEar": 4,
    "lShoulder": 5,
    "rShoulder": 6,
    "lElbow": 7,
    "rElbow": 8,
    "lWrist": 9,
    "rWrist": 10,
    "lHip": 11,
    "rHip": 12,
    "lKnee": 13,
    "rKnee": 14,
    "lAnkle": 15,
    "rAnkle": 16,
}

NUM_KEYPOINTS = 17


@dataclass(frozen=True, slots=True)
class Vec2:
    x: float
    y: float


@dataclass(frozen=True, slots=True)
class Keypoint:
    x: float
    y: float
    c: float
    """検出の信頼度（0〜1）"""


@dataclass(frozen=True, slots=True)
class PoseFrame:
    t: float
    kp: tuple[Keypoint, ...]


@dataclass(frozen=True, slots=True)
class PoseSequence:
    fps: float
    height_m: float
    frames: tuple[PoseFrame, ...]


def kp(frame: PoseFrame, name: KeypointName) -> Keypoint:
    return frame.kp[KP[name]]


def sub(a: Vec2 | Keypoint, b: Vec2 | Keypoint) -> Vec2:
    return Vec2(a.x - b.x, a.y - b.y)


def mid(a: Vec2 | Keypoint, b: Vec2 | Keypoint) -> Vec2:
    return Vec2((a.x + b.x) / 2, (a.y + b.y) / 2)


def dist(a: Vec2 | Keypoint, b: Vec2 | Keypoint) -> float:
    return math.hypot(a.x - b.x, a.y - b.y)


def joint_angle(a: Vec2 | Keypoint, b: Vec2 | Keypoint, c: Vec2 | Keypoint) -> float:
    """3 点 a-b-c の b における角度（度）"""
    u = sub(a, b)
    v = sub(c, b)
    cos = (u.x * v.x + u.y * v.y) / (math.hypot(u.x, u.y) * math.hypot(v.x, v.y))
    return math.acos(min(1.0, max(-1.0, cos))) * 180 / math.pi


def head_center(frame: PoseFrame) -> Vec2:
    """頭の中心（鼻と両耳の平均）"""
    nose, left, right = kp(frame, "nose"), kp(frame, "lEar"), kp(frame, "rEar")
    return Vec2((nose.x + left.x + right.x) / 3, (nose.y + left.y + right.y) / 3)


def speed_series(seq: PoseSequence, name: KeypointName) -> list[float]:
    """関節の速さ（m/s）を中心差分で求める。端は片側差分"""
    frames = seq.frames
    last = len(frames) - 1
    out: list[float] = []
    for i in range(len(frames)):
        a, b = max(0, i - 1), min(last, i + 1)
        if a == b:
            out.append(0.0)
            continue
        dt = (b - a) / seq.fps
        out.append(dist(kp(frames[b], name), kp(frames[a], name)) / dt)
    return out


def pelvis_series(seq: PoseSequence) -> list[Vec2]:
    return [mid(kp(f, "lHip"), kp(f, "rHip")) for f in seq.frames]


def smooth_sequence(seq: PoseSequence, radius: int = 2) -> PoseSequence:
    """関節ごとの移動平均（信頼度で重み付け）。M1-2 で One Euro / Savitzky-Golay を検討する"""
    frames = seq.frames
    n = len(frames)
    out: list[PoseFrame] = []
    for i, f in enumerate(frames):
        lo, hi = max(0, i - radius), min(n - 1, i + radius)
        pts: list[Keypoint] = []
        for j, p in enumerate(f.kp):
            sx = sy = sw = 0.0
            for k in range(lo, hi + 1):
                q = frames[k].kp[j]
                sx += q.x * q.c
                sy += q.y * q.c
                sw += q.c
            pts.append(Keypoint(sx / sw, sy / sw, p.c))
        out.append(PoseFrame(f.t, tuple(pts)))
    return PoseSequence(seq.fps, seq.height_m, tuple(out))


def js_round(x: float) -> int:
    """JavaScript の Math.round と同じ丸め（.5 は正の方向へ）。Python の round は偶数丸めなので使わない"""
    return math.floor(x + 0.5)
