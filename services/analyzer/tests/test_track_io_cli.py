"""追跡結果の JSON、モデルの置き場所、CLI の track コマンド（フェイクを差し込む）。"""

import io
import json
from dataclasses import replace
from pathlib import Path

import pytest
from test_track_target import FakeDetector, FakePose, FakeSink, FakeVideo

from film_coach.adapters.cli import run
from film_coach.application.track_target import FrameSink, TargetHint, track_target
from film_coach.bootstrap import cli_deps
from film_coach.domain.library import VideoInfo
from film_coach.infrastructure.json_track import track_to_json
from film_coach.infrastructure.models import MODELS, LocalModelStore, ModelNotFoundError, require
from film_coach.infrastructure.schema import SchemaError, validate


def test_追跡結果はスキーマに合うJSONになる() -> None:
    tt = track_target(FakeVideo(), FakeDetector(), FakePose(), TargetHint(185, 400, 10 / 30))
    data = track_to_json(tt)
    assert data["video"]["frameCount"] == 60
    assert data["frames"][26]["interpolated"] is True
    bad = json.loads(json.dumps(data))
    bad["frames"][0]["kp"] = bad["frames"][0]["kp"][:16]
    with pytest.raises(SchemaError, match="frames/0/kp"):
        validate("target-track.v1.schema.json", bad)


def test_モデルがなければ取得のしかたを示す(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FILM_COACH_DATA_DIR", str(tmp_path))
    with pytest.raises(ModelNotFoundError, match="models download"):
        require(MODELS["pose"])
    assert [present for _, _, present, _ in LocalModelStore().status()] == [False, False]


def test_標準モデルは承認した2つだけで_合計約145MB() -> None:
    assert set(MODELS) == {"detector", "pose"}
    assert sum(m.bytes for m in MODELS.values()) == pytest.approx(145e6, rel=0.01)
    assert all(m.url.startswith("https://download.openmmlab.com/") for m in MODELS.values())


def test_CLIのtrackで追跡結果とプレビューを書き出す(tmp_path: Path) -> None:
    sinks: list[FakeSink] = []

    def preview(_dest: Path, _info: VideoInfo, _label: str) -> FrameSink:
        sinks.append(FakeSink())
        return sinks[-1]

    written: dict[str, object] = {}
    deps = replace(
        cli_deps(),
        open_video=lambda _p: FakeVideo(),
        detector=FakeDetector,
        pose=FakePose,
        preview=preview,
        write_track=lambda tt, dest: written.update(tt=tt, dest=dest),
        shots=None,
        motion=None,
    )
    out = io.StringIO()
    code = run(
        ["track", "fake.mov", "--at", "0.33", "--point", "185,400", "--label", "#5", "--out", str(tmp_path)], deps, out
    )
    assert code == 0
    assert written["dest"] == tmp_path / "track.json"
    assert sinks and sinks[0].closed
    text = out.getvalue()
    assert "つないだ追跡 2 本" in text and "うち補間 12" in text


def test_CLIのtrackは人がいない場所を指すと1で終わる(tmp_path: Path) -> None:
    deps = replace(
        cli_deps(), open_video=lambda _p: FakeVideo(), detector=FakeDetector, pose=FakePose, shots=None, motion=None
    )
    out = io.StringIO()
    assert (
        run(["track", "fake.mov", "--at", "1", "--point", "960,900", "--no-preview", "--out", str(tmp_path)], deps, out)
        == 1
    )
    assert "見つかりません" in out.getvalue()
