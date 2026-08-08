from __future__ import annotations

import importlib.util
import json
from dataclasses import dataclass, field
from pathlib import Path

from .agent import BaseAgent
from .factory import AgentFactory
from .registry import AgentRegistry


@dataclass
class DiscoveryResult:
    loaded: list[str] = field(default_factory=list)
    errors: dict[str, str] = field(default_factory=dict)


class AgentDiscovery:
    def __init__(self, agents_dir: str | Path, factory: AgentFactory | None = None, event_bus=None):
        self.agents_dir = Path(agents_dir)
        self.factory = factory or AgentFactory()
        self.event_bus = event_bus
        self.last_result = DiscoveryResult()

    def _emit(self, event_type: str, agent_id: str, **extra) -> None:
        if self.event_bus is None:
            return
        from .event import Event, EventType

        data = {"agent_id": agent_id, **extra}
        self.event_bus.emit_sync(Event(type=event_type, source="discovery", data=data))

    def discover(self, registry: AgentRegistry) -> list[BaseAgent]:
        result = DiscoveryResult()
        for manifest_path in sorted(self.agents_dir.rglob("manifest.json")):
            try:
                manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
                self._validate_manifest(manifest)
                if not manifest.get("enabled", True):
                    continue
                module_path = manifest_path.parent / "agent.py"
                module = self._load_module(module_path, manifest["id"])
                agent_class = self._find_agent_class(module)
                agent = self.factory.create(agent_class)
                self._apply_manifest(agent, manifest)
                self._emit("agent.discovered", agent.id)
                registry.register(agent)
                result.loaded.append(agent.id)
            except Exception as exc:  # One bad plugin must not stop startup.
                result.errors[str(manifest_path)] = str(exc)
        self.last_result = result
        return [registry.get(agent_id) for agent_id in result.loaded]

    @staticmethod
    def _validate_manifest(manifest: dict) -> None:
        required = ("id", "name", "role", "capabilities", "version")
        missing = [key for key in required if key not in manifest]
        if missing or not isinstance(manifest.get("capabilities"), list):
            raise ValueError(f"Invalid manifest; missing: {', '.join(missing)}")

    @staticmethod
    def _load_module(path: Path, agent_id: str):
        if not path.exists():
            raise FileNotFoundError(f"Missing agent.py for {agent_id}")
        spec = importlib.util.spec_from_file_location(f"discovered_agent_{agent_id}", path)
        if spec is None or spec.loader is None:
            raise ImportError(f"Cannot import {path}")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    @staticmethod
    def _find_agent_class(module) -> type[BaseAgent]:
        classes = [value for value in vars(module).values() if isinstance(value, type) and issubclass(value, BaseAgent) and value is not BaseAgent]
        if len(classes) != 1:
            raise ValueError("agent.py must define exactly one BaseAgent subclass")
        return classes[0]

    @staticmethod
    def _apply_manifest(agent: BaseAgent, manifest: dict) -> None:
        for key in ("id", "name", "role", "capabilities", "version", "model", "category"):
            if key in manifest:
                setattr(agent, key, manifest[key])
