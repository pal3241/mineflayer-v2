from __future__ import annotations

import argparse
import asyncio
from pathlib import Path

from core import (
    AgentContext,
    AgentDiscovery,
    AgentFactory,
    AgentRegistry,
    EventBus,
    MessageBus,
    Task,
    TaskManager,
)
from llm import build_llm_router


def build_registry() -> AgentRegistry:
    event_bus = EventBus()
    registry = AgentRegistry(event_bus=event_bus)
    message_bus = MessageBus(registry=registry, event_bus=event_bus)
    router = build_llm_router(config_dir=Path(__file__).parent / "config")
    context = AgentContext(
        registry=registry,
        llm_router=router,
        message_bus=message_bus,
        event_bus=event_bus,
    )
    task_manager = TaskManager(registry, event_bus=event_bus)
    context.task_manager = task_manager
    discovery = AgentDiscovery(
        Path(__file__).parent / "agents",
        AgentFactory(context),
        event_bus=event_bus,
    )
    discovery.discover(registry)
    return registry



def main() -> None:
    parser = argparse.ArgumentParser(description="Modular Multi-Agent Team")
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("agents", help="list discovered agents")
    run_parser = subparsers.add_parser("run", help="run a task")
    run_parser.add_argument("capability")
    run_parser.add_argument("description")
    args = parser.parse_args()
    registry = build_registry()
    if args.command == "agents":
        for agent in registry.list_all():
            print(f"{agent.id:<14} {agent.status.value:<8} {', '.join(agent.capabilities)}")
    else:
        result = asyncio.run(TaskManager(registry).execute(Task(args.description, args.capability)))
        print(result.output if result.success else f"ERROR: {result.error}")


if __name__ == "__main__":
    main()
