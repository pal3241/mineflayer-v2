from __future__ import annotations

import asyncio
import logging
from collections import defaultdict, deque
from typing import Any, Iterable
from uuid import uuid4

from .event import Event, EventType
from .event_bus import EventBus
from .message import (
    Message,
    MessageStatus,
    MessageType,
    MessageValidationError,
    RecipientNotFoundError,
    RequestTimeoutError,
)

from .agent import BaseAgent

logger = logging.getLogger(__name__)


class MessageBus:
    """Bus komunikasi antar-agent.

    Mendukung:
      - direct message   (send)
      - broadcast        (broadcast)
      - request/reply    (request + handle_message, dicocokkan via correlation_id)
      - inbox per recipient, bounded history, message events, logging.

    Berperilaku aman untuk beberapa coroutine (semua operasi async non-blocking);
    paralelisme tugas penuh bukan fokus Phase 3.
    """

    def __init__(
        self,
        registry: Any = None,
        event_bus: EventBus | None = None,
        history_limit: int = 200,
    ):
        self.registry = registry
        self.event_bus = event_bus
        self._inbox: dict[str, deque[Message]] = defaultdict(deque)
        self._history: deque[Message] = deque(maxlen=history_limit)
        self._stats = {"sent": 0, "delivered": 0, "failed": 0}

    # ------------------------------------------------------------------ util
    def _known_recipient(self, recipient: str) -> bool:
        if self.registry is None:
            return True  # tanpa registry tidak bisa divalidasi
        return self.registry.get(recipient) is not None

    def _remember(self, message: Message) -> None:
        self._history.append(message)

    async def _emit(self, event_type: str, message: Message, **extra: Any) -> None:
        if self.event_bus is None:
            return
        data = {
            "message_id": message.id,
            "sender": message.sender,
            "recipient": message.recipient,
            "type": message.type.value,
            "task_id": message.task_id,
            "correlation_id": message.correlation_id,
            "status": message.status.value,
            **extra,
        }
        await self.event_bus.emit(
            Event(type=event_type, source="message_bus", data=data)
        )

    # ------------------------------------------------------------------ send
    async def send(self, message: Message) -> Message:
        if not isinstance(message, Message):
            raise MessageValidationError("Hanya objek Message yang bisa dikirim.")
        message.validate()

        if not self._known_recipient(message.recipient):
            message.status = MessageStatus.FAILED
            self._stats["failed"] += 1
            self._remember(message)
            await self._emit(EventType.MESSAGE_FAILED, message, reason="recipient_not_found")
            logger.warning(
                "Message delivery failed: %s -> %s (recipient tidak dikenal)",
                message.sender,
                message.recipient,
            )
            raise RecipientNotFoundError(f"Recipient tidak dikenal: {message.recipient}")

        message.status = MessageStatus.DELIVERED
        self._inbox[message.recipient].append(message)
        self._stats["sent"] += 1
        self._stats["delivered"] += 1
        self._remember(message)
        await self._emit(EventType.MESSAGE_SENT, message)
        await self._emit(EventType.MESSAGE_DELIVERED, message)
        logger.info("Message delivered: %s -> %s (%s)", message.sender, message.recipient, message.type.value)
        return message

    # ------------------------------------------------------------- broadcast
    async def broadcast(
        self,
        sender: str,
        content: Any,
        msg_type: MessageType = MessageType.NOTIFICATION,
        task_id: str | None = None,
        exclude: Iterable[str] | None = None,
    ) -> list[str]:
        excluded = set(exclude or ())
        recipients = self._all_recipients()
        delivered: list[str] = []
        for recipient in recipients:
            if recipient == sender or recipient in excluded:
                continue
            message = Message(
                sender=sender,
                recipient=recipient,
                type=msg_type,
                content=content,
                task_id=task_id,
            )
            try:
                await self.send(message)
                delivered.append(recipient)
            except MessageError:
                continue
        return delivered

    def _all_recipients(self) -> list[str]:
        if self.registry is not None:
            return [agent.id for agent in self.registry.list_all()]
        return list(self._inbox)

    # ---------------------------------------------------------- request/reply
    async def request(
        self,
        sender: str,
        recipient: str,
        content: Any,
        timeout: float = 30.0,
        task_id: str | None = None,
    ) -> Any:
        """Kirim request dan tunggu jawaban dengan batas waktu.

        Jawaban diproduksi oleh `handle_message` milik recipient dan
        dicocokkan lewat `correlation_id`. Timeout -> RequestTimeoutError.
        """
        correlation = uuid4().hex
        message = Message(
            sender=sender,
            recipient=recipient,
            type=MessageType.REQUEST,
            content=content,
            task_id=task_id,
            correlation_id=correlation,
        )
        await self.send(message)

        agent = self.registry.get(recipient) if self.registry is not None else None
        handler = getattr(agent, "handle_message", None)
        # Jika agent tidak menimpa handle_message -> tidak bisa menjawab request.
        if not callable(handler) or type(agent).handle_message is BaseAgent.handle_message:
            raise RequestTimeoutError(
                f"Recipient '{recipient}' tidak bisa menjawab request (tidak ada handle_message)."
            )

        try:
            result = await asyncio.wait_for(handler(message), timeout)
        except asyncio.TimeoutError as exc:
            raise RequestTimeoutError(
                f"Request ke '{recipient}' timeout setelah {timeout}s."
            ) from exc

        response = Message(
            sender=recipient,
            recipient=sender,
            type=MessageType.RESPONSE,
            content=result,
            task_id=task_id,
            correlation_id=correlation,
        )
        await self.send(response)
        logger.info("Response: %s <- %s (corr=%s)", sender, recipient, correlation)
        return result

    async def reply(self, request: Message, content: Any) -> Message:
        """Balas sebuah request secara eksplisit (pola request/reply asinkron)."""
        response = Message(
            sender=request.recipient,
            recipient=request.sender,
            type=MessageType.RESPONSE,
            content=content,
            task_id=request.task_id,
            correlation_id=request.correlation_id,
        )
        return await self.send(response)

    # ---------------------------------------------------------------- inbox
    def receive(self, agent_id: str) -> Message | None:
        inbox = self._inbox.get(agent_id)
        return inbox.popleft() if inbox else None

    def pending_count(self, agent_id: str) -> int:
        return len(self._inbox.get(agent_id, ()))

    # --------------------------------------------------------------- history
    def history(self, limit: int | None = None) -> list[Message]:
        items = list(self._history)
        if limit is not None:
            items = items[-limit:]
        return items

    def stats(self) -> dict:
        return dict(self._stats)

