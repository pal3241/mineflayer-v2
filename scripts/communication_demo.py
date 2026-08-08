"""Demo komunikasi Phase 3: direct message, broadcast, request/reply.

Menjalankan:  python -m scripts.communication_demo
"""
from __future__ import annotations

import asyncio

from core import (
    AgentContext,
    AgentRegistry,
    BaseAgent,
    EventBus,
    Message,
    MessageBus,
    MessageType,
)


class Worker(BaseAgent):
    id = "worker"
    name = "Worker"
    role = "worker"
    capabilities = ["work"]
    version = "1.0.0"
    category = "utility"

    async def run(self, task):
        return "done"

    async def handle_message(self, message):
        return f"jawaban-untuk-{message.sender}:{message.content}"


class CoordinatorPlaceholder(BaseAgent):
    id = "coordinator"
    name = "Coordinator(placeholder)"
    role = "sender contoh"
    capabilities = ["coordination"]
    version = "1.0.0"
    category = "manager"

    async def run(self, task):
        return "coordinated"


async def main() -> None:
    registry = AgentRegistry()
    registry.register(Worker())
    registry.register(CoordinatorPlaceholder())
    bus = MessageBus(registry=registry, event_bus=EventBus())
    ctx = AgentContext(registry=registry, message_bus=bus)
    worker = Worker(ctx)

    # 1) Direct message
    msg = Message(sender="coordinator", recipient="worker", type=MessageType.NOTIFICATION, content="mulai")
    await bus.send(msg)
    received = bus.receive("worker")
    print("1. direct    :", received.sender, "->", received.recipient, "|", received.content,
          "| status:", received.status.value)

    # 2) Broadcast (ke semua kecuali sender)
    delivered = await bus.broadcast(sender="coordinator", content="update")
    print("2. broadcast :", delivered)

    # 3) Request/reply dengan correlation_id
    answer = await bus.request(sender="coordinator", recipient="worker", content="data riset", timeout=5)
    response = next(m for m in bus.history() if m.type == MessageType.RESPONSE)
    request = next(m for m in bus.history() if m.type == MessageType.REQUEST)
    print("3. request   : answer =", answer)
    print("   corr match:", response.correlation_id == request.correlation_id)
    print("   stats     :", bus.stats())


if __name__ == "__main__":
    asyncio.run(main())