import asyncio

from core import AgentDiscovery, AgentFactory, AgentRegistry, Task

from .conftest import AGENTS_DIR, FakeLLMProvider, build_ctx_with_fake_llm

ANALYSIS_JSON = (
    '{"summary":"Ringkasan","issues":[{"title":"Masalah","severity":"high",'
    '"detail":"detail"}],"recommendation":"Rekomendasi"}'
)
PLAN_JSON = (
    '{"goal":"Buat kalkulator","tasks":'
    '[{"title":"Implementasi","capability":"coding"}]}'
)


def discover_all(provider):
    ctx = build_ctx_with_fake_llm(provider)
    registry = AgentRegistry()
    AgentDiscovery(AGENTS_DIR, AgentFactory(ctx)).discover(registry)
    return registry


def test_analyst_and_planner_auto_discovered():
    def content(model, messages):
        return ANALYSIS_JSON if model == "fake-reasoning" else PLAN_JSON

    registry = discover_all(FakeLLMProvider(responses=content))
    ids = {a.id for a in registry.list_all()}
    assert {"analyst", "planner"} <= ids


def test_analyst_via_real_discovery():
    registry = discover_all(FakeLLMProvider(responses=[(ANALYSIS_JSON, {})]))
    analyst = registry.get("analyst")
    out = asyncio.run(analyst.run(Task("Analisis", "analysis")))
    assert out["type"] == "analysis"
    assert out["summary"] == "Ringkasan"
    assert out["issues"][0]["title"] == "Masalah"


def test_planner_via_real_discovery():
    registry = discover_all(FakeLLMProvider(responses=[(PLAN_JSON, {})]))
    planner = registry.get("planner")
    out = asyncio.run(planner.run(Task("Rencanakan", "planning")))
    assert out["type"] == "task_plan"
    assert out["tasks"][0]["capability"] == "coding"


def test_phase1_agents_still_work_with_router_in_context():
    # Menaruh router di context TIDAK mengubah perilaku agent Phase 1.
    registry = discover_all(FakeLLMProvider(responses=[("ignored", {})]))
    from core import TaskManager

    result = asyncio.run(TaskManager(registry).execute(Task("Riset topik", "research")))
    assert result.success
    assert result.agent_id == "researcher"
