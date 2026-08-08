from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any


class AgentStatus(str, Enum):
    DISCOVERED = "DISCOVERED"
    REGISTERED = "REGISTERED"
    READY = "READY"
    WORKING = "WORKING"
    IDLE = "IDLE"
    DISABLED = "DISABLED"
    FAILED = "FAILED"


@dataclass
class AgentHealth:
    tasks_completed: int = 0
    tasks_failed: int = 0
    current_load: int = 0
    total_execution_time: float = 0.0
    last_active: datetime | None = None

    @property
    def success_rate(self) -> float:
        total = self.tasks_completed + self.tasks_failed
        return self.tasks_completed / total if total else 1.0

    @property
    def average_execution_time(self) -> float:
        return self.total_execution_time / self.tasks_completed if self.tasks_completed else 0.0


@dataclass
class AgentContext:
    registry: Any = None
    task_manager: Any = None
    llm_router: Any = None
    message_bus: Any = None
    event_bus: Any = None


class BaseAgent(ABC):
    id = "base_agent"
    name = "Base Agent"
    role = "Base agent"
    capabilities: list[str] = []
    version = "1.0.0"
    model = None
    category = "utility"

    def __init__(self, context: AgentContext | None = None):
        self.context = context or AgentContext()
        self.status = AgentStatus.DISCOVERED
        self.health = AgentHealth()

    @abstractmethod
    async def run(self, task: Any) -> Any:
        """Execute a task and return a serializable result."""

    def can_handle(self, capability: str) -> bool:
        return capability in self.capabilities

    async def llm(
        self,
        messages: list[dict],
        temperature: float = 0.7,
        **kwargs,
    ):
        """Kirim chat request ke LLM melalui Router milik context.

        Opsional: hanya agent yang membutuhkan LLM yang memanggil ini.
        Jika router tidak tersedia / model alias tidak diset, lemparkan
        error yang jelas (bukan crash tanpa informasi).
        """
        from llm.models import LLMError

        router = self.context.llm_router if self.context else None
        if router is None:
            raise LLMError(
                f"Agent '{self.id}' meminta LLM tetapi tidak ada LLM router di context."
            )
        if not self.model:
            raise LLMError(f"Agent '{self.id}' tidak memiliki model alias.")
        return await router.generate(
            model=self.model,
            messages=messages,
            temperature=temperature,
            **kwargs,
        )

    async def send_message(
        self,
        recipient: str,
        content: Any,
        msg_type="notification",
        task_id: str | None = None,
        correlation_id: str | None = None,
    ):
        """Wrapper komunikasi: kirim message ke agent lain via MessageBus.

        Hanya wrapper terhadap infrastructure; BaseAgent tidak mengenal agent
        tertentu. Jika MessageBus tidak tersedia -> error jelas.
        """
        from .message import Message, MessageType, MessageError

        bus = self.context.message_bus if self.context else None
        if bus is None:
            raise MessageError(
                f"Agent '{self.id}' meminta MessageBus tetapi tidak tersedia di context."
            )
        if not isinstance(msg_type, MessageType):
            msg_type = MessageType(msg_type)
        message = Message(
            sender=self.id,
            recipient=recipient,
            type=msg_type,
            content=content,
            task_id=task_id,
            correlation_id=correlation_id,
        )
        return await bus.send(message)

    async def emit_event(
        self,
        event_type: str,
        data: dict | None = None,
        correlation_id: str | None = None,
    ) -> None:
        """Wrapper event: emit event ke EventBus.

        Jika EventBus tidak tersedia -> error jelas.
        """
        from .event import Event, EventBusError
        from .event_bus import EventBus

        bus = self.context.event_bus if self.context else None
        if bus is None:
            raise EventBusError(
                f"Agent '{self.id}' meminta EventBus tetapi tidak tersedia di context."
            )
        return await bus.emit(
            Event(
                type=event_type,
                source=self.id,
                data=data or {},
                correlation_id=correlation_id,
            )
        )

    async def handle_message(self, message: Any) -> Any:
        """Opsional: override pada subclass untuk menjawab request via MessageBus.

        Default mengembalikan None (tidak menjawab otomatis).
        """
        return None

    def mark_working(self) -> None:
        self.status = AgentStatus.WORKING
        self.health.current_load += 1
        self.health.last_active = datetime.now(timezone.utc)

    def mark_ready(self) -> None:
        self.status = AgentStatus.READY
        self.health.current_load = max(0, self.health.current_load - 1)

    def mark_failed(self) -> None:
        self.status = AgentStatus.FAILED
        self.health.current_load = max(0, self.health.current_load - 1)
        self.health.tasks_failed += 1
