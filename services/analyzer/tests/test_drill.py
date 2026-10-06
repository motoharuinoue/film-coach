"""ドリル動画の規則・保存・API。動画は取り込まない。"""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from test_http import FakeModels
from test_track_target import FakeDetector, FakePose, FakeVideo
from test_youtube_library import FakeFetcher, FakeGrabber

from film_coach.adapters.http import HttpDeps, create_app
from film_coach.application.drill import create_drill, delete_drill, list_drills
from film_coach.application.jobs import JobRunner
from film_coach.application.library import NotFoundError
from film_coach.domain.drill import MAX_TARGETS, DrillError, DrillTarget, check_drill
from film_coach.infrastructure.library_fs import FileDrillStore, FilePracticeStore, FileVideoStore

STRIDE = [DrillTarget("strideRatio", "low")]

# ---- 規則 ----


def test_名前の前後の空白を除いて受け付ける() -> None:
    assert check_drill("Qb7Drill_01", "  ステップ・アンド・スロー ", 0, STRIDE) == "ステップ・アンド・スロー"


@pytest.mark.parametrize(
    ("youtube_id", "label", "start", "targets", "message"),
    [
        ("https://youtu.be/Qb7Drill_01", "ドリル", 0, STRIDE, "動画 ID"),
        ("Qb7Drill_01", "  ", 0, STRIDE, "名前"),
        ("Qb7Drill_01", "あ" * 41, 0, STRIDE, "名前"),
        ("Qb7Drill_01", "ドリル", -1, STRIDE, "開始位置"),
        ("Qb7Drill_01", "ドリル", 0, [], "指標"),
        ("Qb7Drill_01", "ドリル", 0, [DrillTarget("strideRatio", "any")] * (MAX_TARGETS + 1), "指標"),
        ("Qb7Drill_01", "ドリル", 0, [DrillTarget("stride", "low")], "知らない指標"),  # type: ignore[arg-type]
        ("Qb7Drill_01", "ドリル", 0, [DrillTarget("strideRatio", "low"), DrillTarget("strideRatio", "high")], "2 回"),
    ],
)
def test_受け付けない入力(youtube_id: str, label: str, start: int, targets: list[DrillTarget], message: str) -> None:
    with pytest.raises(DrillError, match=message):
        check_drill(youtube_id, label, start, targets)


# ---- 保存 ----


def test_登録して新しい順に一覧し_消せる(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from film_coach.application import library

    store = FileDrillStore(tmp_path / "drills")
    times = iter(["2026-10-06T01:00:00+00:00", "2026-10-06T02:00:00+00:00"])
    monkeypatch.setattr(library, "_now", lambda: next(times))
    a = create_drill(store, "Qb7Drill_01", "A", "QB Lab", 95, "ステップ", STRIDE)
    b = create_drill(store, "Qb7Drill_02", "B", "QB Lab", 0, "肘", [DrillTarget("elbowHeight", "low")])
    assert [d.id for d in list_drills(store)] == [b.id, a.id]
    assert list_drills(store)[1] == a  # JSON から読み戻しても同じ
    delete_drill(store, a.id)
    assert [d.id for d in list_drills(store)] == [b.id]
    with pytest.raises(NotFoundError):
        delete_drill(store, a.id)


# ---- API ----


@pytest.fixture
def client(tmp_path: Path) -> TestClient:
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
        drills=FileDrillStore(tmp_path / "drills"),
    )
    return TestClient(create_app(deps))


def test_APIで登録し_一覧し_消す(client: TestClient) -> None:
    body = {
        "youtubeId": "Qb7Drill_01",
        "title": "Step and Throw",
        "channel": "QB Lab",
        "startSec": 95,
        "label": "ステップ・アンド・スロー",
        "targets": [{"metric": "strideRatio", "side": "low"}],
    }
    res = client.post("/api/drills", json=body)
    assert res.status_code == 201, res.text
    d = res.json()
    assert d["targets"] == [{"metric": "strideRatio", "side": "low"}] and d["links"]["self"] == f"/api/drills/{d['id']}"
    assert [x["id"] for x in client.get("/api/drills").json()] == [d["id"]]
    assert client.delete(f"/api/drills/{d['id']}").status_code == 204
    assert client.delete(f"/api/drills/{d['id']}").status_code == 404
    assert client.get("/api/drills").json() == []


def test_APIは不正な入力を断る(client: TestClient) -> None:
    ok = {"youtubeId": "Qb7Drill_01", "label": "ドリル", "targets": [{"metric": "strideRatio"}]}
    assert client.post("/api/drills", json=ok).json()["targets"] == [{"metric": "strideRatio", "side": "any"}]
    assert client.post("/api/drills", json={**ok, "targets": [{"metric": "speed"}]}).status_code == 422
    assert client.post("/api/drills", json={**ok, "youtubeId": "not-an-id"}).status_code == 400
    assert client.post("/api/drills", json={**ok, "targets": []}).status_code == 400
