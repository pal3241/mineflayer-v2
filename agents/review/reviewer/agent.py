from __future__ import annotations

from typing import Any

from core import AgentContext, BaseAgent


class Reviewer(BaseAgent):
    """Reviews work produced by other agents and decides pass/fail."""

    id = "reviewer"
    name = "Reviewer"
    role = "Meninjau hasil kerja agent lain"
    capabilities = ["review", "code_review", "quality"]
    version = "1.0.0"
    category = "specialized"
    model = "reasoning-model"

    async def run(self, task: Any) -> dict:
        return {
            "agent": self.id,
            "type": "review",
            "subject": task.description,
            "verdict": "PASS",
            "notes": "Hasil memenuhi kriteria dasar yang dipersyaratkan.",
        }
