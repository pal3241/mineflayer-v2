from __future__ import annotations

from dataclasses import dataclass, field


class LLMError(Exception):
    """Base error untuk semua kegagalan lapisan LLM."""


class ProviderError(LLMError):
    """Kegagalan tingkat provider (HTTP, jaringan, provider tidak dikenal)."""


class AuthenticationError(ProviderError):
    """Kredensial tidak valid / hilang. TIDAK aman untuk di-retry otomatis."""


class RateLimitError(ProviderError):
    """Rate limit / overload sementara. Aman untuk di-retry."""


class LLMTimeoutError(LLMError):
    """Provider tidak menjawab dalam batas waktu. Aman untuk di-retry."""


# Alias agar nama mengikuti spesifikasi, tetap konsisten secara internal.
TimeoutError = LLMTimeoutError


class InvalidResponseError(LLMError):
    """Provider mengembalikan respon yang malformed / tidak sesuai skema."""


class ModelNotFoundError(ProviderError):
    """Model alias atau model ID tidak dikenal / tidak tersedia."""


@dataclass
class LLMResponse:
    """Respon LLM terstruktur. Tidak pernah mengembalikan raw HTTP ke Agent."""

    content: str
    model: str
    provider: str
    usage: dict = field(default_factory=dict)
    finish_reason: str | None = None
    metadata: dict = field(default_factory=dict)