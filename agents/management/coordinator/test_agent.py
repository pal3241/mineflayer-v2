from __future__ import annotations

import asyncio
from pathlib import Path

from core import (
    AgentDiscovery,
    AgentFactory,
    AgentContext,
    AgentRegistry,
    BaseAgent,
    MessageBus,
    Task,
)

_AGENTS_DIR = Path(__file__).resolve().parents[2]


class EchoAgent(BaseAgent):
    """Agent palsu yang menjawab request via handle_message."""

    id = "echo"
    name = "Echo"
    role = "echo"
    capabilities = ["research"]
    version = "1.0.0"
    category = "research"

    async def run(self, task):
        return "run-echo"

    async def handle_message(self, message):
        return f"echo:{message.content}"


def build_ctx(include_echo: bool):
    registry = AgentRegistry()
    if include_echo:
        registry.register(EchoAgent())
    bus = MessageBus(registry=registry)
    ctx = AgentContext(registry=registry, message_bus=bus)
    factory = AgentFactory(ctx)
    AgentDiscovery(_AGENTS_DIR, factory).discover(registry)
    return registry, ctx


def test_coordinator_discovered():
    registry, _ = build_ctx(include_echo=True)
    coordinator = registry.get("coordinator")
    assert coordinator is not None
    assert coordinator.status.name == "READY"


def test_coordinator_uses_messagebus():
    registry, _ = build_ctx(include_echo=True)
    coordinator = registry.get("coordinator")
    task = Task(
        "Buat kalkulator",
        "coordination",
        input_data={"capabilities": ["research"]},
    )
    output = asyncio.run(coordinator.run(task))
    assert output["type"] == "coordination_report"
    assert output["results"]["research"]["status"] == "ok"
    assert output["results"]["research"]["answer"] == "echo:Buat kalkulator"


def test_coordinator_handles_no_agent():
    registry, _ = build_ctx(include_echo=False)
    coordinator = registry.get("coordinator")
    task = Task(
        "x",
        "coordination",
        input_data={"capabilities": ["capability_tidak_ada"]},
    )
    output = asyncio.run(coordinator.run(task))
    assert output["results"]["capability_tidak_ada"]["status"] == "no_agent"


