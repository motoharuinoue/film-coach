"""画面（TypeScript）と共有する API の応答の見本。

UPDATE_FIXTURES=1 のときは packages/schema/fixtures/api-samples.v1.json を作り直す。
TypeScript 側（apps/web/src/infrastructure/http/contract.test.ts）は、この見本が JSON Schema に
合うことと、画面の読み込み処理が正しく読めることを確かめる。
"""

import itertools
import json
import os
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from test_http import FakeModels, events
from test_track_target import FakeDetector, FakePose, FakeShots, FakeVideo
from test_youtube_library import FakeFetcher, FakeGrabber

from film_coach.adapters.http import HttpDeps, create_app
from film_coach.application import library
from film_coach.application.jobs import JobRunner
from film_coach.infrastructure.library_fs import FileVideoStore

REPO = Path(__file__).resolve().parents[3]
SAMPLES = REPO / "packages" / "schema" / "fixtures" / "api-samples.v1.json"


def build(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    ids = itertools.count(1)
    monkeypatch.setattr(FileVideoStore, "new_id", lambda _self: f"{next(ids):012x}")
    monkeypatch.setattr(library, "_now", lambda: "2026-10-05T12:00:00+00:00")
    deps = HttpDeps(
        store=FileVideoStore(tmp_path / "library"),
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
    )
    c = TestClient(create_app(deps))
    up = c.post("/api/videos", files={"file": ("IMG_0001.MOV", b"video", "video/quicktime")}).json()
    job = c.post(f"/api/videos/{up['id']}/track", json={"t": 10 / 30, "x": 185, "y": 400, "label": "#5"}).json()
    job_events = [{"event": k, "data": d} for k, d in events(c, job["events"])]
    yt = c.post("/api/videos/youtube", json={"url": "https://youtu.be/Qb7Throw_01", "start": 134, "end": 140}).json()
    yt_job = c.post(f"/api/videos/{yt['id']}/track", json={"t": 10 / 30, "x": 185, "y": 400}).json()
    events(c, yt_job["events"])
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
    }


def test_API_の応答の見本が最新(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    got = build(tmp_path, monkeypatch)
    if os.environ.get("UPDATE_FIXTURES"):
        SAMPLES.write_text(json.dumps(got, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    assert json.loads(SAMPLES.read_text(encoding="utf-8")) == got, (
        "API の応答が変わりました。画面側も確かめてから UPDATE_FIXTURES=1 uv run pytest で作り直してください"
    )
