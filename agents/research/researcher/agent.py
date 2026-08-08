from __future__ import annotations

from typing import Any

from core import AgentContext, BaseAgent


class Researcher(BaseAgent):
    """Gathers and structures information about a topic."""

    id = "researcher"
    name = "Researcher"
    role = "Mengumpulkan dan menganalisis informasi"
    capabilities = ["research", "web_search", "information_gathering"]
    version = "1.0.0"
    category = "research"
    model = "research-model"

    async def run(self, task: Any) -> dict:
        return {
            "agent": self.id,
            "type": "research_report",
            "topic": task.description,
            "findings": [
                f"Overview: {task.description}",
                "Kata kunci utama berhasil diidentifikasi.",
                "Rekomendasi sumber untuk verifikasi lebih lanjut.",
            ],
        }
