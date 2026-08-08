import json
from pathlib import Path

from core import AgentDiscovery, AgentFactory

from .conftest import AGENTS_DIR, build_registry


def test_discovers_all_phase1_agents():
    registry = build_registry()
    ids = {a.id for a in registry.list_all()}
    assert {"researcher", "coder", "tester", "reviewer"} <= ids


def test_manifests_valid():
    for manifest_path in AGENTS_DIR.rglob("manifest.json"):
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        for key in ("id", "name", "role", "capabilities", "version"):
            assert key in manifest, f"Missing {key} in {manifest_path}"
        assert isinstance(manifest["capabilities"], list)


def test_broken_agent_does_not_kill_startup(tmp_path):
    # A valid agent ...
    valid = tmp_path / "ok"
    valid.mkdir(parents=True)
    valid.joinpath("manifest.json").write_text(
        json.dumps({"id": "ok_agent", "name": "OK", "role": "r",
                    "capabilities": ["x"], "version": "1.0.0"}),
        encoding="utf-8",
    )
    valid.joinpath("agent.py").write_text(
        "from core import BaseAgent\n"
        "class OkAgent(BaseAgent):\n"
        "    id='ok_agent'; name='OK'; role='r'; capabilities=['x']\n"
        "    async def run(self, task): return 'ok'\n",
        encoding="utf-8",
    )
    # ... and a broken one (missing agent.py).
    broken = tmp_path / "broken"
    broken.mkdir()
    broken.joinpath("manifest.json").write_text(
        json.dumps({"id": "bad", "name": "Bad", "role": "r",
                    "capabilities": ["y"], "version": "1.0.0"}),
        encoding="utf-8",
    )

    discovery = AgentDiscovery(tmp_path, AgentFactory())
    registry = build_registry()  # reuse helper for imports only
    from core import AgentRegistry

    reg = AgentRegistry()
    discovery.discover(reg)
    assert reg.get("ok_agent") is not None
    assert reg.get("bad") is None
    assert "ok_agent" in discovery.last_result.loaded
    assert len(discovery.last_result.errors) == 1


def test_disabled_agent_skipped(tmp_path):
    sub = tmp_path / "sub"
    sub.mkdir(parents=True)
    sub.joinpath("manifest.json").write_text(
        json.dumps({"id": "off", "name": "Off", "role": "r",
                    "capabilities": ["z"], "version": "1.0.0", "enabled": False}),
        encoding="utf-8",
    )
    sub.joinpath("agent.py").write_text(
        "from core import BaseAgent\n"
        "class OffAgent(BaseAgent):\n"
        "    id='off'; name='Off'; role='r'; capabilities=['z']\n"
        "    async def run(self, task): return 'off'\n",
        encoding="utf-8",
    )
    from core import AgentRegistry

    reg = AgentRegistry()
    AgentDiscovery(tmp_path, AgentFactory()).discover(reg)
    assert reg.get("off") is None
