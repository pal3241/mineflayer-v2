import asyncio

from core.event import EventBusError
from core.event_bus import EventBus


def emit_sync(bus, event):
    return asyncio.run(bus.emit(event))


def make_event(event_type="task.completed", source="test", **data):
    from core.event import Event

    return Event(type=event_type, source=source, data=data)


def test_subscribe_and_emit():
    bus = EventBus()
    seen = []

    def handler(event):
        seen.append(event.data.get("value"))
        return None

    bus.subscribe("task.completed", handler)
    emit_sync(bus, make_event(value=42))
    assert seen == [42]
    assert bus.subscriber_count("task.completed") == 1


def test_async_handler_is_awaited():
    bus = EventBus()
    seen = []

    async def handler(event):
        await asyncio.sleep(0)
        seen.append(event.data.get("v"))

    bus.subscribe("a.b", handler)
    emit_sync(bus, make_event(event_type="a.b", v=7))
    assert seen == [7]


def test_multiple_subscribers_all_called():
    bus = EventBus()
    order = []

    def h1(event):
        order.append("h1")

    def h2(event):
        order.append("h2")

    bus.subscribe("e", h1)
    bus.subscribe("e", h2)
    emit_sync(bus, make_event(event_type="e"))
    assert order == ["h1", "h2"]


def test_subscriber_isolation():
    bus = EventBus()
    reached = []

    def broken(event):
        raise RuntimeError("subscriber rusak")

    def ok(event):
        reached.append("ok")

    bus.subscribe("e", broken)
    bus.subscribe("e", ok)
    emit_sync(bus, make_event(event_type="e"))
    assert reached == ["ok"], "Subscriber lain harus tetap berjalan"
    assert bus.subscriber_error_count == 1


def test_unsubscribe():
    bus = EventBus()
    seen = []

    def handler(event):
        seen.append(1)

    bus.subscribe("e", handler)
    bus.unsubscribe("e", handler)
    emit_sync(bus, make_event(event_type="e"))
    assert seen == []


def test_emit_requires_type_and_source():
    from core.event import Event

    bus = EventBus()
    bad = Event(type="", source="")
    try:
        emit_sync(bus, bad)
    except EventBusError:
        return
    raise AssertionError("Event tanpa type/source harus ditolak")
