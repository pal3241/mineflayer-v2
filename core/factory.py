from __future__ import annotations

from .agent import AgentContext, BaseAgent


class AgentFactory:
    def __init__(self, context: AgentContext | None = None):
        self.context = context or AgentContext()

    def create(self, agent_class: type[BaseAgent], **kwargs) -> BaseAgent:
        if not issubclass(agent_class, BaseAgent):
            raise TypeError("Agent class must inherit BaseAgent")
        return agent_class(context=self.context, **kwargs)
