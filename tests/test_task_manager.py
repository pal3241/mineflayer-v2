import asyncio

from core import Task, TaskManager, TaskStatus

from .conftest import build_registry


def test_execute_known_capability():
    registry = build_registry()
    result = asyncio.run(TaskManager(registry).execute(Task("Riset topik", "research")))
    assert result.success
    assert result.agent_id == "researcher"
    assert result.output["type"] == "research_report"


def test_execute_unknown_capability_fails():
    registry = build_registry()
    task = Task("Tidak ada agent", "nonexistent_capability")
    result = asyncio.run(TaskManager(registry).execute(task))
    assert not result.success
    assert task.status == TaskStatus.FAILED


def test_execute_updates_health():
    registry = build_registry()
    tm = TaskManager(registry)
    asyncio.run(tm.execute(Task("Tulis fungsi", "coding")))
    coder = registry.get("coder")
    assert coder.health.tasks_completed == 1
    assert coder.health.success_rate == 1.0


def test_agent_selected_by_capability():
    registry = build_registry()
    task = Task("Buat kode", "code_review")
    result = asyncio.run(TaskManager(registry).execute(task))
    assert result.agent_id == "reviewer"
