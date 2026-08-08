from __future__ import annotations

import asyncio
import time

from .event import Event, EventType
from .registry import AgentRegistry
from .task import Task, TaskResult, TaskStatus


class TaskManager:
    def __init__(self, registry: AgentRegistry, event_bus=None):
        self.registry = registry
        self.event_bus = event_bus

    async def _emit(self, event_type: str, task: Task, **extra) -> None:
        if self.event_bus is None:
            return
        data = {
            "task_id": task.id,
            "capability": task.capability,
            "description": task.description,
            "assigned_agent": task.assigned_agent,
            "priority": task.priority,
            **extra,
        }
        await self.event_bus.emit(
            Event(type=event_type, source="task_manager", data=data)
        )

    async def execute(self, task: Task) -> TaskResult:
        await self._emit(EventType.TASK_CREATED, task)
        agent = self.registry.find_best(task.capability)
        if agent is None:
            task.status = TaskStatus.FAILED
            await self._emit(EventType.TASK_FAILED, task, reason="no_ready_agent")
            return TaskResult(task.id, "unassigned", None, False, f"No ready agent for capability: {task.capability}")
        task.assigned_agent = agent.id
        task.status = TaskStatus.RUNNING
        await self._emit(EventType.TASK_STARTED, task)
        agent.mark_working()
        started = time.perf_counter()
        try:
            output = await agent.run(task)
            task.status = TaskStatus.COMPLETED
            agent.health.tasks_completed += 1
            agent.health.total_execution_time += time.perf_counter() - started
            agent.mark_ready()
            await self._emit(EventType.TASK_COMPLETED, task)
            return TaskResult(task.id, agent.id, output)
        except Exception as exc:
            task.status = TaskStatus.FAILED
            agent.health.total_execution_time += time.perf_counter() - started
            agent.mark_failed()
            await self._emit(EventType.TASK_FAILED, task, reason=str(exc))
            return TaskResult(task.id, agent.id, None, False, str(exc))
