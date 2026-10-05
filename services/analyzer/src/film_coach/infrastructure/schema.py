"""packages/schema の JSON Schema で検証する。スキーマはリポジトリで 1 か所だけに置く（ADR-0004）。

スキーマどうしの参照（"$ref": "pose-sequence.v1.schema.json" など）は、$id で引けるように全部を登録して解決する。
"""

from __future__ import annotations

import json
from functools import cache
from typing import Any

from jsonschema import Draft202012Validator
from referencing import Registry, Resource
from referencing.jsonschema import DRAFT202012

from .paths import schema_dir


@cache
def _registry() -> Registry[Any]:
    resources = []
    for path in sorted(schema_dir().glob("*.schema.json")):
        schema = json.loads(path.read_text(encoding="utf-8"))
        resources.append((schema["$id"], Resource.from_contents(schema, default_specification=DRAFT202012)))
    return Registry().with_resources(resources)


@cache
def validator(name: str) -> Draft202012Validator:
    schema = json.loads((schema_dir() / name).read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema, registry=_registry())


class SchemaError(ValueError):
    """スキーマに合わないデータ"""


def validate(name: str, data: Any) -> None:
    errors = sorted(validator(name).iter_errors(data), key=lambda e: list(e.absolute_path))
    if errors:
        first = errors[0]
        where = "/".join(str(p) for p in first.absolute_path) or "(ルート)"
        raise SchemaError(f"{name} に合いません：{where} — {first.message}（ほか {len(errors) - 1} 件）")
