from __future__ import annotations

import asyncio
from pathlib import Path

from core import AgentContext, AgentDiscovery, AgentFactory, AgentRegistry, Task
from llm import LLMResponse, LLMRouter
from llm.models import InvalidResponseError
from llm.providers.base import BaseLLMProvider

PLAN_JSON = (
    '{"goal":"Buat kalkulator Python","tasks":['
    '{"title":"Analisis kebutuhan","capability":"analysis"},'
    '{"title":"Implementasikan kalkulator","capability":"coding"},'
    '{"title":"Test kalkulator","capability":"testing"}]}'
)
INVALID_PLAN_JSON = '{"goal":123,"tasks":"bukan list"}'


class FakeProvider(BaseLLMProvider):
    name = "fake"

    def __init__(self, content: str):
        self.content = content

    async def generate(self, messages, model, temperature=0.7, **kwargs):
        return LLMResponse(content=self.content, model=model, provider=self.name)


def build_ctx(content: str) -> AgentContext:
    router = LLMRouter(
        model_config={"reasoning-model": {"provider": "fake", "model": "fake-1"}},
        providers={"fake": FakeProvider(content)},
    )
    registry = AgentRegistry()
    return AgentContext(registry=registry, llm_router=router)


def discover_planner(ctx: AgentContext):
    registry = AgentRegistry()
    factory = AgentFactory(ctx)
    AgentDiscovery(Path(__file__).resolve().parents[2], factory).discover(registry)
    return registry.get("planner")


def test_planner_discovered():
    planner = discover_planner(build_ctx(PLAN_JSON))
    assert planner is not None
    assert planner.status.name == "READY"


def test_planner_uses_llm():
    planner = discover_planner(build_ctx(PLAN_JSON))
    output = asyncio.run(planner.run(Task("Buat kalkulator", "planning")))
    assert output["type"] == "task_plan"
    assert output["goal"] == "Buat kalkulator Python"
    assert len(output["tasks"]) == 3
    assert output["tasks"][0]["capability"] == "analysis"


def test_planner_rejects_invalid_llm_json():
    planner = discover_planner(build_ctx(INVALID_PLAN_JSON))
    try:
        asyncio.run(planner.run(Task("Buat kalkulator", "planning")))
    except InvalidResponseError:
        return
    raise AssertionError("Planner harus menolak output LLM yang invalid")


def test_planner_fails_without_router():
    ctx = AgentContext(registry=AgentRegistry())  # no llm_router
    planner = discover_planner(ctx)
    try:
        asyncio.run(planner.run(Task("Buat kalkulator", "planning")))
    except Exception as exc:
        assert "router" in str(exc).lower()
        return
    raise AssertionError("Planner harus gagal dengan error jelas tanpa router")
