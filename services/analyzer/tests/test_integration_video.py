"""実際の動画とモデルで通す確認。どちらも git の管理外なので、手元にあるときだけ動く（CI では飛ばす）。

uv run pytest -m integration
"""

from pathlib import Path

import pytest

from film_coach.infrastructure.models import MODELS, onnx_path
from film_coach.infrastructure.paths import data_dir

VIDEO = data_dir() / "videos" / "IMG_8212.MOV"

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(
        not VIDEO.exists() or not all(onnx_path(m).exists() for m in MODELS.values()),
        reason="data/videos/IMG_8212.MOV とモデル（film-coach models download）が必要",
    ),
]


def test_実際の動画で指した選手を最後まで追う(tmp_path: Path) -> None:
    from film_coach.application.track_target import TargetHint, track_target
    from film_coach.infrastructure.rtm import RtmPersonDetector, RtmPoseEstimator
    from film_coach.infrastructure.video_cv import OpenCvVideoReader

    tt = track_target(OpenCvVideoReader(VIDEO), RtmPersonDetector(), RtmPoseEstimator(), TargetHint(1440, 430, 5.0))
    assert tt.coverage > 0.95
    # 5 秒の時点の枠は、目で確かめた対象選手の位置（1401〜1478, 343〜523）と重なる
    box = tt.frames[150].box
    assert box is not None and box.contains(1440, 430)
    # 骨格の信頼度：頭から足まで映っているので、平均は 0.5 を超える
    confs = [c for f in tt.frames if f.keypoints for _, _, c in f.keypoints]
    assert sum(confs) / len(confs) > 0.5
