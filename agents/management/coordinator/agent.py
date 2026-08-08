from __future__ import annotations

from typing import Any

from core import BaseAgent, MessageError, RecipientNotFoundError, RequestTimeoutError


class Coordinator(BaseAgent):
    """Mengkoordinasikan task ke agent yang relevan melalui MessageBus.

    Hanya mengenal capability / agent id / registry / message_bus — TIDAK
    pernah meng-import agent tertentu (prinsip plugin).
    """

    id = "coordinator"
    name = "Coordinator"
    role = "Mengkoordinasikan task ke agent yang relevan via MessageBus"
    capabilities = ["coordination", "task_coordination", "agent_coordination"]
    version = "1.0.0"
    category = "manager"
    model = None

    async def run(self, task: Any) -> dict:
        bus = self.context.message_bus if self.context else None
        registry = self.context.registry if self.context else None
        if bus is None or registry is None:
            raise MessageError(
                f"Agent '{self.id}' butuh MessageBus + Registry di context."
            )

        capabilities = task.input_data.get("capabilities") or ["research", "coding"]
        timeout = float(task.input_data.get("timeout", 10.0))
        results: dict[str, dict] = {}
        for capability in capabilities:
            candidates = registry.find_by_capability(capability)
            if not candidates:
                results[capability] = {"status": "no_agent"}
                continue
            target = candidates[0]
            try:
                answer = await bus.request(
                    sender=self.id,
                    recipient=target.id,
                    content=task.description,
                    task_id=task.id,
                    timeout=timeout,
                )
                results[capability] = {
                    "agent": target.id,
                    "status": "ok",
                    "answer": answer,
                }
            except RequestTimeoutError:
                results[capability] = {"agent": target.id, "status": "timeout"}
            except RecipientNotFoundError:
                results[capability] = {"agent": target.id, "status": "recipient_not_found"}

        return {
            "type": "coordination_report",
            "task": task.description,
            "results": results,
        }
