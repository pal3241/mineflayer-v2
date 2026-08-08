from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4


class EventBusError(Exception):
    """Error pada lapisan event."""


class EventType:
    """Katalog nama tipe event agar konsisten di seluruh sistem."""

    # Lifecycle agent
    AGENT_DISCOVERED = "agent.discovered"
    AGENT_REGISTERED = "agent.registered"
    AGENT_READY = "agent.ready"
    AGENT_FAILED = "agent.failed"
    AGENT_DISABLED = "agent.disabled"

    # Task
    TASK_CREATED = "task.created"
    TASK_STARTED = "task.started"
    TASK_COMPLETED = "task.completed"
    TASK_FAILED = "task.failed"

    # Message
    MESSAGE_SENT = "message.sent"
    MESSAGE_DELIVERED = "message.delivered"
    MESSAGE_FAILED = "message.failed"


@dataclass
class Event:
    type: str
    source: str
    data: dict = field(default_factory=dict)
    correlation_id: str | None = None
    id: str = field(default_factory=lambda: uuid4().hex)
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
