from __future__ import annotations

from typing import Any

from core import BaseAgent, MessageError, Task


class Supervisor(BaseAgent):
    """Memantau agent/task, mendeteksi failure, dan meminta retry via TaskManager.

    Belum melakukan self-replanning (itu Phase 10). Hanya monitoring +
    permintaan retry generic melalui TaskManager (bukan import agent tertentu).
    """

    id = "supervisor"
    name = "Supervisor"
    role = "Memantau agent/task, mendeteksi failure, dan meminta retry"
    capabilities = ["supervision", "monitoring", "quality_control"]
    version = "1.0.0"
    category = "manager"
    model = None

    async def run(self, task: Any) -> dict:
        registry = self.context.registry if self.context else None
        task_manager = self.context.task_manager if self.context else None
        if registry is None:
            raise MessageError(f"Agent '{self.id}' butuh Registry di context.")

        health: dict[str, dict] = {}
        for agent in registry.list_all():
            health[agent.id] = {
                "status": agent.status.value,
                "success_rate": round(agent.health.success_rate, 3),
                "load": agent.health.current_load,
                "tasks_failed": agent.health.tasks_failed,
            }

        actions: list[dict] = []
        target = task.input_data.get("agent_id")
        if target:
            agent = registry.get(target)
            if agent is None:
                actions.append({"type": "unknown_agent", "agent": target})
            elif agent.status.value == "FAILED" or agent.health.tasks_failed > 0:
                if task_manager is not None:
                    retry_task = Task(
                        description=task.input_data.get(
                            "retry_task", f"Retry untuk {target}"
                        ),
                        capability=task.input_data.get("capability", "review"),
                        input_data=task.input_data.get("retry_input", {}),
                    )
                    result = await task_manager.execute(retry_task)
                    actions.append(
                        {
                            "type": "retry",
                            "agent": target,
                            "success": result.success,
                            "retry_agent": result.agent_id,
                        }
                    )
                else:
                    actions.append(
                        {
                            "type": "retry_requested",
                            "agent": target,
                            "note": "TaskManager tidak tersedia di context",
                        }
                    )

        return {"type": "supervisor_report", "actions": actions, "agents": health}
