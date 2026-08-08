import asyncio

from core import (
    AgentContext,
    AgentDiscovery,
    AgentFactory,
    AgentRegistry,
    EventBus,
    Message,
    MessageBus,
    MessageType,
    Task,
    TaskManager,
)

from .conftest import AGENTS_DIR, ResponderAgent

TARGET_9 = {
    "researcher", "coder", "tester", "reviewer", "analyst",
    "planner", "communicator", "coordinator", "supervisor",
}


def build_full_ctx():
    """Wire event/message infrastructure persis seperti main.py."""
    event_bus = EventBus()
    registry = AgentRegistry(event_bus=event_bus)
    message_bus = MessageBus(registry=registry, event_bus=event_bus)
    task_manager = TaskManager(registry, event_bus=event_bus)
    ctx = AgentContext(
        registry=registry,
        task_manager=task_manager,
        message_bus=message_bus,
        event_bus=event_bus,
    )
    factory = AgentFactory(ctx)
    AgentDiscovery(AGENTS_DIR, factory, event_bus=event_bus).discover(registry)
    return registry, ctx


def test_9_agents_discovered():
    registry, _ = build_full_ctx()
    ids = {a.id for a in registry.list_all()}
    assert ids >= TARGET_9


def test_communicator_real_discovery():
    registry, _ = build_full_ctx()
    communicator = registry.get("communicator")
    ctx = communicator.context
    msg = Message(sender="researcher", recipient="coder", type=MessageType.NOTIFICATION, content="info")
    asyncio.run(ctx.message_bus.send(msg))
    output = asyncio.run(communicator.run(Task("ringkas", "communication")))
    assert output["type"] == "communication_summary"
    assert output["total_messages"] >= 1
    assert "researcher" in output["senders"]


def test_coordinator_real_discovery_with_responder():
    registry, _ = build_full_ctx()
    registry.register(ResponderAgent())
    coordinator = registry.get("coordinator")
    task = Task(
        "Buat program kalkulator",
        "coordination",
        input_data={"capabilities": ["respond"]},
    )
    output = asyncio.run(coordinator.run(task))
    assert output["type"] == "coordination_report"
    assert output["results"]["respond"]["answer"] == "answered:Buat program kalkulator"


def test_supervisor_real_discovery():
    registry, _ = build_full_ctx()
    supervisor = registry.get("supervisor")
    task = Task("Pantau sistem", "supervision")
    output = asyncio.run(supervisor.run(task))
    assert output["type"] == "supervisor_report"
    assert registry.get("researcher").id in output["agents"]