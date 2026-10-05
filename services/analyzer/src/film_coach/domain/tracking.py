"""人物の追跡と、対象選手のロック。

大勢が映る映像で、フレームごとに検出した人物の枠を IoU（重なりの割合）でつなぎ、
利用者が指した 1 人の追跡結果を取り出す。人の陰に隠れて途切れた追跡は、位置と大きさで
つなぎ直す。標準ライブラリだけで書き、外部ライブラリには依存しない。
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from itertools import pairwise


@dataclass(frozen=True, slots=True)
class Box:
    """画像上の人物の枠（ピクセル）"""

    x1: float
    y1: float
    x2: float
    y2: float
    score: float = 1.0

    @property
    def w(self) -> float:
        return self.x2 - self.x1

    @property
    def h(self) -> float:
        return self.y2 - self.y1

    @property
    def cx(self) -> float:
        return (self.x1 + self.x2) / 2

    @property
    def cy(self) -> float:
        return (self.y1 + self.y2) / 2

    def contains(self, x: float, y: float) -> bool:
        return self.x1 <= x <= self.x2 and self.y1 <= y <= self.y2

    def shifted(self, dx: float, dy: float) -> Box:
        return Box(self.x1 + dx, self.y1 + dy, self.x2 + dx, self.y2 + dy, self.score)


def iou(a: Box, b: Box) -> float:
    ix = max(0.0, min(a.x2, b.x2) - max(a.x1, b.x1))
    iy = max(0.0, min(a.y2, b.y2) - max(a.y1, b.y1))
    inter = ix * iy
    union = a.w * a.h + b.w * b.h - inter
    return inter / union if union > 0 else 0.0


@dataclass(slots=True)
class Track:
    id: int
    boxes: dict[int, Box] = field(default_factory=dict)
    """フレーム番号 → 枠（フレーム番号の昇順に入る）"""

    @property
    def first(self) -> int:
        return next(iter(self.boxes))

    @property
    def last(self) -> int:
        return next(reversed(self.boxes))

    def velocity(self, at_end: bool = True, span: int = 5) -> tuple[float, float]:
        """端の数フレームから求めた中心の速さ（ピクセル/フレーム）"""
        frames = list(self.boxes)
        part = frames[-span:] if at_end else frames[:span]
        if len(part) < 2:
            return (0.0, 0.0)
        a, b = self.boxes[part[0]], self.boxes[part[-1]]
        n = part[-1] - part[0]
        return ((b.cx - a.cx) / n, (b.cy - a.cy) / n)

    def predict(self, frame: int) -> Box:
        """最後の枠を、その速さで frame まで動かした枠"""
        vx, vy = self.velocity()
        d = frame - self.last
        return self.boxes[self.last].shifted(vx * d, vy * d)


@dataclass(slots=True)
class IouTracker:
    """フレームごとの検出を、予測した枠との IoU が高い順に貪欲につなぐ"""

    min_iou: float = 0.3
    max_age: int = 8
    """見失ってから、つなぎ直しを待つフレーム数"""
    min_new_score: float = 0.5
    """新しい追跡を始める検出の信頼度の下限"""
    tracks: list[Track] = field(default_factory=list)
    _next_id: int = 1

    def update(self, frame: int, detections: list[Box]) -> None:
        alive = [t for t in self.tracks if frame - t.last <= self.max_age]
        pairs = sorted(
            ((iou(t.predict(frame), d), ti, di) for ti, t in enumerate(alive) for di, d in enumerate(detections)),
            reverse=True,
        )
        used_t: set[int] = set()
        used_d: set[int] = set()
        for score, ti, di in pairs:
            if score < self.min_iou:
                break
            if ti in used_t or di in used_d:
                continue
            alive[ti].boxes[frame] = detections[di]
            used_t.add(ti)
            used_d.add(di)
        for di, d in enumerate(detections):
            if di not in used_d and d.score >= self.min_new_score:
                self.tracks.append(Track(self._next_id, {frame: d}))
                self._next_id += 1


def pick_track(tracks: list[Track], frame: int, x: float, y: float, search: int = 15) -> Track | None:
    """frame 付近で点 (x, y) を含む枠の追跡。複数あれば枠の中心に近いものを選ぶ"""
    for d in sorted(range(-search, search + 1), key=abs):
        f = frame + d
        hits = [t for t in tracks if f in t.boxes and t.boxes[f].contains(x, y)]
        if hits:
            return min(hits, key=lambda t: math.hypot(t.boxes[f].cx - x, t.boxes[f].cy - y))
    return None


def _similar_size(a: Box, b: Box, ratio: float = 1.6) -> bool:
    return 1 / ratio <= b.h / a.h <= ratio


def link_tracks(tracks: list[Track], seed: Track, max_gap: int = 20, max_dist: float = 0.8) -> list[Track]:
    """途切れた追跡を前後につなぐ。

    つなぐ条件：seed の端から max_gap フレーム以内に始まる（終わる）追跡で、予測した位置との距離が
    枠の高さの max_dist 倍以内、大きさが近いもの。候補が複数あれば、いちばん近いものを選ぶ。
    """
    chain = [seed]
    used = {seed.id}
    while True:  # 前へ
        tail = chain[-1]
        cands = []
        for t in tracks:
            if t.id in used or not (tail.last < t.first <= tail.last + max_gap):
                continue
            p, b = tail.predict(t.first), t.boxes[t.first]
            dist = math.hypot(p.cx - b.cx, p.cy - b.cy) / p.h
            if dist <= max_dist and _similar_size(p, b):
                cands.append((dist, t.first, t))
        if not cands:
            break
        nxt = min(cands, key=lambda c: (c[0], c[1]))[2]
        chain.append(nxt)
        used.add(nxt.id)
    while True:  # 後ろへ
        head = chain[0]
        vx, vy = head.velocity(at_end=False)
        cands = []
        for t in tracks:
            if t.id in used or not (head.first - max_gap <= t.last < head.first):
                continue
            d = head.first - t.last
            p = head.boxes[head.first].shifted(-vx * d, -vy * d)
            b = t.boxes[t.last]
            dist = math.hypot(p.cx - b.cx, p.cy - b.cy) / p.h
            if dist <= max_dist and _similar_size(p, b):
                cands.append((dist, -t.last, t))
        if not cands:
            break
        prv = min(cands, key=lambda c: (c[0], c[1]))[2]
        chain.insert(0, prv)
        used.add(prv.id)
    return chain


def merge_boxes(chain: list[Track]) -> dict[int, Box]:
    """つないだ追跡の枠を 1 本にまとめる（重なるフレームは先の追跡を優先）"""
    out: dict[int, Box] = {}
    for t in chain:
        for f, b in t.boxes.items():
            out.setdefault(f, b)
    return dict(sorted(out.items()))


def fill_gaps(boxes: dict[int, Box], max_gap: int = 20) -> tuple[dict[int, Box], set[int]]:
    """max_gap フレーム以内の抜けを、前後の枠の線形補間で埋める。戻り値の 2 つ目は補間したフレーム"""
    frames = sorted(boxes)
    out = dict(boxes)
    filled: set[int] = set()
    for a, b in pairwise(frames):
        gap = b - a
        if 1 < gap <= max_gap + 1:
            ba, bb = boxes[a], boxes[b]
            for f in range(a + 1, b):
                r = (f - a) / gap
                out[f] = Box(
                    ba.x1 + (bb.x1 - ba.x1) * r,
                    ba.y1 + (bb.y1 - ba.y1) * r,
                    ba.x2 + (bb.x2 - ba.x2) * r,
                    ba.y2 + (bb.y2 - ba.y2) * r,
                    min(ba.score, bb.score),
                )
                filled.add(f)
    return dict(sorted(out.items())), filled
