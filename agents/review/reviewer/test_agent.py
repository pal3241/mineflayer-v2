from __future__ import annotations

import asyncio
from pathlib import Path

from core import AgentContext, AgentDiscovery, AgentFactory, AgentRegistry, Task


def build_registry() -> AgentRegistry:
    registry = AgentRegistry()
    factory = AgentFactory(AgentContext(registry=registry))
    AgentDiscovery(Path(__file__).resolve().parents[2], factory).discover(registry)
    return registry


def test_reviewer_discovered() -> None:
    registry = build_registry()
    agent = registry.get("reviewer")
    assert agent is not None
    assert agent.status.name == "READY"


def test_reviewer_capabilities() -> None:
    registry = build_registry()
    agent = registry.get("reviewer")
    assert agent.can_handle("review")
    assert agent.can_handle("code_review")


def test_reviewer_run() -> None:
    registry = build_registry()
    agent = registry.get("reviewer")
    output = asyncio.run(agent.run(Task("Hasil kerja", "review")))
    assert output["type"] == "review"
    assert output["agent"] == "reviewer"
