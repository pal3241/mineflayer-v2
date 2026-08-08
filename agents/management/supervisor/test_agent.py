from __future__ import annotations

import asyncio
from pathlib import Path

from core import (
    AgentContext,
    AgentDiscovery,
    AgentFactory,
    AgentRegistry,
    BaseAgent,
    Task,
    TaskManager,
)


class FlakyAgent(BaseAgent):
    """Agent yang gagal dan menambah tasks_failed pada health-nya."""

    id = "flaky"
    name = "Flaky"
    role = "flaky"
    capabilities = ["review"]
    version = "1.0.0"
    category = "specialized"

    async def run(self, task):
        return "flaky-output"


def build_ctx():
    registry = AgentRegistry()
    registry.register(FlakyAgent())
    registry.get("flaky").health.tasks_failed = 1  # simulasikan pernah gagal
    task_manager = TaskManager(registry)
    ctx = AgentContext(registry=registry, task_manager=task_manager)
    return registry, task_manager, ctx


def discover_supervisor(ctx):
    registry = AgentRegistry()
    factory = AgentFactory(ctx)
    AgentDiscovery(Path(__file__).resolve().parents[2], factory).discover(registry)
    return registry.get("supervisor")


def test_supervisor_discovered():
    _, _, ctx = build_ctx()
    supervisor = discover_supervisor(ctx)
    assert supervisor is not None
    assert supervisor.status.name == "READY"


def test_supervisor_monitors_health():
    _, _, ctx = build_ctx()
    supervisor = discover_supervisor(ctx)
    output = asyncio.run(supervisor.run(Task("pantau", "supervision")))
    assert output["type"] == "supervisor_report"
    assert "flaky" in output["agents"]
    assert output["agents"]["flaky"]["tasks_failed"] == 1


def test_supervisor_requests_retry_via_taskmanager():
    registry, task_manager, ctx = build_ctx()
    supervisor = discover_supervisor(ctx)
    task = Task(
        "pantau",
        "supervision",
        input_data={"agent_id": "flaky", "capability": "review"},
    )
    output = asyncio.run(supervisor.run(task))
    retry_actions = [a for a in output["actions"] if a["type"] == "retry"]
    assert retry_actions, "Supervisor harus meminta retry untuk agent yang gagal"
    assert retry_actions[0]["success"] is True


def test_supervisor_ignores_healthy_agent():
    registry = AgentRegistry()
    registry.register(FlakyAgent())
    task_manager = TaskManager(registry)
    ctx = AgentContext(registry=registry, task_manager=task_manager)
    supervisor = discover_supervisor(ctx)
    task = Task(
        "pantau",
        "supervision",
        input_data={"agent_id": "flaky", "capability": "review"},
    )
    output = asyncio.run(supervisor.run(task))
    assert output["actions"] == []
