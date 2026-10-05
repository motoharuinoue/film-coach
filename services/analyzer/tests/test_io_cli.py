import copy
import io
import json
from pathlib import Path
from typing import Any

import pytest

from film_coach.adapters.cli import run
from film_coach.bootstrap import cli_deps
from film_coach.infrastructure.json_pose import sequence_from_json, sequence_to_json
from film_coach.infrastructure.schema import SchemaError


def test_スキーマに合う骨格を読み書きできる(parity_cases: list[dict[str, Any]]) -> None:
    seq = sequence_from_json(parity_cases[0]["sequence"])
    again = sequence_from_json(sequence_to_json(seq))
    assert again == seq


@pytest.mark.parametrize(
    ("break_it", "where"),
    [
        (lambda d: d["frames"][0]["kp"].pop(), "frames/0/kp"),  # 関節が 16 個
        (lambda d: d.__setitem__("fps", 0), "fps"),
        (lambda d: d["frames"][3]["kp"][2].__setitem__(2, 1.5), "frames/3/kp/2/2"),  # 信頼度が 1 を超える
        (lambda d: d.__setitem__("space", "image"), "space"),
    ],
)
def test_スキーマに合わない骨格は場所を示して拒む(
    parity_cases: list[dict[str, Any]], break_it: Any, where: str
) -> None:
    data = copy.deepcopy(parity_cases[0]["sequence"])
    break_it(data)
    with pytest.raises(SchemaError, match=where):
        sequence_from_json(data)


def test_CLIでフェーズと指標を表示し_JSONに書き出す(parity_cases: list[dict[str, Any]], tmp_path: Path) -> None:
    pose = tmp_path / "pose.json"
    pose.write_text(json.dumps(parity_cases[1]["sequence"]), encoding="utf-8")
    out_file = tmp_path / "out" / "analysis.json"
    out = io.StringIO()
    assert run(["analyze-pose", str(pose), "--camera", "side", "--out", str(out_file)], cli_deps(), out) == 0
    text = out.getvalue()
    assert "リリース" in text
    assert "腰と肩の捻り差" in text and "判定不可" in text
    result = json.loads(out_file.read_text(encoding="utf-8"))
    assert result["events"] == parity_cases[1]["expected"]["events"]
    assert result["camera"] == "side"
