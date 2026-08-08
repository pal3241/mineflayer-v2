from __future__ import annotations

from typing import Any

from core import AgentContext, BaseAgent


class MyAgent(BaseAgent):
    """Deskripsi singkat peran agent ini."""

    id = "my_agent"
    name = "My Agent"
    role = "Mengerjakan tugas tertentu"
    capabilities = ["custom_task"]
    version = "1.0.0"
    category = "custom"
    model = None

    async def run(self, task: Any) -> dict:
        # Ganti dengan logika agent Anda.
        return {
            "agent": self.id,
            "type": "custom_result",
            "requirement": task.description,
            "value": "hasil",
        }
