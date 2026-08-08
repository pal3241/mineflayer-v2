from __future__ import annotations

from typing import Any

from core import BaseAgent
from llm import InvalidResponseError
from llm.utils import parse_json_object


class Planner(BaseAgent):
    """Membuat rencana task sederhana (simple plan, bukan DAG) via LLM."""

    id = "planner"
    name = "Planner"
    role = "Membuat rencana task sederhana"
    capabilities = ["planning", "task_planning", "decomposition"]
    version = "1.0.0"
    category = "manager"
    model = "reasoning-model"

    async def run(self, task: Any) -> dict:
        prompt = _PLANNER_PROMPT.format(description=task.description)
        response = await self.llm([{"role": "user", "content": prompt}])
        data = parse_json_object(response.content)
        Planner._validate(data)
        return {
            "type": "task_plan",
            "goal": data["goal"],
            "tasks": data["tasks"],
            "model": response.model,
        }

    @staticmethod
    def _validate(data: dict) -> None:
        if not isinstance(data.get("goal"), str) or not data["goal"]:
            raise InvalidResponseError("Plan LLM: field 'goal' harus berupa string.")
        tasks = data.get("tasks")
        if not isinstance(tasks, list):
            raise InvalidResponseError("Plan LLM: field 'tasks' harus berupa list.")
        for item in tasks:
            if (
                not isinstance(item, dict)
                or not item.get("title")
                or not item.get("capability")
            ):
                raise InvalidResponseError(
                    "Plan LLM: setiap task harus punya 'title' dan 'capability'."
                )


_PLANNER_PROMPT = """Kamu adalah Planner dalam tim multi-agent.

GOAL:
{description}

Buat rencana task sederhana. Jawab HANYA dengan JSON (tanpa markdown):
{{
  "goal": "tujuan keseluruhan",
  "tasks": [
    {{"title": "nama task", "capability": "capability agent yang dibutuhkan"}}
  ]
}}
"""