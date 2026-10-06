"""投球の解析の保存・API・CLI。合成データを画像に写した追跡結果を使う（モデルも動画もいらない）。"""

import io
import json
from dataclasses import replace
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from test_http import FakeModels
from test_throws import project, track_of
from test_track_target import FakeDetector, FakePose, FakeVideo
from test_youtube_library import FakeFetcher, FakeGrabber

from film_coach.adapters.cli import run
from film_coach.adapters.http import HttpDeps, create_app
from film_coach.application.jobs import JobRunner
from film_coach.application.library import analyze_footage_throws, import_upload
from film_coach.application.throws import analyze_throws
from film_coach.application.track_target import TargetTrack
from film_coach.bootstrap import cli_deps
from film_coach.domain.pose import PoseSequence
from film_coach.infrastructure.json_throws import throws_to_json
from film_coach.infrastructure.json_track import read_track, track_from_json, track_to_json, write_track
from film_coach.infrastructure.library_fs import FilePracticeStore, FileVideoStore
from film_coach.infrastructure.schema import validate


def synth_track(seq: PoseSequence) -> TargetTrack:
    rep = project(seq, direction=-1)
    return track_of([rep[0]] * 60 + rep + [rep[-1]] * 30, seq.fps)


# ---- 保存 ----


def test_追跡結果はJSONから読み戻せる_場面の切り替わりがない古い形も読める(base_sequence: PoseSequence) -> None:
    tt = synth_track(base_sequence)
    data = track_to_json(replace(tt, cuts=[150]))
    back = track_from_json(data)
    assert back.cuts == [150] and len(back.frames) == len(tt.frames)
    want = [(round(x, 2), round(y, 2), round(c, 3)) for x, y, c in tt.frames[70].keypoints or []]
    assert back.frames[70].keypoints == pytest.approx(want)
    old = {k: v for k, v in data.items() if k != "cuts"}
    assert track_from_json(old).cuts == []


def test_投球の解析はスキーマに合うJSONになる(base_sequence: PoseSequence) -> None:
    data = throws_to_json(analyze_throws(synth_track(base_sequence), 1.8))
    validate("throw-analysis.v1.schema.json", data)  # 骨格の列は pose-sequence.v1 を参照して検証する
    rep = data["reps"][0]
    assert data["hand"] == "right" and rep["transform"]["direction"] == -1
    assert abs(rep["start"] - 60) <= 2 and set(rep["metrics"]) >= {"strideRatio", "frontKnee", "elbowAngle"}
    assert rep["sequence"]["space"] == "world-2d"


def test_追跡をやり直したら_前の投球の解析は消す(tmp_path: Path, base_sequence: PoseSequence) -> None:
    store = FileVideoStore(tmp_path)
    r = import_upload(store, FakeGrabber(), "a.mp4", io.BytesIO(b"v"))
    store.save_track(r.id, synth_track(base_sequence))
    analyze_footage_throws(store, r.id, 1.8)
    assert store.throws_path(r.id) is not None
    store.save_track(r.id, synth_track(base_sequence))
    assert store.throws_path(r.id) is None


# ---- HTTP ----


@pytest.fixture
def api(tmp_path: Path) -> tuple[TestClient, FileVideoStore]:
    store = FileVideoStore(tmp_path / "library")
    deps = HttpDeps(
        store=store,
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
    )
    return TestClient(create_app(deps)), store


def test_追跡した骨格から投球を解析し_記録にリンクを添える(
    api: tuple[TestClient, FileVideoStore], base_sequence: PoseSequence
) -> None:
    client, store = api
    vid = client.post("/api/videos", files={"file": ("a.mov", b"v", "video/quicktime")}).json()["id"]
    assert client.post(f"/api/videos/{vid}/throws", json={"heightCm": 180}).status_code == 409  # まだ追跡していない
    assert client.get(f"/api/videos/{vid}/throws").status_code == 404
    store.save_track(vid, synth_track(base_sequence))
    res = client.post(f"/api/videos/{vid}/throws", json={"heightCm": 180})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["heightM"] == 1.8 and len(body["reps"]) == 1
    assert client.get(f"/api/videos/{vid}").json()["links"]["throws"] == f"/api/videos/{vid}/throws"
    got = client.get(f"/api/videos/{vid}/throws")
    assert got.json() == body
    # 計算し直すと中身が変わるので、ブラウザには使うたびに確かめさせる
    assert got.headers["cache-control"] == "no-cache" and got.headers["etag"]
    assert client.get(f"/api/videos/{vid}/track").headers["cache-control"] == "no-cache"
    assert body["approachMode"] == "auto" and body["reps"][0]["approach"]["kind"] == "drop"
    fixed = client.post(f"/api/videos/{vid}/throws", json={"heightCm": 180, "approach": "standing"}).json()
    assert fixed["approachMode"] == "standing" and fixed["reps"][0]["approach"]["kind"] == "standing"
    assert client.post(f"/api/videos/{vid}/throws", json={"heightCm": 180, "approach": "run"}).status_code == 422


def test_身長の範囲外と_骨格から縮尺を出せない映像は断る(api: tuple[TestClient, FileVideoStore]) -> None:
    client, _ = api
    vid = client.post("/api/videos", files={"file": ("a.mov", b"v", "video/quicktime")}).json()["id"]
    assert client.post(f"/api/videos/{vid}/throws", json={"heightCm": 18}).status_code == 422
    # フェイクの骨格推定は全部の関節を枠の中心に置くので、体の長さが測れない
    client.post(f"/api/videos/{vid}/track", json={"t": 10 / 30, "x": 185, "y": 400})
    client.get("/api/jobs/job-1/events")
    res = client.post(f"/api/videos/{vid}/throws", json={"heightCm": 180})
    assert res.status_code == 422 and "縮尺" in res.json()["detail"]


# ---- CLI ----


def test_CLIのthrowsで投球と指標を書き出す(tmp_path: Path, base_sequence: PoseSequence) -> None:
    src = tmp_path / "track.json"
    write_track(synth_track(base_sequence), src)
    assert read_track(src).video.fps == 60
    out = io.StringIO()
    assert run(["throws", str(src), "--height", "180"], cli_deps(), out) == 0
    text = out.getvalue()
    assert "右投げ、投球 1 本" in text and "ステップ幅（身長比）" in text
    assert "投げ始め         ドロップから（下がった距離" in text
    assert run(["throws", str(src), "--height", "180", "--approach", "standing"], cli_deps(), io.StringIO()) == 0
    fixed = json.loads((tmp_path / "throws.json").read_text(encoding="utf-8"))
    assert fixed["reps"][0]["approach"]["kind"] == "standing"
    write_track(synth_track(base_sequence), src)
    assert run(["throws", str(src), "--height", "180"], cli_deps(), io.StringIO()) == 0
    data = json.loads((tmp_path / "throws.json").read_text(encoding="utf-8"))
    assert len(data["reps"]) == 1
