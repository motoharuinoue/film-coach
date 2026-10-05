"""人物検出（YOLOX）と骨格推定（RTMPose）の実装。rtmlib の前処理・推論を使う。

rtmlib の YOLOX は検出の信頼度を捨てて枠だけを返すので、追跡に使う信頼度を残すため
推論結果をここで取り出す。CoreML は YOLOX で出力の形が合わず失敗するので CPU で動かす。
"""

from __future__ import annotations

from typing import Any

import numpy as np
from rtmlib import YOLOX, RTMPose

from ..application.track_target import Frame, ImageKeypoint
from ..domain.tracking import Box
from .models import MODELS, require


class RtmPersonDetector:
    def __init__(self, min_score: float = 0.3, device: str = "cpu") -> None:
        spec = MODELS["detector"]
        self._det: Any = YOLOX(
            str(require(spec)), model_input_size=spec.input_size, backend="onnxruntime", device=device
        )
        self.min_score = min_score

    def detect(self, frame: Frame) -> list[Box]:
        img = np.asarray(frame)
        x, ratio = self._det.preprocess(img)
        out = np.asarray(self._det.inference(x)[0])
        if out.ndim != 3 or out.shape[-1] != 5:
            raise RuntimeError(f"想定外の検出結果の形です：{out.shape}（NMS 込みの ONNX を使ってください）")
        boxes = out[0, :, :4] / ratio
        scores = out[0, :, 4]
        return [
            Box(float(b[0]), float(b[1]), float(b[2]), float(b[3]), float(s))
            for b, s in zip(boxes, scores, strict=True)
            if s >= self.min_score and b[2] > b[0] and b[3] > b[1]
        ]


class RtmPoseEstimator:
    def __init__(self, device: str = "cpu") -> None:
        spec = MODELS["pose"]
        self._pose: Any = RTMPose(
            str(require(spec)), model_input_size=spec.input_size, backend="onnxruntime", device=device
        )

    def estimate(self, frame: Frame, box: Box) -> list[ImageKeypoint]:
        kps, scores = self._pose(np.asarray(frame), bboxes=[[box.x1, box.y1, box.x2, box.y2]])
        # RTMPose の信頼度（SimCC）は 0〜1 を超えることがあるので、0〜1 に収める
        return [(float(x), float(y), float(min(1.0, max(0.0, c)))) for (x, y), c in zip(kps[0], scores[0], strict=True)]
