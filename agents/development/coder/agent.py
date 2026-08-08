from __future__ import annotations

from typing import Any

from core import AgentContext, BaseAgent


class Coder(BaseAgent):
    """Writes and fixes program code."""

    id = "coder"
    name = "Coder"
    role = "Menulis kode program"
    capabilities = ["coding", "python", "debugging"]
    version = "1.0.0"
    category = "development"
    model = "coding-model"

    async def run(self, task: Any) -> dict:
        return {
            "agent": self.id,
            "type": "code",
            "requirement": task.description,
            "language": "python",
            "code": f"# Implementasi untuk: {task.description}\n# Dihasilkan oleh Coder v{self.version}",
        }
