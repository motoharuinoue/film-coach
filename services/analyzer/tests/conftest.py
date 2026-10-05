from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from film_coach.domain.pose import PoseSequence
from film_coach.infrastructure.json_pose import sequence_from_json

REPO = Path(__file__).resolve().parents[3]
PARITY = REPO / "packages" / "schema" / "fixtures" / "parity.v1.json"


@pytest.fixture(scope="session")
def parity_cases() -> list[dict[str, Any]]:
    """TypeScript の実装が作った共通データ（apps/web/src/domain/parity.test.ts）"""
    cases: list[dict[str, Any]] = json.loads(PARITY.read_text(encoding="utf-8"))["cases"]
    return cases


@pytest.fixture(scope="session")
def base_sequence(parity_cases: list[dict[str, Any]]) -> PoseSequence:
    return sequence_from_json(parity_cases[0]["sequence"])
