from __future__ import annotations

from collections import Counter
from typing import Any

from core import BaseAgent, Message, MessageError


class Communicator(BaseAgent):
    """Membuat, meneruskan, dan merangkum komunikasi antar-agent.

    Tidak pernah hard-code agent tertentu — hanya membaca infrastruktur
    MessageBus (history + stats) dan kemampuan generic routing.
    """

    id = "communicator"
    name = "Communicator"
    role = "Membuat, meneruskan, dan merangkum komunikasi antar-agent"
    capabilities = ["communication", "messaging", "coordination"]
    version = "1.0.0"
    category = "communication"
    model = None

    async def run(self, task: Any) -> dict:
        bus = self.context.message_bus if self.context else None
        if bus is None:
            raise MessageError(f"Agent '{self.id}' butuh MessageBus di context.")
        messages = bus.history(limit=100)
        by_type = Counter(message.type.value for message in messages)
        return {
            "type": "communication_summary",
            "total_messages": len(messages),
            "by_type": dict(by_type),
            "senders": sorted({m.sender for m in messages}),
            "recipients": sorted({m.recipient for m in messages}),
        }

    async def handle_message(self, message: Message) -> dict:
        """Jawab request ringkas tentang komunikasi (generic routing)."""
        return {
            "agent": self.id,
            "ack": True,
            "request_type": message.type.value,
        }
