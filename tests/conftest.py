from __future__ import annotations

from pathlib import Path

from core import AgentContext, AgentDiscovery, AgentFactory, AgentRegistry, BaseAgent
from llm import LLMResponse, LLMRouter
from llm.providers.base import BaseLLMProvider

AGENTS_DIR = Path(__file__).resolve().parents[1] / "agents"


def build_registry(agents_dir: Path = AGENTS_DIR) -> AgentRegistry:
    registry = AgentRegistry()
    factory = AgentFactory(AgentContext(registry=registry))
    AgentDiscovery(agents_dir, factory).discover(registry)
    return registry


class FakeAgent(BaseAgent):
    """Minimal agent for registry/task-manager unit tests."""

    id = "fake"
    name = "Fake"
    role = "fake"
    capabilities = ["fake_capability"]
    version = "1.0.0"
    category = "utility"

    async def run(self, task):
        return {"ok": True, "task": task.description}


class ResponderAgent(BaseAgent):
    """Agent that answers request messages through handle_message."""

    id = "responder"
    name = "Responder"
    role = "responder"
    capabilities = ["respond"]
    version = "1.0.0"
    category = "utility"

    async def run(self, task):
        return "run"

    async def handle_message(self, message):
        return f"answered:{message.content}"


class SlowAgent(BaseAgent):
    """Agent whose handle_message sleeps longer than any request timeout."""

    id = "slow"
    name = "Slow"
    role = "slow"
    capabilities = ["slow"]
    version = "1.0.0"
    category = "utility"

    async def run(self, task):
        return "run"

    async def handle_message(self, message):
        import asyncio

        await asyncio.sleep(5)
        return "late"


class FakeLLMProvider(BaseLLMProvider):
    """Provider palsu untuk unit test — TIDAK memakai API key sungguhan.

    `responses` bisa berupa:
      - iterable (content, metadata) -> dipakai berurutan per call
      - callable(model, messages) -> menghasilkan content dinamis
    """

    name = "fake"

    def __init__(self, responses=None):
        self.responses = responses if responses is not None else [("fake content", {})]
        self.calls: list[dict] = []

    async def generate(self, messages, model, temperature=0.7, **kwargs):
        self.calls.append({"model": model, "messages": messages, "api_key": kwargs.get("api_key")})
        if callable(self.responses):
            content = self.responses(model, messages)
        else:
            item = self.responses[len(self.calls) - 1]
            content = item[0] if isinstance(item, tuple) else item
        return LLMResponse(content=content, model=model, provider=self.name, usage={"total_tokens": 10})


def make_fake_router(model_config=None, provider=None):
    cfg = model_config or {
        "reasoning-model": {"provider": "fake", "model": "fake-reasoning"},
        "coding-model": {"provider": "fake", "model": "fake-coding"},
        "research-model": {"provider": "fake", "model": "fake-research"},
    }
    return LLMRouter(
        model_config=cfg,
        providers={"fake": provider or FakeLLMProvider()},
    )


def build_ctx_with_fake_llm(provider=None) -> AgentContext:
    registry = AgentRegistry()
    return AgentContext(registry=registry, llm_router=make_fake_router(provider=provider))
