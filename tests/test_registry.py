from __future__ import annotations

from core import AgentStatus, BaseAgent

from .conftest import build_registry


class Alpha(BaseAgent):
    id = "alpha"
    name = "Alpha"
    role = "alpha"
    capabilities = ["python", "debugging"]
    version = "1.0.0"
    category = "utility"

    async def run(self, task):
        return "alpha"


class Beta(BaseAgent):
    id = "beta"
    name = "Beta"
    role = "beta"
    capabilities = ["python"]
    version = "1.0.0"
    category = "utility"

    async def run(self, task):
        return "beta"


class Gamma(BaseAgent):
    id = "gamma"
    name = "Gamma"
    role = "gamma"
    capabilities = ["debugging"]
    version = "1.0.0"
    category = "utility"

    async def run(self, task):
        return "gamma"


def make_registry():
    from core import AgentRegistry

    reg = AgentRegistry()
    reg.register(Alpha())
    reg.register(Beta())
    reg.register(Gamma())
    return reg


def test_register_and_get():
    reg = make_registry()
    assert reg.get("alpha").name == "Alpha"
    assert reg.get("alpha").status == AgentStatus.READY


def test_duplicate_register_raises():
    reg = make_registry()
    try:
        reg.register(Alpha())
    except ValueError:
        return
    raise AssertionError("Duplicate registration should raise ValueError")


def test_unregister():
    reg = make_registry()
    reg.unregister("beta")
    assert reg.get("beta") is None


def test_list_all():
    reg = make_registry()
    assert {a.id for a in reg.list_all()} == {"alpha", "beta", "gamma"}


def test_find_by_capability():
    reg = make_registry()
    python_agents = reg.find_by_capability("python")
    assert {a.id for a in python_agents} == {"alpha", "beta"}


def test_find_best_picks_most_capabilities():
    reg = make_registry()
    best = reg.find_best(["python", "debugging"])
    assert best.id == "alpha"


def test_enable_disable():
    reg = make_registry()
    reg.disable("beta")
    assert reg.get("beta").status == AgentStatus.DISABLED
    # Disabled agent is not a candidate for capability routing.
    assert "beta" not in {a.id for a in reg.find_by_capability("python")}
    reg.enable("beta")
    assert "beta" in {a.id for a in reg.find_by_capability("python")}
