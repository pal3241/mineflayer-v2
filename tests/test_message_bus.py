import asyncio

from core import (
    AgentRegistry,
    EventBus,
    EventType,
    Message,
    MessageBus,
    MessageStatus,
    MessageType,
    RecipientNotFoundError,
    RequestTimeoutError,
)

from .conftest import FakeAgent, ResponderAgent, SlowAgent


def make_registry() -> AgentRegistry:
    reg = AgentRegistry()
    reg.register(ResponderAgent())
    reg.register(SlowAgent())
    reg.register(FakeAgent())
    return reg


def test_direct_send_delivers_to_inbox():
    reg = make_registry()
    bus = MessageBus(registry=reg)
    msg = Message(sender="fake", recipient="responder", type=MessageType.NOTIFICATION, content="hi")
    delivered = asyncio.run(bus.send(msg))
    assert delivered.status == MessageStatus.DELIVERED
    assert bus.pending_count("responder") == 1
    received = bus.receive("responder")
    assert received.sender == "fake"
    assert received.content == "hi"


def test_send_to_unknown_recipient_raises():
    reg = make_registry()
    bus = MessageBus(registry=reg)
    msg = Message(sender="fake", recipient="ghost", type=MessageType.NOTIFICATION)
    try:
        asyncio.run(bus.send(msg))
    except RecipientNotFoundError:
        assert msg.status == MessageStatus.FAILED
        assert bus.stats()["failed"] == 1
        return
    raise AssertionError("Harus menolak recipient tidak dikenal")


def test_invalid_message_rejected():
    reg = make_registry()
    bus = MessageBus(registry=reg)
    try:
        asyncio.run(bus.send("bukan message"))
    except Exception:
        return
    raise AssertionError("Non-Message harus ditolak")


def test_broadcast_excludes_sender():
    reg = make_registry()
    bus = MessageBus(registry=reg)
    delivered = asyncio.run(bus.broadcast(sender="fake", content="halo semua"))
    expected = {a.id for a in reg.list_all()} - {"fake"}
    assert set(delivered) == expected
    for agent_id in expected:
        assert bus.pending_count(agent_id) == 1


def test_broadcast_with_exclude():
    reg = make_registry()
    bus = MessageBus(registry=reg)
    delivered = asyncio.run(
        bus.broadcast(sender="fake", content="x", exclude=["slow"])
    )
    assert "slow" not in delivered
    assert "responder" in delivered


def test_request_reply_with_correlation():
    reg = make_registry()
    bus = MessageBus(registry=reg)
    result = asyncio.run(
        bus.request(sender="fake", recipient="responder", content="pintar")
    )
    assert result == "answered:pintar"
    # response dikirim balik ke sender dengan correlation_id yang cocok
    response = bus.receive("fake")
    assert response is not None
    assert response.type == MessageType.RESPONSE
    request = next(m for m in bus.history() if m.type == MessageType.REQUEST)
    assert response.correlation_id == request.correlation_id


def test_request_timeout():
    reg = make_registry()
    bus = MessageBus(registry=reg)
    try:
        asyncio.run(
            bus.request(sender="fake", recipient="slow", content="x", timeout=0.2)
        )
    except RequestTimeoutError:
        return
    raise AssertionError("Request lambat harus timeout")


def test_request_timeout_when_no_handler():
    reg = make_registry()
    bus = MessageBus(registry=reg)
    try:
        # FakeAgent tidak override handle_message -> tidak bisa menjawab
        asyncio.run(
            bus.request(sender="fake", recipient="fake", content="x", timeout=0.2)
        )
    except RequestTimeoutError:
        return
    raise AssertionError("Tanpa handler harus ditolak")


def test_explicit_reply():
    reg = make_registry()
    bus = MessageBus(registry=reg)
    request = Message(sender="fake", recipient="responder", type=MessageType.REQUEST, content="q")
    asyncio.run(bus.send(request))
    response = asyncio.run(bus.reply(request, "jawaban"))
    assert response.type == MessageType.RESPONSE
    assert response.correlation_id == request.correlation_id


def test_history_bounded():
    reg = make_registry()
    bus = MessageBus(registry=reg, history_limit=2)
    for i in range(3):
        msg = Message(sender="fake", recipient="responder", type=MessageType.NOTIFICATION, content=str(i))
        asyncio.run(bus.send(msg))
    assert len(bus.history()) == 2


def test_message_events_emitted():
    reg = make_registry()
    event_bus = EventBus()
    seen = []

    def handler(event):
        seen.append(event.type)

    event_bus.subscribe(EventType.MESSAGE_SENT, handler)
    event_bus.subscribe(EventType.MESSAGE_DELIVERED, handler)
    event_bus.subscribe(EventType.MESSAGE_FAILED, handler)

    bus = MessageBus(registry=reg, event_bus=event_bus)
    msg = Message(sender="fake", recipient="responder", type=MessageType.NOTIFICATION)
    asyncio.run(bus.send(msg))
    assert EventType.MESSAGE_SENT in seen
    assert EventType.MESSAGE_DELIVERED in seen
    assert EventType.MESSAGE_FAILED not in seen