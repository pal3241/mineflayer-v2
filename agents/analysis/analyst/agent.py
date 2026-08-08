from __future__ import annotations

from typing import Any

from core import BaseAgent
from llm import InvalidResponseError
from llm.utils import parse_json_object


class Analyst(BaseAgent):
    """Menganalisis masalah / task dan menghasilkan analisis terstruktur via LLM."""

    id = "analyst"
    name = "Analyst"
    role = "Menganalisis masalah dan tugas secara terstruktur"
    capabilities = ["analysis", "reasoning", "problem_analysis"]
    version = "1.0.0"
    category = "specialized"
    model = "reasoning-model"

    async def run(self, task: Any) -> dict:
        prompt = _ANALYST_PROMPT.format(description=task.description)
        response = await self.llm([{"role": "user", "content": prompt}])
        data = parse_json_object(response.content)
        Analyst._validate(data)
        return {
            "type": "analysis",
            "task": task.description,
            "summary": data["summary"],
            "issues": data["issues"],
            "recommendation": data["recommendation"],
            "model": response.model,
        }

    @staticmethod
    def _validate(data: dict) -> None:
        if not isinstance(data.get("summary"), str) or not data["summary"]:
            raise InvalidResponseError("Analisis LLM: field 'summary' harus berupa string.")
        if not isinstance(data.get("issues"), list):
            raise InvalidResponseError("Analisis LLM: field 'issues' harus berupa list.")
        if not isinstance(data.get("recommendation"), str):
            raise InvalidResponseError("Analisis LLM: field 'recommendation' harus berupa string.")


_ANALYST_PROMPT = """Kamu adalah Analyst dalam tim multi-agent.

TASK:
{description}

Berikan analisis terstruktur. Jawab HANYA dengan JSON (tanpa markdown):
{{
  "summary": "ringkasan singkat masalah",
  "issues": [
    {{"title": "nama masalah", "severity": "high|medium|low", "detail": "penjelasan"}}
  ],
  "recommendation": "rekomendasi langkah"
}}
"""