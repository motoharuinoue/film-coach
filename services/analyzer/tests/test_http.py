"""HTTP の API を、フェイクの依存で端から端まで通す。モデルも動画もいらない。"""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from test_track_target import FakeDetector, FakePose, FakeVideo
from test_youtube_library import FakeFetcher, FakeGrabber

from film_coach.adapters.http import HttpDeps, create_app
from film_coach.application.jobs import JobRunner
from film_coach.infrastructure.library_fs import FileVideoStore

ORIGIN = "http://localhost:5173"


class FakeModels:
    def status(self) -> list[tuple[str, float, bool, str]]:
        return [("人物検出", 94, True, "/m/det"), ("骨格推定", 51, True, "/m/pose")]

    def download(self, log):  # type: ignore[no-untyped-def]
        return None


@pytest.fixture
def client(tmp_path: Path) -> TestClient:
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
        allowed_origins=[ORIGIN],
    )
    return TestClient(create_app(deps))


def upload(client: TestClient, name: str = "IMG_0001.MOV") -> dict:  # type: ignore[type-arg]
    res = client.post("/api/videos", files={"file": (name, b"video", "video/quicktime")})
    assert res.status_code == 201, res.text
    return res.json()  # type: ignore[no-any-return]


def events(client: TestClient, url: str) -> list[tuple[str, dict]]:  # type: ignore[type-arg]
    out = []
    with client.stream("GET", url) as res:
        assert res.headers["content-type"].startswith("text/event-stream")
        kind = None
        for line in res.iter_lines():
            if line.startswith("event: "):
                kind = line[7:]
            elif line.startswith("data: ") and kind:
                out.append((kind, json.loads(line[6:])))
    return out


def test_状態とモデルの有無を返す(client: TestClient) -> None:
    body = client.get("/api/health").json()
    assert body["ok"] and body["modelsReady"]


def test_アップロードした動画の記録とフレームを返す(client: TestClient) -> None:
    v = upload(client)
    assert v["source"] == "upload" and v["info"]["frameCount"] == 60
    assert v["links"]["frame"] == f"/api/videos/{v['id']}/frame" and v["links"]["track"] is None
    assert [x["id"] for x in client.get("/api/videos").json()] == [v["id"]]
    res = client.get(f"/api/videos/{v['id']}/frame", params={"t": 5})
    assert res.headers["content-type"] == "image/jpeg" and res.content.startswith(b"\xff\xd8")


def test_指した人を追うジョブの進み具合をSSEで流し_結果を返す(client: TestClient) -> None:
    v = upload(client)
    res = client.post(f"/api/videos/{v['id']}/track", json={"t": 10 / 30, "x": 185, "y": 400, "label": "#5"})
    assert res.status_code == 202
    got = events(client, res.json()["events"])
    kinds = [k for k, _ in got]
    assert kinds[0] == "state" and kinds[-1] == "done"
    assert {d["stage"] for k, d in got if k == "progress"} == {"detect", "pose"}
    assert got[-1][1]["coverage"] == 1.0 and got[-1][1]["interpolated"] == 12
    after = client.get(f"/api/videos/{v['id']}").json()
    assert after["trackStatus"] == "done" and after["label"] == "#5" and after["mediaRetained"]
    track = client.get(after["links"]["track"]).json()
    assert track["schemaVersion"] == 1 and len(track["frames"]) == 60


def test_人がいない場所を指すと_失敗の理由をSSEで伝える(client: TestClient) -> None:
    v = upload(client)
    res = client.post(f"/api/videos/{v['id']}/track", json={"t": 1, "x": 960, "y": 900})
    got = events(client, res.json()["events"])
    assert got[-1][0] == "failed" and "見つかりません" in got[-1][1]["message"]
    assert client.get(f"/api/videos/{v['id']}").json()["trackStatus"] == "failed"


def test_YouTubeの区間を取り込み_追跡のあとは元の動画を配信しない(client: TestClient) -> None:
    res = client.post("/api/videos/youtube", json={"url": "https://youtu.be/Qb7Throw_01", "start": 134, "end": 140})
    assert res.status_code == 201, res.text
    v = res.json()
    assert v["youtube"]["channel"] == "Spiral Lab" and v["youtube"]["url"].endswith("&t=134s")
    job = client.post(f"/api/videos/{v['id']}/track", json={"t": 10 / 30, "x": 185, "y": 400}).json()
    events(client, job["events"])
    after = client.get(f"/api/videos/{v['id']}").json()
    assert after["mediaRetained"] is False and after["links"]["media"] is None and after["links"]["track"]
    assert client.get(f"/api/videos/{v['id']}/media").status_code == 410
    assert client.get(f"/api/videos/{v['id']}/frame").status_code == 410


@pytest.mark.parametrize(
    ("body", "detail"),
    [
        ({"url": "https://example.com/x", "start": 0, "end": 5}, "YouTube"),
        ({"url": "https://youtu.be/Qb7Throw_01", "start": 0, "end": 90}, "60 秒"),
    ],
)
def test_YouTubeの入力が不正なら400(client: TestClient, body: dict, detail: str) -> None:  # type: ignore[type-arg]
    res = client.post("/api/videos/youtube", json=body)
    assert res.status_code == 400 and detail in res.json()["detail"]


def test_動画でないファイルは400_ない動画は404(client: TestClient) -> None:
    res = client.post("/api/videos", files={"file": ("notes.txt", b"x", "text/plain")})
    assert res.status_code == 400
    assert client.get("/api/videos/0123456789ab").status_code == 404
    assert client.get("/api/videos/..%2F..%2Fetc").status_code == 404


def test_許可した画面からだけCORSを許す(client: TestClient) -> None:
    ok = client.get("/api/health", headers={"Origin": ORIGIN})
    ng = client.get("/api/health", headers={"Origin": "https://evil.example"})
    assert ok.headers.get("access-control-allow-origin") == ORIGIN
    assert "access-control-allow-origin" not in ng.headers
