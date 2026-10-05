"""アプリケーション層が外側に求める窓口（ポート）。実装は infrastructure 層に置き、bootstrap.py で差し込む。"""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Protocol

from ..domain.pose import PoseSequence
from .analyze_pose import RepAnalysis


class PoseSequenceReader(Protocol):
    """骨格の時系列を読む（M1-2 では動画から骨格を推定する実装も足す）"""

    def read(self, source: Path) -> PoseSequence: ...


class AnalysisWriter(Protocol):
    """解析結果を書き出す"""

    def write(self, analysis: RepAnalysis, dest: Path) -> None: ...


class ModelStore(Protocol):
    """骨格推定などのモデルファイルの置き場所"""

    def status(self) -> list[tuple[str, float, bool, str]]:
        """(役割, 大きさ MB, 置いてあるか, 場所)"""
        ...

    def download(self, log: Callable[[str], None]) -> None: ...
