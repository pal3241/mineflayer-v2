import asyncio

from core import (
    AgentContext,
    AgentRegistry,
    EventBus,
    Message,
    MessageError,
    MessageStatus,
    MessageType,
)

from .conftest import FakeAgent


def test_send_message_helper():
    reg = AgentRegistry()
    reg.register(FakeAgent())
    from core import MessageBus

    bus = MessageBus(registry=reg)
    ctx = AgentContext(registry=reg, message_bus=bus)
    agent = FakeAgent(ctx)
    delivered = asyncio.run(agent.send_message("fake", "halo", msg_type="notification"))
    assert delivered.status == MessageStatus.DELIVERED
    assert bus.receive("fake").content == "halo"


def test_send_message_without_bus_raises():
    ctx = AgentContext()
    agent = FakeAgent(ctx)
    try:
        asyncio.run(agent.send_message("someone", "halo"))
    except MessageError:
        return
    raise AssertionError("Tanpa MessageBus harus error jelas")


def test_emit_event_helper():
    event_bus = EventBus()
    seen = []

    def handler(event):
        seen.append((event.type, event.source))

    event_bus.subscribe("task.started", handler)
    ctx = AgentContext(event_bus=event_bus)
    agent = FakeAgent(ctx)
    asyncio.run(agent.emit_event("task.started", {"x": 1}))
    assert ("task.started", "fake") in seen


def test_emit_event_without_bus_raises():
    ctx = AgentContext()
    agent = FakeAgent(ctx)
    try:
        asyncio.run(agent.emit_event("task.started"))
    except Exception:
        return
    raise AssertionError("Tanpa EventBus harus error jelas")


def test_handle_message_default_returns_none():
    agent = FakeAgent(AgentContext())
    result = asyncio.run(
        agent.handle_message(Message("a", "b", MessageType.REQUEST, content="q"))
    )
    assert result is None