import json

from core import (
    AgentDiscovery,
    AgentFactory,
    AgentRegistry,
    EventBus,
    EventType,
)

from .conftest import FakeAgent


def make_handlers(*event_types):
    seen = []

    def handler(event):
        seen.append((event.type, event.data.get("agent_id")))

    return seen, handler


def test_register_emits_lifecycle_events():
    event_bus = EventBus()
    seen, handler = make_handlers()
    event_bus.subscribe(EventType.AGENT_REGISTERED, handler)
    event_bus.subscribe(EventType.AGENT_READY, handler)

    registry = AgentRegistry(event_bus=event_bus)
    registry.register(FakeAgent())
    assert (EventType.AGENT_REGISTERED, "fake") in seen
    assert (EventType.AGENT_READY, "fake") in seen


def test_disable_emits_event():
    event_bus = EventBus()
    seen, handler = make_handlers(EventType.AGENT_DISABLED)
    event_bus.subscribe(EventType.AGENT_DISABLED, handler)

    registry = AgentRegistry(event_bus=event_bus)
    registry.register(FakeAgent())
    registry.disable("fake")
    assert (EventType.AGENT_DISABLED, "fake") in seen


def test_discovery_emits_lifecycle_events(tmp_path):
    agent_dir = tmp_path / "demo"
    agent_dir.mkdir()
    agent_dir.joinpath("manifest.json").write_text(
        json.dumps(
            {
                "id": "demo_agent",
                "name": "Demo",
                "role": "r",
                "capabilities": ["demo"],
                "version": "1.0.0",
            }
        ),
        encoding="utf-8",
    )
    agent_dir.joinpath("agent.py").write_text(
        "from core import BaseAgent\n"
        "class DemoAgent(BaseAgent):\n"
        "    id='demo_agent'; name='Demo'; role='r'; capabilities=['demo']\n"
        "    async def run(self, task): return 'demo'\n",
        encoding="utf-8",
    )

    event_bus = EventBus()
    seen, handler = make_handlers()
    for event_type in (
        EventType.AGENT_DISCOVERED,
        EventType.AGENT_REGISTERED,
        EventType.AGENT_READY,
    ):
        event_bus.subscribe(event_type, handler)

    registry = AgentRegistry(event_bus=event_bus)
    AgentDiscovery(tmp_path, AgentFactory(), event_bus=event_bus).discover(registry)

    assert (EventType.AGENT_DISCOVERED, "demo_agent") in seen
    assert (EventType.AGENT_REGISTERED, "demo_agent") in seen
    assert (EventType.AGENT_READY, "demo_agent") in seen