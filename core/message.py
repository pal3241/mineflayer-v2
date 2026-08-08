from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any
from uuid import uuid4


class MessageType(str, Enum):
    """Jenis message yang valid. Hindari string acak tanpa validasi."""

    REQUEST = "request"
    RESPONSE = "response"
    NOTIFICATION = "notification"
    ERROR = "error"
    BROADCAST = "broadcast"


class MessageStatus(str, Enum):
    PENDING = "PENDING"
    DELIVERED = "DELIVERED"
    FAILED = "FAILED"
    EXPIRED = "EXPIRED"


class MessageError(Exception):
    """Base error lapisan message."""


class MessageValidationError(MessageError):
    """Message tidak valid."""


class RecipientNotFoundError(MessageError):
    """Recipient tidak dikenal oleh registry."""


class RequestTimeoutError(MessageError):
    """Request tidak dijawab dalam batas waktu."""


@dataclass
class Message:
    sender: str
    recipient: str
    type: MessageType
    content: Any = ""
    task_id: str | None = None
    correlation_id: str | None = None
    id: str = field(default_factory=lambda: uuid4().hex)
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    status: MessageStatus = MessageStatus.PENDING
    metadata: dict = field(default_factory=dict)

    def validate(self) -> None:
        """Validasi field wajib (sender, recipient, type)."""
        if not self.sender:
            raise MessageValidationError("Message memerlukan 'sender'.")
        if not self.recipient:
            raise MessageValidationError("Message memerlukan 'recipient'.")
        if not isinstance(self.type, MessageType):
            raise MessageValidationError(
                f"'type' harus MessageType, bukan {self.type!r}."
            )
