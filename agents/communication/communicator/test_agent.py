from __future__ import annotations

import asyncio
from pathlib import Path

from core import (
    AgentContext,
    AgentDiscovery,
    AgentFactory,
    AgentRegistry,
    Message,
    MessageBus,
    MessageType,
    Task,
)
from core.event_bus import EventBus


def build_ctx(bus: MessageBus | None, event_bus: EventBus | None) -> AgentContext:
    registry = AgentRegistry()
    return AgentContext(registry=registry, message_bus=bus, event_bus=event_bus)


def discover_communicator(ctx: AgentContext):
    registry = AgentRegistry()
    factory = AgentFactory(ctx)
    AgentDiscovery(Path(__file__).resolve().parents[2], factory).discover(registry)
    return registry.get("communicator")


def test_communicator_discovered():
    bus = MessageBus()
    agent = discover_communicator(build_ctx(bus, None))
    assert agent is not None
    assert agent.status.name == "READY"


def test_communicator_summarizes_history():
    bus = MessageBus()
    agent = discover_communicator(build_ctx(bus, None))
    msg = Message(sender="researcher", recipient="coder", type=MessageType.REQUEST, content="data")
    asyncio.run(bus.send(msg))
    output = asyncio.run(agent.run(Task("ringkas", "communication")))
    assert output["type"] == "communication_summary"
    assert output["total_messages"] == 1
    assert output["senders"] == ["researcher"]


def test_communicator_requires_bus():
    ctx = build_ctx(None, None)  # tanpa message_bus
    agent = discover_communicator(ctx)
    try:
        asyncio.run(agent.run(Task("ringkas", "communication")))
    except Exception as exc:
        assert "MessageBus" in str(exc)
        return
    raise AssertionError("Communicator harus gagal jelas tanpa MessageBus")
