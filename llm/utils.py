from __future__ import annotations

import json
import re

from .models import InvalidResponseError

_CODE_FENCE = re.compile(r"```(?:json|JSON)?\s*|```", re.IGNORECASE)


def parse_json_object(text: str) -> dict:
    """Ambil satu JSON object dari output LLM yang tidak bisa dipercaya.

    Menerima JSON murni, JSON dibungkus code fence, atau teks yang memuat JSON.
    Gagal -> InvalidResponseError (controlled error), bukan crash mentah.
    """
    if not text or not text.strip():
        raise InvalidResponseError("LLM mengembalikan konten kosong")

    cleaned = _CODE_FENCE.sub("", text).strip()

    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError:
        data = _extract_balanced(cleaned)

    if not isinstance(data, dict):
        raise InvalidResponseError("Output LLM harus berupa JSON object")
    return data


def _extract_balanced(text: str) -> dict:
    start = text.find("{")
    if start == -1:
        raise InvalidResponseError(f"Tidak ditemukan JSON object pada output LLM: {text[:200]!r}")
    depth = 0
    for i in range(start, len(text)):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(text[start : i + 1])
                except json.JSONDecodeError as exc:
                    raise InvalidResponseError(f"JSON pada output LLM tidak valid: {exc}") from exc
    raise InvalidResponseError("JSON object tidak tertutup pada output LLM")