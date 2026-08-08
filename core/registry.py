from __future__ import annotations

from typing import Iterable

from .agent import AgentStatus, BaseAgent
from .event import Event, EventType


class AgentRegistry:
    """Stores agent instances; core code never imports concrete agents."""

    def __init__(self, event_bus=None):
        self._agents: dict[str, BaseAgent] = {}
        self.event_bus = event_bus

    def _emit(self, event_type: str, agent_id: str, **extra) -> None:
        if self.event_bus is None:
            return
        data = {"agent_id": agent_id, **extra}
        self.event_bus.emit_sync(Event(type=event_type, source="registry", data=data))

    def register(self, agent: BaseAgent) -> BaseAgent:
        if not agent.id or not agent.capabilities:
            raise ValueError("Agent must define id and at least one capability")
        if agent.id in self._agents:
            raise ValueError(f"Agent already registered: {agent.id}")
        agent.status = AgentStatus.READY
        self._agents[agent.id] = agent
        self._emit(EventType.AGENT_REGISTERED, agent.id)
        self._emit(EventType.AGENT_READY, agent.id)
        return agent

    def unregister(self, agent_id: str) -> None:
        self._agents.pop(agent_id, None)

    def get(self, agent_id: str) -> BaseAgent | None:
        return self._agents.get(agent_id)

    def find(self, predicate) -> list[BaseAgent]:
        return [agent for agent in self._agents.values() if predicate(agent)]

    def find_by_capability(self, capability: str) -> list[BaseAgent]:
        return self.find(lambda agent: agent.status == AgentStatus.READY and agent.can_handle(capability))

    def find_best(self, capabilities: Iterable[str] | str) -> BaseAgent | None:
        required = {capabilities} if isinstance(capabilities, str) else set(capabilities)
        candidates = self.find(lambda agent: agent.status == AgentStatus.READY and required.issubset(agent.capabilities))
        if not candidates:
            return None
        return max(candidates, key=lambda agent: (len(required & set(agent.capabilities)), agent.health.success_rate, -agent.health.current_load))

    def list_all(self) -> list[BaseAgent]:
        return list(self._agents.values())

    def enable(self, agent_id: str) -> BaseAgent:
        agent = self._agents[agent_id]
        agent.status = AgentStatus.READY
        self._emit(EventType.AGENT_READY, agent_id)
        return agent

    def disable(self, agent_id: str) -> BaseAgent:
        agent = self._agents[agent_id]
        agent.status = AgentStatus.DISABLED
        self._emit(EventType.AGENT_DISABLED, agent_id)
        return agent

    def reload(self, discovery) -> list[BaseAgent]:
        self._agents.clear()
        return discovery.discover(self)
