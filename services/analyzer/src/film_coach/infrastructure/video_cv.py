"""OpenCV による動画の読み込み、場面の切り替わりとカメラの動きの見積もり、確認用のプレビュー動画の書き出し。"""

from __future__ import annotations

import shutil
import subprocess
import tempfile
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import cv2
import numpy as np

from ..application.track_target import Frame, TargetFrame
from ..domain.library import VideoInfo
from ..domain.motion import Affine
from ..domain.tracking import Box

# 骨格の線（COCO-17 の関節番号の組）
BONES = [(5, 6), (11, 12), (5, 11), (6, 12), (5, 7), (7, 9), (6, 8), (8, 10), (11, 13), (13, 15), (12, 14), (14, 16)]
TURF = (157, 229, 46)  # BGR（#2EE59D）
PYLON = (26, 122, 255)  # BGR（#FF7A1A）


class OpenCvVideoReader:
    def __init__(self, path: Path) -> None:
        if not path.exists():
            raise FileNotFoundError(f"動画がありません：{path}")
        self.path = path

    def info(self) -> VideoInfo:
        cap = cv2.VideoCapture(str(self.path))
        try:
            return VideoInfo(
                name=self.path.name,
                fps=float(cap.get(cv2.CAP_PROP_FPS)),
                width=int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)),
                height=int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)),
                frame_count=int(cap.get(cv2.CAP_PROP_FRAME_COUNT)),
            )
        finally:
            cap.release()

    def frames(self) -> Iterator[tuple[int, Frame]]:
        cap = cv2.VideoCapture(str(self.path))
        try:
            i = 0
            while True:
                ok, img = cap.read()
                if not ok:
                    return
                yield i, img
                i += 1
        finally:
            cap.release()


MIN_CONTRAST = 4.0
"""形を比べるのに要る濃淡（白黒 0〜255 の標準偏差）"""


class OpenCvShotDetector:
    """場面の切り替わり（カット）を、前のフレームからの急な変化で見つける。

    次の 2 つのどちらかが大きければカットとみなす。
    - 色の分布：縮小したフレームの HSV ヒストグラム（色相 × 彩度）の Bhattacharyya 距離
    - 形：ごく小さく縮めた白黒の画像（明るさをそろえる）の 1 − 相関。同じ競技場の別の画角のように、
      色がほとんど同じ場面どうしの切り替わりを拾う。カメラを速く振っても、この大きさでは形はあまり崩れない
    真っ暗な画面のように濃淡がほとんどない画では形を比べられないので、色だけで判断する。
    フラッシュなどの一瞬の変化で切りすぎないよう、前のカットから min_frames フレーム未満では切らない。
    クロスフェードなどのゆっくりした切り替わりは見つけられない。
    """

    def __init__(self, color: float = 0.5, shape: float = 0.4, min_frames: int = 8) -> None:
        self.color = color
        self.shape = shape
        self.min_frames = min_frames
        self._prev: tuple[Any, Any] | None = None
        self._since = 0

    def change(self, frame: Frame) -> tuple[float, float]:
        """前のフレームからの (色の変化, 形の変化)。最初のフレームでは (0, 0)"""
        img = np.asarray(frame)
        small = cv2.resize(img, (96, 96), interpolation=cv2.INTER_AREA)
        hist = cv2.calcHist([cv2.cvtColor(small, cv2.COLOR_BGR2HSV)], [0, 1], None, [30, 32], [0, 180, 0, 256])
        cv2.normalize(hist, hist)
        tiny = cv2.resize(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY), (24, 24), interpolation=cv2.INTER_AREA)
        gray = tiny.astype(np.float32)
        std = float(gray.std())
        g = (gray - gray.mean()) / std if std >= MIN_CONTRAST else None
        prev, self._prev = self._prev, (hist, g)
        if prev is None:
            return 0.0, 0.0
        color = float(cv2.compareHist(prev[0], hist, cv2.HISTCMP_BHATTACHARYYA))
        shape = 0.0 if prev[1] is None or g is None else 1.0 - float(np.mean(prev[1] * g))
        return color, shape

    def is_cut(self, frame: Frame) -> bool:
        color, shape = self.change(frame)
        self._since += 1
        if (color >= self.color or shape >= self.shape) and self._since >= self.min_frames:
            self._since = 0
            return True
        return False


class OpenCvCameraMotion:
    """カメラの動きを、人の映っていない背景の点の動きから見積もる（手持ちで追いかける、ズームする映像のため）。

    1 つ前のフレームで背景の角（特徴点）を選び、Lucas-Kanade のオプティカルフローで今のフレームまで追い、
    RANSAC で相似変換（回転・拡大・平行移動）を当てはめる。人の枠（少し広げた範囲）の点は使わない。
    計算は縮小した白黒の画像で行い、結果は元の大きさの座標に直す。
    """

    def __init__(self, width: int = 960, max_points: int = 400, min_points: int = 20) -> None:
        self.width = width
        self.max_points = max_points
        self.min_points = min_points
        self._prev: tuple[Any, Any] | None = None

    def _mask(self, shape: tuple[int, int], people: list[Box], scale: float) -> Any:
        mask = np.full(shape, 255, np.uint8)
        for b in people:
            pad = 0.1 * (b.y2 - b.y1)
            x1, y1 = int((b.x1 - pad) * scale), int((b.y1 - pad) * scale)
            x2, y2 = int((b.x2 + pad) * scale), int((b.y2 + pad) * scale)
            mask[max(0, y1) : max(0, y2), max(0, x1) : max(0, x2)] = 0
        return mask

    def step(self, frame: Frame, people: list[Box]) -> Affine | None:
        img = np.asarray(frame)
        scale = self.width / img.shape[1]
        gray = cv2.cvtColor(cv2.resize(img, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2GRAY)
        mask = self._mask(gray.shape, people, scale)
        prev, self._prev = self._prev, (gray, mask)
        if prev is None:
            return None
        pts = cv2.goodFeaturesToTrack(prev[0], self.max_points, 0.01, 8, mask=prev[1])
        if pts is None or len(pts) < self.min_points:
            return None
        nxt, status, _ = cv2.calcOpticalFlowPyrLK(prev[0], gray, pts, pts.copy())
        ok = status.ravel() == 1
        if int(ok.sum()) < self.min_points:
            return None
        # 今のフレームの点 → 1 つ前のフレームの点
        m, _ = cv2.estimateAffinePartial2D(nxt[ok], pts[ok], method=cv2.RANSAC, ransacReprojThreshold=2.0)
        if m is None:
            return None
        (a, b, tx), (c, d, ty) = m.tolist()
        return Affine(a, b, tx / scale, c, d, ty / scale)


class _Mp4Writer:
    """一時ファイルに mp4v で書き、閉じるときに ffmpeg で H.264 にする（ブラウザでも再生できるように）"""

    def __init__(self, dest: Path, fps: float, size: tuple[int, int]) -> None:
        self.dest = dest
        self._tmp = Path(tempfile.mkdtemp()) / dest.name
        fourcc: Any = cv2.VideoWriter.fourcc(*"mp4v")
        self._out = cv2.VideoWriter(str(self._tmp), fourcc, fps, size)

    def write(self, img: Any) -> None:
        self._out.write(img)

    def close(self) -> None:
        self._out.release()
        self.dest.parent.mkdir(parents=True, exist_ok=True)
        if shutil.which("ffmpeg"):
            cmd = [
                "ffmpeg",
                "-v",
                "error",
                "-y",
                "-i",
                str(self._tmp),
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-crf",
                "23",
            ]
            # 固定の引数だけで呼ぶ
            subprocess.run([*cmd, "-movflags", "+faststart", str(self.dest)], check=True)
        else:
            shutil.move(self._tmp, self.dest)
        shutil.rmtree(self._tmp.parent, ignore_errors=True)


def draw_target(img: Any, result: TargetFrame, label: str, min_conf: float = 0.3, scale: float = 1.0) -> None:
    """対象選手の枠・名前・骨格を描く"""
    if result.box is not None:
        b = result.box
        cv2.rectangle(img, (int(b.x1), int(b.y1)), (int(b.x2), int(b.y2)), PYLON, max(1, int(3 * scale)))
        # 補間した枠は「*」を付けて区別する（Hershey フォントは英数字だけ）
        text = label + (" *" if result.interpolated else "")
        org = (int(b.x1), max(20, int(b.y1) - 10))
        cv2.putText(img, text, org, cv2.FONT_HERSHEY_SIMPLEX, 0.9 * scale, PYLON, max(1, int(2 * scale)), cv2.LINE_AA)
    if result.keypoints is not None:
        pts = result.keypoints
        for a, c in BONES:
            if pts[a][2] >= min_conf and pts[c][2] >= min_conf:
                pa = (int(pts[a][0]), int(pts[a][1]))
                pc = (int(pts[c][0]), int(pts[c][1]))
                cv2.line(img, pa, pc, TURF, max(1, int(3 * scale)), cv2.LINE_AA)
        for x, y, conf in pts[5:]:
            if conf >= min_conf:
                cv2.circle(img, (int(x), int(y)), max(2, int(4 * scale)), TURF, -1, cv2.LINE_AA)


def draw_stamp(img: Any, result: TargetFrame, scale: float = 1.0) -> None:
    stamp = f"{result.t:6.2f}s  frame {result.index:4d}"
    cv2.putText(
        img,
        stamp,
        (int(24 * scale), int(48 * scale)),
        cv2.FONT_HERSHEY_SIMPLEX,
        1.1 * scale,
        (255, 255, 255),
        2,
        cv2.LINE_AA,
    )


class PreviewVideoWriter:
    """映像全体に、対象選手の枠と骨格を重ねた動画"""

    def __init__(self, dest: Path, info: VideoInfo, label: str = "TARGET", min_conf: float = 0.3) -> None:
        self.label = label
        self.min_conf = min_conf
        self._mp4 = _Mp4Writer(dest, info.fps, (info.width, info.height))

    def write(self, frame: Frame, result: TargetFrame) -> None:
        img = np.asarray(frame).copy()
        draw_target(img, result, self.label, self.min_conf)
        draw_stamp(img, result)
        self._mp4.write(img)

    def close(self) -> None:
        self._mp4.close()


class FocusVideoWriter:
    """対象選手を追いかけて切り出した動画（フォロー撮影のように見せる）。

    切り出す範囲は枠の高さの 2.6 倍の正方形。中心と大きさは指数移動平均でならして、揺れを抑える。
    """

    def __init__(
        self, dest: Path, info: VideoInfo, label: str = "TARGET", size: int = 720, smooth: float = 0.15
    ) -> None:
        self.label = label
        self.size = size
        self.smooth = smooth
        self.width, self.height = info.width, info.height
        self._state: tuple[float, float, float] | None = None
        self._mp4 = _Mp4Writer(dest, info.fps, (size, size))

    def _window(self, result: TargetFrame) -> tuple[int, int, int]:
        if result.box is not None:
            b = result.box
            target = (b.cx, b.cy, min(self.height, max(240.0, b.h * 2.6)))
            if self._state is None:
                self._state = target
            else:
                (sx, sy, ss), (tx, ty, ts), a = self._state, target, self.smooth
                self._state = (sx + a * (tx - sx), sy + a * (ty - sy), ss + a * (ts - ss))
        cx, cy, side = self._state or (self.width / 2, self.height / 2, float(self.height))
        half = side / 2
        x0 = int(min(max(0.0, cx - half), self.width - side))
        y0 = int(min(max(0.0, cy - half), self.height - side))
        return x0, y0, int(side)

    def write(self, frame: Frame, result: TargetFrame) -> None:
        img = np.asarray(frame).copy()
        draw_target(img, result, self.label)
        x0, y0, side = self._window(result)
        crop = cv2.resize(img[y0 : y0 + side, x0 : x0 + side], (self.size, self.size), interpolation=cv2.INTER_CUBIC)
        draw_stamp(crop, result, scale=0.7)
        self._mp4.write(crop)

    def close(self) -> None:
        self._mp4.close()


class OpenCvFrameGrabber:
    """FrameGrabber の実装：動画の情報と、指定した時刻のフレーム（JPEG）"""

    def probe(self, path: Path) -> VideoInfo:
        info = OpenCvVideoReader(path).info()
        if info.fps <= 0 or info.frame_count <= 0 or info.width <= 0:
            raise ValueError("フレームを読めません")
        return info

    def jpeg_at(self, path: Path, t: float, max_width: int = 1280) -> bytes:
        cap = cv2.VideoCapture(str(path))
        try:
            cap.set(cv2.CAP_PROP_POS_MSEC, max(0.0, t) * 1000)
            ok, img = cap.read()
        finally:
            cap.release()
        if not ok:
            raise ValueError(f"{t:.2f} 秒のフレームを読めません")
        return _jpeg(img, max_width)

    def jpeg_of_frame(self, path: Path, index: int, max_width: int = 1280) -> bytes:
        # 時刻やフレーム番号での移動は、動画の形式によって前後のフレームにずれることがあるので、先頭から順に読む
        cap = cv2.VideoCapture(str(path))
        try:
            ok = all(cap.grab() for _ in range(index))
            ok, img = cap.read() if ok else (False, None)
        finally:
            cap.release()
        if not ok or img is None:
            raise ValueError(f"{index} 番目のフレームを読めません")
        return _jpeg(img, max_width)


def _jpeg(img: Any, max_width: int) -> bytes:
    h, w = img.shape[:2]
    if w > max_width:
        img = cv2.resize(img, (max_width, int(h * max_width / w)), interpolation=cv2.INTER_AREA)
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 85])
    if not ok:
        raise ValueError("JPEG に変換できませんでした")
    return bytes(buf.tobytes())


HEAD = (0, 1, 2, 3, 4)
"""顔の関節（鼻・両目・両耳）"""


def body_mask(shape: tuple[int, int], result: TargetFrame, min_conf: float = 0.3) -> Any:
    """本人の体の形（手足の線・胴体・頭・ボールを持つ手のまわり）。骨格がなければ枠。どちらもなければ空"""
    h, w = shape
    mask = np.zeros((h, w), np.uint8)
    b = result.box
    if b is None:
        return mask
    pts = result.keypoints
    if pts is None or sum(c >= min_conf for _, _, c in pts) < 8:
        cv2.rectangle(mask, (int(b.x1), int(b.y1)), (int(b.x2), int(b.y2)), 255, -1)
        return mask
    thick = max(6, int(b.h * 0.11))
    ok = [c >= min_conf for _, _, c in pts]
    xy = [(int(x), int(y)) for x, y, _ in pts]
    for a, c in BONES:
        if ok[a] and ok[c]:
            cv2.line(mask, xy[a], xy[c], 255, thick, cv2.LINE_AA)
    torso = [xy[i] for i in (5, 6, 12, 11) if ok[i]]
    if len(torso) >= 3:
        cv2.fillPoly(mask, [np.array(torso, np.int32)], 255)
    head = [xy[i] for i in HEAD if ok[i]]
    if head:
        cx, cy = np.mean(head, axis=0)
        cv2.circle(mask, (int(cx), int(cy)), max(8, int(b.h * 0.1)), 255, -1)
    # 手首（ボール）と足首（足）のまわり
    for i, r in ((9, 0.09), (10, 0.09), (15, 0.06), (16, 0.06)):
        if ok[i]:
            cv2.circle(mask, xy[i], max(6, int(b.h * r)), 255, -1)
    return mask


def anonymize_frame(img: Any, result: TargetFrame, min_conf: float = 0.3) -> Any:
    """本人の体の外（背景と周りの人）を強くぼかし、本人の顔をモザイクにする。本人を見失ったら全体をぼかす"""
    h, w = img.shape[:2]
    # 小さくしてからぼかすと、強くぼかしても速い
    small = cv2.resize(img, (max(1, w // 8), max(1, h // 8)), interpolation=cv2.INTER_AREA)
    blurred = cv2.resize(cv2.GaussianBlur(small, (0, 0), 6), (w, h), interpolation=cv2.INTER_LINEAR)
    b = result.box
    if b is None:
        return blurred
    # 境目はなめらかにつなぐ
    mask = cv2.GaussianBlur(body_mask((h, w), result, min_conf).astype(np.float32) / 255, (0, 0), max(2.0, b.h * 0.02))[
        ..., None
    ]
    out = (img * mask + blurred * (1 - mask)).astype(np.uint8)
    # 顔：信頼できる顔の関節の中心。なければ枠の上の方
    pts = [(x, y) for x, y, c in (result.keypoints[i] for i in HEAD) if c >= min_conf] if result.keypoints else []
    if pts:
        cx, cy = float(np.mean([p[0] for p in pts])), float(np.mean([p[1] for p in pts]))
    else:
        cx, cy = b.cx, b.y1 + b.h * 0.09
    r = max(8, int(b.h * 0.085))
    x1, y1, x2, y2 = max(0, int(cx - r)), max(0, int(cy - r)), min(w, int(cx + r)), min(h, int(cy + r))
    if x2 > x1 and y2 > y1:
        face = out[y1:y2, x1:x2]
        tiny = cv2.resize(face, (max(1, (x2 - x1) // 10), max(1, (y2 - y1) // 10)), interpolation=cv2.INTER_AREA)
        mosaic = cv2.resize(tiny, (x2 - x1, y2 - y1), interpolation=cv2.INTER_NEAREST)
        disc = np.zeros(face.shape[:2], np.uint8)
        cv2.circle(disc, (int(cx) - x1, int(cy) - y1), r, 255, -1)
        face[disc > 0] = mosaic[disc > 0]
    return out


class AnonymizedVideoWriter:
    """本人以外と顔をぼかした動画（公開用）。H.264 の mp4 で書き出す"""

    def __init__(self, dest: Path, info: VideoInfo) -> None:
        self._mp4 = _Mp4Writer(dest, info.fps, (info.width, info.height))

    def write(self, frame: Frame, result: TargetFrame) -> None:
        self._mp4.write(anonymize_frame(np.asarray(frame), result))

    def close(self) -> None:
        self._mp4.close()
