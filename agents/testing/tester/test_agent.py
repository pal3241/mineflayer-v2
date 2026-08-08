from __future__ import annotations

import asyncio
from pathlib import Path

from core import AgentContext, AgentDiscovery, AgentFactory, AgentRegistry, Task


def build_registry() -> AgentRegistry:
    registry = AgentRegistry()
    factory = AgentFactory(AgentContext(registry=registry))
    AgentDiscovery(Path(__file__).resolve().parents[2], factory).discover(registry)
    return registry


def test_tester_discovered() -> None:
    registry = build_registry()
    agent = registry.get("tester")
    assert agent is not None
    assert agent.status.name == "READY"


def test_tester_capabilities() -> None:
    registry = build_registry()
    agent = registry.get("tester")
    assert agent.can_handle("testing")
    assert agent.can_handle("qa")


def test_tester_run() -> None:
    registry = build_registry()
    agent = registry.get("tester")
    output = asyncio.run(agent.run(Task("Modul kalkulator", "testing")))
    assert output["type"] == "test_plan"
    assert output["agent"] == "tester"
