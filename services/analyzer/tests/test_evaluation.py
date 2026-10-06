"""精度の評価：正解の検査と、正解と解析の結果の比べ方"""

import io
import math
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from test_http import FakeModels
from test_throws_io_api import synth_track
from test_track_target import FakeDetector, FakePose, FakeVideo
from test_youtube_library import FakeFetcher, FakeGrabber

from film_coach.adapters.cli import print_evaluation
from film_coach.adapters.http import HttpDeps, create_app
from film_coach.application.evaluation import evaluate
from film_coach.application.jobs import JobRunner
from film_coach.domain.evaluation import (
    LABEL_JOINTS,
    Annotation,
    AnnotationError,
    FrameLabel,
    ThrowLabel,
    check_annotation,
    error_stats,
    frames_to_label,
    label_frame_world,
    metric_at,
    world_name,
)
from film_coach.domain.motion import Affine
from film_coach.domain.pose import PoseSequence
from film_coach.domain.world import WorldTransform
from film_coach.infrastructure.library_fs import FileAnnotationStore, FilePracticeStore, FileVideoStore
from film_coach.infrastructure.schema import validate

TF = WorldTransform(m_per_px=0.01, origin_x=100, ground_y=500, direction=1, ankle_m=0.07)


def label(frame: int, **points: tuple[float, float] | None) -> FrameLabel:
    return FrameLabel(frame, dict(points))  # type: ignore[arg-type]


# ---- ドメイン ----


def test_正解を付けるフレームは_区間の25_50_75パーセントと正解の瞬間() -> None:
    assert frames_to_label(10, 50, None) == [20, 30, 40]
    assert frames_to_label(10, 50, ThrowLabel(1, plant=30, release=44)) == [20, 30, 40, 44]
    assert frames_to_label(10, 50, ThrowLabel(1, plant=None, release=None)) == [20, 30, 40]


@pytest.mark.parametrize(
    ("annotation", "message"),
    [
        (Annotation("a", (), (label(200),), ""), "範囲外"),
        (Annotation("a", (), (label(1, lEye=(1, 1)),), ""), "関節ではありません"),
        (Annotation("a", (), (label(1, nose=(2000, 1)),), ""), "画像の外"),
        (Annotation("a", (), (label(1), label(1)), ""), "同じフレーム"),
        (Annotation("a", (ThrowLabel(9, None, None),), (), ""), "投球 9 はありません"),
        (Annotation("a", (ThrowLabel(1, 500, None),), (), ""), "範囲外"),
    ],
)
def test_映像の範囲や関節の名前が正しくない正解は受け付けない(annotation: Annotation, message: str) -> None:
    with pytest.raises(AnnotationError, match=message):
        check_annotation(annotation, frame_count=140, width=1920, height=1080, reps={1})


def test_見えない関節も_付けたことになる() -> None:
    points: dict[str, Any] = dict.fromkeys(LABEL_JOINTS, (1.0, 1.0))
    assert FrameLabel(1, {**points, "lAnkle": None}).done  # type: ignore[arg-type]
    assert not FrameLabel(1, {k: v for k, v in points.items() if k != "lAnkle"}).done  # type: ignore[arg-type]


def test_正解の骨格は_カメラの動きを打ち消してワールドに直し_左投げは左右を入れ替える() -> None:
    shift = Affine(tx=-20)  # このフレームではカメラが 20 px 動いていた
    f = label_frame_world(label(5, lWrist=(320, 300), rWrist=None), shift, TF, hand="left")
    # 左投げは、左の手首をワールドの「投げる腕（r）」として扱う
    w = f.kp[10]  # rWrist
    assert (w.x, w.y) == pytest.approx(((320 - 20 - 100) * 0.01, (500 - 300) * 0.01 + 0.07))
    assert math.isnan(f.kp[9].x)  # 見えない関節は NaN
    assert world_name("lWrist", "right") == "lWrist" and world_name("lWrist", "left") == "rWrist"


def test_1フレームで測る指標は_使う関節がそろっていなければ測らない() -> None:
    elbow = label(1, rShoulder=(100, 300), rElbow=(150, 300), rWrist=(150, 250))
    f = label_frame_world(elbow, None, TF, "right")
    assert metric_at(f, "elbowAngle", 1.8) == pytest.approx(90)
    assert metric_at(f, "trunkTilt", 1.8) is None


def test_誤差の要約は_絶対値の平均_中央値_90パーセント点と_閾値以内の割合() -> None:
    s = error_stats([1, -2, 3, 4, 20], thresholds=(5.0, 10.0))
    assert s is not None
    assert (s.n, s.mean, s.median, s.p90) == (5, 6.0, 3, 20)
    assert s.within == (0.8, 0.8)
    assert error_stats([]) is None


# ---- 保存と API ----


@pytest.fixture
def client(tmp_path: Path) -> tuple[TestClient, HttpDeps]:
    deps = HttpDeps(
        store=FileVideoStore(tmp_path / "library"),
        practices=FilePracticeStore(tmp_path / "practices"),
        grabber=FakeGrabber(),
        fetcher=FakeFetcher(),
        jobs=JobRunner(),
        models=FakeModels(),
        open_video=lambda _p: FakeVideo(),
        detector=FakeDetector,
        pose=FakePose,
        sink_for=None,
        allowed_origins=[],
        annotations=FileAnnotationStore(tmp_path / "annotations"),
    )
    return TestClient(create_app(deps)), deps


def analyzed(c: TestClient, deps: HttpDeps, seq: PoseSequence) -> dict[str, Any]:
    """横から撮った投球の合成データを追跡結果として置き、投球を解析した映像"""
    up = c.post("/api/videos", files={"file": ("IMG_0002.MOV", b"video", "video/quicktime")}).json()
    deps.store.save_track(up["id"], synth_track(seq))
    assert c.post(f"/api/videos/{up['id']}/throws", json={"heightCm": 180, "camera": "side"}).status_code == 200
    return up  # type: ignore[no-any-return]


def true_labels(deps: HttpDeps, video_id: str, frames: list[int], dx: float = 0.0) -> list[dict[str, Any]]:
    """追跡した骨格（モデルの出力）をそのまま正解にする。dx だけ横にずらせる"""
    track = deps.store.load_track(video_id)
    assert track is not None
    names = ["nose", "lEye", "rEye", "lEar", "rEar", *LABEL_JOINTS[1:]]
    out = []
    for f in frames:
        kps = track.frames[f].keypoints or []
        out.append(
            {"frame": f, "points": {n: [kps[i][0] + dx, kps[i][1]] for i, n in enumerate(names) if n in LABEL_JOINTS}}
        )
    return out


def test_正解を付けられるのは_投球まで解析した自分の映像だけ(
    client: tuple[TestClient, HttpDeps], base_sequence: PoseSequence
) -> None:
    c, deps = client
    c.post("/api/videos", files={"file": ("IMG_0001.MOV", b"video", "video/quicktime")})  # 投球を解析していない
    up = analyzed(c, deps, base_sequence)
    data = c.get("/api/evaluation").json()
    validate("evaluation.v1.schema.json", data)
    assert [t["video"]["id"] for t in data["targets"]] == [up["id"]]
    t = data["targets"][0]["throws"][0]
    assert len(t["frames"]) == 3 and t["start"] <= t["plant"] < t["release"] <= t["end"]
    assert data["report"]["joints"]["raw"] is None  # 正解がまだない


def test_正解を保存し_関節と瞬間と指標の誤差を求める(
    client: tuple[TestClient, HttpDeps], base_sequence: PoseSequence
) -> None:
    c, deps = client
    up = analyzed(c, deps, base_sequence)
    t = c.get("/api/evaluation").json()["targets"][0]["throws"][0]
    # 正解の瞬間：接地は解析と同じ、リリースは解析より 2 フレーム前
    throws = [{"rep": t["rep"], "plant": t["plant"], "release": t["release"] - 2}]
    frames = sorted({*t["frames"], t["plant"], t["release"] - 2})
    body = {"throws": throws, "frames": true_labels(deps, up["id"], frames, dx=10)}
    res = c.put(f"/api/videos/{up['id']}/annotation", json=body)
    assert res.status_code == 200, res.text
    validate("annotation.v1.schema.json", res.json())

    data = c.get("/api/evaluation").json()
    validate("evaluation.v1.schema.json", data)
    report = data["report"]
    assert (report["videos"], report["throws"], report["frames"]) == (1, 1, len(frames))
    # モデルの出力から横に 10 px ずらした正解なので、raw の誤差はどの関節も 10 px（cm に直した値）
    m_per_px = deps.store.load_throws(up["id"]).reps[0].transform.m_per_px  # type: ignore[union-attr]
    raw = report["joints"]["raw"]
    assert raw["mean"] == pytest.approx(10 * m_per_px * 100, rel=1e-3) and raw["p90"] == pytest.approx(
        raw["mean"], rel=1e-3
    )
    assert report["joints"]["final"]["n"] == len(frames) * len(LABEL_JOINTS)
    # 瞬間：接地は 0 ms、リリースは解析が 2 フレーム遅い
    events = {e["event"]: e for e in report["details"]["events"]}
    assert events["plant"]["frames"] == 0 and events["release"]["frames"] == 2
    fps = data["targets"][0]["video"]["fps"]
    assert events["release"]["ms"] == pytest.approx(2 / fps * 1000, abs=0.1)
    # 指標：1 フレームで測る 6 つ。横にずらしただけなので、角度は骨格の誤差による分がほぼない
    metrics = {e["metric"]: e for e in report["details"]["metrics"]}
    assert set(metrics) == {"strideRatio", "frontKnee", "elbowHeight", "elbowAngle", "releaseHeight", "trunkTilt"}
    assert report["metrics"]["frontKnee"]["pose"]["mean"] < 5
    # CLI は、同じ結果を README に載せる表にする
    assert deps.annotations is not None
    text = io.StringIO()
    print_evaluation(evaluate(deps.store, deps.annotations), text)
    assert "| モデルの出力 |" in text.getvalue() and "| リリース |" in text.getvalue()


def test_受け付けない正解は400_正解を付けられない映像は409(
    client: tuple[TestClient, HttpDeps], base_sequence: PoseSequence
) -> None:
    c, deps = client
    up = analyzed(c, deps, base_sequence)
    res = c.put(f"/api/videos/{up['id']}/annotation", json={"throws": [], "frames": [{"frame": 99999, "points": {}}]})
    assert res.status_code == 400 and "範囲外" in res.json()["detail"]
    plain = c.post("/api/videos", files={"file": ("IMG_0003.MOV", b"video", "video/quicktime")}).json()
    assert c.put(f"/api/videos/{plain['id']}/annotation", json={"throws": [], "frames": []}).status_code == 409


def test_フレーム番号で元の映像のフレームを返す(
    client: tuple[TestClient, HttpDeps], base_sequence: PoseSequence
) -> None:
    c, deps = client
    up = analyzed(c, deps, base_sequence)
    res = c.get(f"/api/videos/{up['id']}/frame", params={"i": 42, "maxWidth": 1920})
    assert res.status_code == 200 and res.content.endswith(b"frame42")
