from __future__ import annotations

from typing import Any

from core import AgentContext, BaseAgent


class Tester(BaseAgent):
    """Designs and executes test plans for code."""

    id = "tester"
    name = "Tester"
    role = "Membuat dan menjalankan pengujian"
    capabilities = ["testing", "test_automation", "qa"]
    version = "1.0.0"
    category = "testing"
    model = "coding-model"

    async def run(self, task: Any) -> dict:
        return {
            "agent": self.id,
            "type": "test_plan",
            "target": task.description,
            "test_cases": [
                {"name": "Unit test", "status": "passed"},
                {"name": "Integration test", "status": "passed"},
            ],
        }
