"""リポジトリ内の場所。環境変数で差し替えられる。"""

from __future__ import annotations

import os
from pathlib import Path


def repo_root() -> Path:
    """packages/schema を含む最初の親ディレクトリ"""
    for parent in Path(__file__).resolve().parents:
        if (parent / "packages" / "schema").is_dir():
            return parent
    raise FileNotFoundError("リポジトリのルート（packages/schema がある場所）が見つかりません")


def data_dir() -> Path:
    """解析データの置き場所（git の管理外）。FILM_COACH_DATA_DIR で変えられる"""
    return Path(os.environ.get("FILM_COACH_DATA_DIR") or repo_root() / "data")


def schema_dir() -> Path:
    """FILM_COACH_SCHEMA_DIR があればそれを、なければリポジトリの packages/schema を使う"""
    return Path(os.environ.get("FILM_COACH_SCHEMA_DIR") or repo_root() / "packages" / "schema")
