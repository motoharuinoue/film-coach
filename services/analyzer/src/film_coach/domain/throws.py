"""長い映像の骨格から、投球（レップ）を 1 本ずつ見つける。

投げる手首（右投げの規則にそろえた rWrist）の速さのピークのうち、そのときに手首が肩より上にあるもの
（上から投げる動き）を投球とみなす。走るときの腕振りなどは、手首が肩より下なので数えない。区間の始まりは、ピークから
さかのぼって、ドロップの前の構えの終わり（ドロップの始まり）にする（motion_start）。
フェーズ分割（phases.py）は、区間がドロップから始まることを前提にしているため。
"""

from __future__ import annotations

from dataclasses import dataclass

from .pose import PoseSequence, dist, js_round, kp, pelvis_series, speed_series

MIN_PEAK = 3.0
"""投球とみなす手首の速さの下限（身長/秒）"""
MIN_GAP_S = 2.0
"""投球と投球の間の最短の間隔（秒）"""
MAX_BEFORE_S = 2.5
"""ピークより前に取る長さの上限（秒）"""
AFTER_S = 0.7
"""ピークより後に取る長さ（秒）"""
LEAD_S = 0.5
"""ピークの前に、骨格が続いていなければならない長さ（秒）。足りなければ投球の途中から映っている"""
TAIL_S = 0.25
"""ピークの後に、骨格が続いていなければならない長さ（秒）。足りなければ投げ終わりまで映っていない"""
STILL_SPEED = 0.25
"""骨盤が止まっているとみなす速さ（m/s）"""
STILL_S = 0.3
"""構えとみなす、骨盤が止まっている長さ（秒）"""
OVERHEAD = 0.05
"""投球とみなす、ピークの前後で投げる手首が肩より上にある高さ（身長比）"""
OVERHEAD_S = 0.1
"""手首の高さを見る、ピークの前後の幅（秒）"""
DROP_M = 0.5
"""ドロップとみなす、骨盤が後ろへ下がる距離（m）。セットで止まる時間は人によって違うので、静止の長さではなく、
そのあとにドロップしたかどうかで構えとセットを見分ける"""


@dataclass(frozen=True, slots=True)
class RepWindow:
    """列の中のフレーム番号で表した 1 本の投球"""

    peak: int
    """投げる手首が最も速いフレーム"""
    start: int
    end: int
    """区間の最後のフレーム（含む）"""


def _pelvis_speed(seq: PoseSequence) -> list[float]:
    pelvis = pelvis_series(seq)
    last = len(pelvis) - 1
    out = []
    for i in range(len(pelvis)):
        a, b = max(0, i - 1), min(last, i + 1)
        out.append(0.0 if a == b else dist(pelvis[b], pelvis[a]) * seq.fps / (b - a))
    return out


def _still_runs(speed: list[float], lo: int, hi: int, need: int) -> list[tuple[int, int]]:
    """lo〜hi の中で、骨盤が need フレーム以上止まっていた区間 (最初, 最後)。hi に近い順"""
    runs: list[tuple[int, int]] = []
    i = hi
    while i >= lo:
        if speed[i] >= STILL_SPEED:
            i -= 1
            continue
        j = i
        while j - 1 >= lo and speed[j - 1] < STILL_SPEED:
            j -= 1
        if i - j + 1 >= need:
            runs.append((j, i))
        i = j - 1
    return runs


def motion_start(seq: PoseSequence, peak: int, max_before_s: float = MAX_BEFORE_S) -> int:
    """投球の区間の始まり。ピークからさかのぼって、次の順に探す。

    1. 止まっていた区間のうち、そのあとで骨盤が DROP_M 以上後ろへ下がったもの（ドロップ前の構え）の最後のフレーム
    2. 構えが映っていなくても、さかのぼれる範囲でドロップしていれば、その範囲の最初
    3. ドロップのない投球（その場で投げるドリル）なら、ピークに近い静止を STILL_S だけ含めた所
    """
    speed = _pelvis_speed(seq)
    px = [p.x for p in pelvis_series(seq)]
    limit = max(0, peak - js_round(max_before_s * seq.fps))
    need = js_round(STILL_S * seq.fps)
    runs = _still_runs(speed, limit, peak, need)
    for _, last in runs:
        if px[last] - min(px[last : peak + 1]) >= DROP_M:
            return last
    if px[limit] - min(px[limit : peak + 1]) >= DROP_M:
        return limit
    if runs:
        first, last = runs[0]
        return max(first, last - need)
    return limit


def is_overhead(seq: PoseSequence, peak: int, min_conf: float = 0.3) -> bool:
    """ピークの前後 OVERHEAD_S のどこかで、投げる手首が肩より OVERHEAD 以上高いか。信頼度の低い関節は見ない"""
    w = js_round(OVERHEAD_S * seq.fps)
    for f in seq.frames[max(0, peak - w) : peak + w + 1]:
        wrist, shoulder = kp(f, "rWrist"), kp(f, "rShoulder")
        if wrist.c >= min_conf and shoulder.c >= min_conf and wrist.y - shoulder.y >= OVERHEAD * seq.height_m:
            return True
    return False


def peak_overhead_speed(seq: PoseSequence) -> float:
    """手首が肩より上にあるときの、投げる手首の速さの最大（身長/秒）。投球が見つからないときの手がかりにする"""
    speed = speed_series(seq, "rWrist")
    found = [speed[i] for i in range(len(speed)) if is_overhead(seq, i)]
    return max(found, default=0.0) / seq.height_m


def find_throws(
    seq: PoseSequence,
    min_peak: float = MIN_PEAK,
    min_gap_s: float = MIN_GAP_S,
    after_s: float = AFTER_S,
) -> list[RepWindow]:
    """投げる手首の速さのピークを、速い順に、近すぎるものを除いて選ぶ。seq は平滑化したものを渡す"""
    n = len(seq.frames)
    lead, tail = js_round(LEAD_S * seq.fps), js_round(TAIL_S * seq.fps)
    if n < lead + tail + 1:
        return []
    speed = speed_series(seq, "rWrist")
    floor = min_peak * seq.height_m
    peaks = [
        i
        for i in range(lead, n - tail)
        if speed[i] >= floor and speed[i] >= speed[i - 1] and speed[i] >= speed[i + 1] and is_overhead(seq, i)
    ]
    gap = js_round(min_gap_s * seq.fps)
    chosen: list[int] = []
    for i in sorted(peaks, key=lambda i: -speed[i]):
        if all(abs(i - j) >= gap for j in chosen):
            chosen.append(i)
    after = js_round(after_s * seq.fps)
    return [RepWindow(i, motion_start(seq, i), min(n - 1, i + after)) for i in sorted(chosen)]
