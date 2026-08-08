from __future__ import annotations

import asyncio
from pathlib import Path

from core import AgentContext, AgentDiscovery, AgentFactory, AgentRegistry, Task
from llm import LLMResponse, LLMRouter
from llm.models import InvalidResponseError
from llm.providers.base import BaseLLMProvider

ANALYSIS_JSON = (
    '{"summary":"Ringkasan","issues":[{"title":"Masalah","severity":"high",'
    '"detail":"detail"}],"recommendation":"Rekomendasi"}'
)
INVALID_JSON = "ini bukan json"


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


def discover_analyst(ctx: AgentContext):
    registry = AgentRegistry()
    factory = AgentFactory(ctx)
    AgentDiscovery(Path(__file__).resolve().parents[2], factory).discover(registry)
    return registry.get("analyst")


def test_analyst_discovered():
    analyst = discover_analyst(build_ctx(ANALYSIS_JSON))
    assert analyst is not None
    assert analyst.status.name == "READY"


def test_analyst_uses_llm():
    analyst = discover_analyst(build_ctx(ANALYSIS_JSON))
    output = asyncio.run(analyst.run(Task("Analisis masalah", "analysis")))
    assert output["type"] == "analysis"
    assert output["summary"] == "Ringkasan"
    assert len(output["issues"]) == 1


def test_analyst_rejects_invalid_llm_json():
    analyst = discover_analyst(build_ctx(INVALID_JSON))
    try:
        asyncio.run(analyst.run(Task("Analisis masalah", "analysis")))
    except InvalidResponseError:
        return
    raise AssertionError("Analyst harus menolak output LLM yang invalid")


def test_analyst_fails_without_router():
    ctx = AgentContext(registry=AgentRegistry())  # no llm_router
    analyst = discover_analyst(ctx)
    from core import AgentStatus

    try:
        asyncio.run(analyst.run(Task("Analisis masalah", "analysis")))
    except Exception as exc:
        assert "router" in str(exc).lower()
        return
    raise AssertionError("Analyst harus gagal dengan error jelas tanpa router")
