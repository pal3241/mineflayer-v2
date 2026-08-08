from __future__ import annotations

from typing import Any, Iterable

from .models import LLMError, RateLimitError, TimeoutError
from .providers.base import BaseLLMProvider

# Error yang AMAN untuk di-retry otomatis (transient).
# Error lain (AuthenticationError, ModelNotFoundError, InvalidResponse, ...)
# dilempar langsung tanpa retry.
_RETRYABLE = (RateLimitError, TimeoutError)


class ApiKeyManager:
    """Mengelola multiple API keys: rotasi, health per key, batas kegagalan."""

    def __init__(self, keys: Iterable[str], max_failures: int = 3):
        self.keys = list(dict.fromkeys(keys))  # dedupe, pertahankan urutan
        self._failures = {key: 0 for key in self.keys}
        self._successes = {key: 0 for key in self.keys}
        self._cursor = 0
        self.max_failures = max_failures

    @property
    def available(self) -> bool:
        return self.get_available_key() is not None

    def get_available_key(self) -> str | None:
        """Rotasi round-robin; lewati key yang sudah melewati batas kegagalan."""
        if not self.keys:
            return None
        for _ in range(len(self.keys)):
            key = self.keys[self._cursor % len(self.keys)]
            self._cursor += 1
            if self._failures.get(key, 0) < self.max_failures:
                return key
        return None

    def mark_failure(self, key: str) -> None:
        if key in self._failures:
            self._failures[key] += 1

    def mark_success(self, key: str) -> None:
        if key in self._failures:
            self._failures[key] = 0
            self._successes[key] += 1

    def stats(self) -> dict:
        return {
            "failures": dict(self._failures),
            "successes": dict(self._successes),
        }


class LLMClient:
    """Menghubungkan Router ke satu provider, dengan retry terbatas + rotasi key.

    Alur request:
      1. ambil key tersedia (ApiKeyManager.get_available_key)
      2. panggil provider.generate(..., api_key=key)
      3. sukses -> mark_success(key)
      4. error transient -> mark_failure(key), coba key lain (maks max_retries)
      5. error non-transient -> langsung lempar, tanpa retry
    """

    def __init__(
        self,
        provider: BaseLLMProvider,
        key_manager: ApiKeyManager | None = None,
        max_retries: int = 3,
    ):
        self.provider = provider
        self.key_manager = key_manager
        self.max_retries = max_retries

    async def generate(
        self,
        messages: list[dict],
        model: str,
        temperature: float = 0.7,
        **kwargs: Any,
    ):
        last_error: LLMError | None = None
        attempts = 0
        while attempts < self.max_retries:
            attempts += 1
            key = self.key_manager.get_available_key() if self.key_manager else None
            try:
                response = await self.provider.generate(
                    messages=messages,
                    model=model,
                    temperature=temperature,
                    api_key=key,
                    **kwargs,
                )
                if self.key_manager and key:
                    self.key_manager.mark_success(key)
                return response
            except _RETRYABLE as exc:
                if self.key_manager and key:
                    self.key_manager.mark_failure(key)
                last_error = exc
                # error transient: lanjut ke percobaan berikutnya / key lain
            except LLMError:
                raise  # non-transient: jangan retry

        if last_error is None:
            raise RateLimitError("LLM request gagal tanpa error yang dapat dilaporkan")
        raise RateLimitError(
            f"LLM request gagal setelah {self.max_retries} percobaan: {last_error}"
        )