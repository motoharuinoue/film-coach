"""画面（TypeScript）と共有する API の応答の見本。

UPDATE_FIXTURES=1 のときは packages/schema/fixtures/api-samples.v1.json を作り直す。
TypeScript 側（apps/web/src/infrastructure/http/contract.test.ts）は、この見本が JSON Schema に
合うことと、画面の読み込み処理が正しく読めることを確かめる。
"""

import itertools
import json
import os
import re
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from test_http import FakeModels, events
from test_throws_io_api import synth_track
from test_track_target import FakeDetector, FakeMotion, FakePose, FakeShots, FakeVideo
from test_youtube_library import FakeFetcher, FakeGrabber
from test_youtube_search import NOW, FakeSearch

from film_coach.adapters.http import HttpDeps, create_app
from film_coach.application import library
from film_coach.application.jobs import JobRunner
from film_coach.domain.pose import PoseSequence
from film_coach.infrastructure.library_fs import FileDrillStore, FilePracticeStore, FileReferenceStore, FileVideoStore
from film_coach.infrastructure.youtube_api import FileQuotaLedger

REPO = Path(__file__).resolve().parents[3]
SAMPLES = REPO / "packages" / "schema" / "fixtures" / "api-samples.v1.json"


NUMBERS = re.compile(r"\[\n\s*(-?[\d.]+(?:[eE][-+]?\d+)?(?:,\n\s*-?[\d.]+(?:[eE][-+]?\d+)?)*)\n\s*\]")


def dump(data: dict[str, Any]) -> str:
    """数だけの配列（枠・関節の組）は 1 行にまとめて、見本の行数を抑える"""
    text = json.dumps(data, ensure_ascii=False, indent=1)
    return NUMBERS.sub(lambda m: "[" + ", ".join(v.strip() for v in m.group(1).split(",")) + "]", text)


def build(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, base_sequence: PoseSequence) -> dict[str, Any]:
    ids = itertools.count(1)
    monkeypatch.setattr(FileVideoStore, "new_id", lambda _self: f"{next(ids):012x}")
    monkeypatch.setattr(FilePracticeStore, "new_id", lambda _self: f"{next(ids):012x}")
    monkeypatch.setattr(FileReferenceStore, "new_id", lambda _self: f"{next(ids):012x}")
    monkeypatch.setattr(FileDrillStore, "new_id", lambda _self: f"{next(ids):012x}")
    monkeypatch.setattr(library, "_now", lambda: "2026-10-05T12:00:00+00:00")
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
        shots=lambda: FakeShots(50),  # 50 フレーム目で場面が変わる
        motion=FakeMotion,  # カメラが 1 フレームに 3 px ずつ振れる
        youtube=FakeSearch(),  # 架空の候補を返す
        quota=FileQuotaLedger(tmp_path / "quota.json"),
        clock=lambda: NOW,
        references=FileReferenceStore(tmp_path / "references"),
        drills=FileDrillStore(tmp_path / "drills"),
    )
    c = TestClient(create_app(deps))
    up = c.post("/api/videos", files={"file": ("IMG_0001.MOV", b"video", "video/quicktime")}).json()
    job = c.post(f"/api/videos/{up['id']}/track", json={"t": 10 / 30, "x": 185, "y": 400, "label": "#5"}).json()
    job_events = [{"event": k, "data": d} for k, d in events(c, job["events"])]
    yt = c.post("/api/videos/youtube", json={"url": "https://youtu.be/Qb7Throw_01", "start": 134, "end": 140}).json()
    yt_job = c.post(f"/api/videos/{yt['id']}/track", json={"t": 10 / 30, "x": 185, "y": 400}).json()
    events(c, yt_job["events"])
    # 投球の解析：横から撮った投球の合成データを、追跡結果として置いてから解析する
    side = c.post("/api/videos", files={"file": ("IMG_0002.MOV", b"video", "video/quicktime")}).json()
    deps.store.save_track(side["id"], synth_track(base_sequence))
    throws_request = {"heightCm": 180, "camera": "side"}
    throws = c.post(f"/api/videos/{side['id']}/throws", json=throws_request).json()
    # 練習：2 本の映像をまとめる
    practice_request = {
        "name": "投球ドリル",
        "date": "2026-10-05",
        "kind": "drill",
        "camera": "side",
        "memo": "",
        "videoIds": [side["id"], up["id"]],
    }
    practice = c.post("/api/practices", json=practice_request).json()
    # お手本：YouTube の区間を取り込み、お手本の選手の投球を解析してから登録する
    model = c.post("/api/videos/youtube", json={"url": "https://youtu.be/Qb7Throw_03", "start": 10, "end": 40}).json()
    deps.store.save_track(model["id"], synth_track(base_sequence))
    c.post(f"/api/videos/{model['id']}/throws", json={"heightCm": 188})
    reference_request = {"footageId": model["id"], "kind": "model", "trustedChannel": False, "playerHeightCm": 188}
    reference = c.post("/api/references", json=reference_request).json()
    # ドリル動画：検索の結果から、動画を取り込まずに登録する
    drill_request = {
        "youtubeId": "Qb7Drill_01",
        "title": "Step and Throw Drill",
        "channel": "QB Lab",
        "startSec": 95,
        "label": "ライン目印のステップ・アンド・スロー",
        "targets": [{"metric": "strideRatio", "side": "low"}, {"metric": "frontKnee", "side": "any"}],
    }
    drill = c.post("/api/drills", json=drill_request).json()
    return {
        "schemaVersion": 1,
        "generatedBy": "services/analyzer/tests/test_api_samples.py",
        "health": c.get("/api/health").json(),
        "uploadBeforeTrack": up,
        "upload": c.get(f"/api/videos/{up['id']}").json(),
        "youtube": c.get(f"/api/videos/{yt['id']}").json(),
        "track": c.get(f"/api/videos/{up['id']}/track").json(),
        "trackRequest": {"t": 10 / 30, "x": 185, "y": 400, "label": "#5"},
        "jobAccepted": job,
        # 進み具合は 1% ごとに出るので、見本は最初と最後の数件だけにする
        "jobEvents": job_events[:4] + job_events[-3:],
        "throwsRequest": throws_request,
        "throws": throws,
        "uploadWithThrows": c.get(f"/api/videos/{side['id']}").json(),
        "practiceRequest": practice_request,
        "practice": practice,
        "practices": c.get("/api/practices").json(),
        "referenceRequest": reference_request,
        "reference": reference,
        "references": c.get("/api/references").json(),
        "referenceFootage": c.get(f"/api/videos/{model['id']}").json(),
        "drillRequest": drill_request,
        "drill": drill,
        "drills": c.get("/api/drills").json(),
        "youtubeStatus": c.get("/api/youtube/status").json(),
        "youtubeSearch": c.get("/api/youtube/search", params={"q": "QB throwing mechanics", "max": 3}).json(),
    }


def test_API_の応答の見本が最新(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, base_sequence: PoseSequence) -> None:
    got = build(tmp_path, monkeypatch, base_sequence)
    if os.environ.get("UPDATE_FIXTURES"):
        SAMPLES.write_text(dump(got) + "\n", encoding="utf-8")
    assert json.loads(SAMPLES.read_text(encoding="utf-8")) == got, (
        "API の応答が変わりました。画面側も確かめてから UPDATE_FIXTURES=1 uv run pytest で作り直してください"
    )
