from __future__ import annotations

import asyncio
from pathlib import Path

from core import AgentContext, AgentDiscovery, AgentFactory, AgentRegistry, Task


def build_registry() -> AgentRegistry:
    registry = AgentRegistry()
    factory = AgentFactory(AgentContext(registry=registry))
    AgentDiscovery(Path(__file__).resolve().parents[2], factory).discover(registry)
    return registry


def test_coder_discovered() -> None:
    registry = build_registry()
    agent = registry.get("coder")
    assert agent is not None
    assert agent.status.name == "READY"


def test_coder_capabilities() -> None:
    registry = build_registry()
    agent = registry.get("coder")
    assert agent.can_handle("coding")
    assert agent.can_handle("python")
    assert agent.can_handle("debugging")


def test_coder_run() -> None:
    registry = build_registry()
    agent = registry.get("coder")
    output = asyncio.run(agent.run(Task("Halo world", "coding")))
    assert output["type"] == "code"
    assert output["agent"] == "coder"
