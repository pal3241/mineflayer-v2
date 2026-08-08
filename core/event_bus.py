from __future__ import annotations

import asyncio
import inspect
import logging
from typing import Awaitable, Callable

from .event import Event, EventBusError

logger = logging.getLogger(__name__)

# Handler dapat sync atau async; keduanya menerima Event.
Handler = Callable[[Event], None | Awaitable[None]]


class EventBus:
    """Sistem event: Event -> subscriber(s).

    - `subscribe(type, handler)` mendaftarkan handler (sync / async).
    - `emit(event)` meneruskan event ke semua subscriber.
    - Isolasi error: satu subscriber yang rusak TIDAK menghentikan subscriber lain.
    """

    def __init__(self, max_handlers_per_type: int = 32):
        self._subscribers: dict[str, list[Handler]] = {}
        self._max_handlers = max_handlers_per_type
        self._subscriber_errors = 0

    def subscribe(self, event_type: str, handler: Handler) -> None:
        if not callable(handler):
            raise EventBusError("Handler harus callable.")
        subs = self._subscribers.setdefault(event_type, [])
        if handler not in subs:
            if len(subs) >= self._max_handlers:
                raise EventBusError(
                    f"Terlalu banyak subscriber untuk '{event_type}'."
                )
            subs.append(handler)

    def unsubscribe(self, event_type: str, handler: Handler) -> None:
        subs = self._subscribers.get(event_type)
        if subs and handler in subs:
            subs.remove(handler)

    def subscriber_count(self, event_type: str) -> int:
        return len(self._subscribers.get(event_type, []))

    @property
    def subscriber_error_count(self) -> int:
        return self._subscriber_errors

    async def emit(self, event: Event) -> None:
        """Teruskan event ke semua subscriber, dengan isolasi error."""
        if not event.type or not event.source:
            raise EventBusError("Event memerlukan 'type' dan 'source'.")
        handlers = list(self._subscribers.get(event.type, ()))
        for handler in handlers:
            try:
                result = handler(event)
                if inspect.isawaitable(result):
                    await result
            except Exception as exc:  # pragma: no cover - isolation guard
                self._subscriber_errors += 1
                logger.error(
                    "Event subscriber gagal untuk '%s' di %s: %s",
                    event.type,
                    getattr(handler, "__name__", handler),
                    exc,
                )
                # isolasi error: lanjut ke subscriber berikutnya

    def emit_sync(self, event: Event) -> None:
        """Emit dari kode sinkron (discovery / registry).

        - Jika ada event loop berjalan: jadwalkan sebagai task.
        - Jika tidak: jalankan dengan event loop sementara (deterministik).
        """
        try:
            asyncio.get_running_loop()
        except RuntimeError:
            loop_running = False
        else:
            loop_running = True

        if loop_running:
            asyncio.get_running_loop().create_task(self.emit(event))
        else:
            try:
                asyncio.run(self.emit(event))
            except RuntimeError:  # pragma: no cover - defensive
                logger.warning("Gagal menjalankan event '%s'", event.type)
