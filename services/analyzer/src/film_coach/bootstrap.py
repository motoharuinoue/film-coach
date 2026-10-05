"""コンポジションルート：ポートの実装（infrastructure）を入口（adapters）に差し込む。

層のルールを保つため、adapters と infrastructure の両方を import してよいのはここだけ。
"""

from __future__ import annotations

import sys

from .adapters.cli import CliDeps, run
from .infrastructure.json_pose import JsonAnalysisWriter, JsonPoseSequenceReader


def cli_deps() -> CliDeps:
    return CliDeps(reader=JsonPoseSequenceReader(), writer=JsonAnalysisWriter())


def main() -> None:
    sys.exit(run(sys.argv[1:], cli_deps()))
