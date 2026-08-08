from core.event import Event, EventType


def test_event_defaults():
    event = Event(type="task.completed", source="task_manager")
    assert event.data == {}
    assert event.correlation_id is None
    assert event.id
    assert event.timestamp is not None


def test_event_type_constants():
    catalog = [
        EventType.AGENT_DISCOVERED,
        EventType.AGENT_REGISTERED,
        EventType.AGENT_READY,
        EventType.AGENT_FAILED,
        EventType.AGENT_DISABLED,
        EventType.TASK_CREATED,
        EventType.TASK_STARTED,
        EventType.TASK_COMPLETED,
        EventType.TASK_FAILED,
        EventType.MESSAGE_SENT,
        EventType.MESSAGE_DELIVERED,
        EventType.MESSAGE_FAILED,
    ]
    assert len(set(catalog)) == 12


def test_event_with_data_and_correlation():
    event = Event(
        type="task.created",
        source="system",
        data={"task_id": "t1"},
        correlation_id="c1",
    )
    assert event.data["task_id"] == "t1"
    assert event.correlation_id == "c1"
