import asyncio

from core import EventBus, EventType, Task, TaskManager
from core import AgentRegistry

from .conftest import FakeAgent


def test_task_events_on_success():
    reg = AgentRegistry()
    reg.register(FakeAgent())
    event_bus = EventBus()
    seen = []
    for event_type in (
        EventType.TASK_CREATED,
        EventType.TASK_STARTED,
        EventType.TASK_COMPLETED,
    ):
        event_bus.subscribe(event_type, lambda e, seen=seen: seen.append(e.type))

    tm = TaskManager(reg, event_bus)
    result = asyncio.run(tm.execute(Task("x", "fake_capability")))
    assert result.success
    assert EventType.TASK_CREATED in seen
    assert EventType.TASK_STARTED in seen
    assert EventType.TASK_COMPLETED in seen


def test_task_events_on_failure():
    reg = AgentRegistry()  # tanpa agent -> gagal
    event_bus = EventBus()
    seen = []
    for event_type in (EventType.TASK_CREATED, EventType.TASK_FAILED):
        event_bus.subscribe(event_type, lambda e, seen=seen: seen.append(e.type))

    tm = TaskManager(reg, event_bus)
    result = asyncio.run(tm.execute(Task("x", "nonexistent_capability")))
    assert not result.success
    assert EventType.TASK_CREATED in seen
    assert EventType.TASK_FAILED in seen
    assert EventType.TASK_STARTED not in seen


def test_events_have_task_data():
    reg = AgentRegistry()
    reg.register(FakeAgent())
    event_bus = EventBus()
    seen = []
    event_bus.subscribe(
        EventType.TASK_STARTED, lambda e, seen=seen: seen.append(e.data)
    )
    tm = TaskManager(reg, event_bus)
    task = Task("desc", "fake_capability")
    asyncio.run(tm.execute(task))
    assert seen
    assert seen[0]["task_id"] == task.id
    assert seen[0]["assigned_agent"] == "fake"