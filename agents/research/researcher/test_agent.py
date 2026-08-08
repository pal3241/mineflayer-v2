from __future__ import annotations

import asyncio
from pathlib import Path

from core import AgentContext, AgentDiscovery, AgentFactory, AgentRegistry, Task


def build_registry() -> AgentRegistry:
    registry = AgentRegistry()
    factory = AgentFactory(AgentContext(registry=registry))
    AgentDiscovery(Path(__file__).resolve().parents[2], factory).discover(registry)
    return registry


def test_researcher_discovered() -> None:
    registry = build_registry()
    agent = registry.get("researcher")
    assert agent is not None
    assert agent.status.name == "READY"


def test_researcher_capabilities() -> None:
    registry = build_registry()
    agent = registry.get("researcher")
    assert agent.can_handle("research")
    assert agent.can_handle("web_search")
    assert not agent.can_handle("coding")


def test_researcher_run() -> None:
    registry = build_registry()
    agent = registry.get("researcher")
    output = asyncio.run(agent.run(Task("Topik riset", "research")))
    assert output["type"] == "research_report"
    assert output["agent"] == "researcher"
