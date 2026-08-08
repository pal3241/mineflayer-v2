from __future__ import annotations

from typing import Any

import httpx

from ..models import (
    AuthenticationError,
    InvalidResponseError,
    LLMResponse,
    ModelNotFoundError,
    ProviderError,
    RateLimitError,
    TimeoutError,
)
from .base import BaseLLMProvider

_OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

# Parameter payload yang diizinkan diteruskan dari kwargs ke API.
_ALLOWED_PAYLOAD = {
    "max_tokens",
    "top_p",
    "stop",
    "frequency_penalty",
    "presence_penalty",
    "seed",
}


class OpenRouterProvider(BaseLLMProvider):
    """Provider OpenRouter (HTTP async via httpx).

    API key DIBERIKAN per request melalui kwarg `api_key` oleh LLMClient
    (ApiKeyManager). Provider tidak pernah menyimpan / mencetak key.
    """

    name = "openrouter"

    def __init__(self, timeout: float = 60.0, transport: Any = None):
        self.timeout = timeout
        self.transport = transport

    async def generate(
        self,
        messages: list[dict],
        model: str,
        temperature: float = 0.7,
        api_key: str | None = None,
        **kwargs: Any,
    ) -> LLMResponse:
        if not api_key:
            raise ProviderError("OpenRouter API key tidak tersedia (periksa .env / environment)")

        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://github.com/modular-agent-team",
            "X-Title": "Modular Multi-Agent Team",
        }
        payload: dict = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
        }
        for key in _ALLOWED_PAYLOAD:
            if key in kwargs:
                payload[key] = kwargs[key]

        client = httpx.AsyncClient(timeout=self.timeout, transport=self.transport)
        try:
            response = await client.post(_OPENROUTER_URL, headers=headers, json=payload)
        except httpx.TimeoutException as exc:
            raise TimeoutError(f"OpenRouter timeout setelah {self.timeout}s") from exc
        except httpx.HTTPError as exc:
            raise ProviderError(f"OpenRouter network error: {exc}") from exc
        finally:
            await client.aclose()

        return _build_response(response, model)


def _build_response(response: httpx.Response, requested_model: str) -> LLMResponse:
    status = response.status_code
    if status == 401 or status == 403:
        raise AuthenticationError(f"OpenRouter menolak kredensial (HTTP {status})")
    if status == 429:
        raise RateLimitError("OpenRouter rate limit tercapai (HTTP 429)")
    if status == 404:
        raise ModelNotFoundError(f"Model tidak ditemukan pada OpenRouter: {requested_model}")
    if status >= 400:
        raise ProviderError(f"OpenRouter HTTP {status}: {_safe_error_body(response.text)}")

    try:
        body = response.json()
    except ValueError as exc:
        raise InvalidResponseError("OpenRouter mengembalikan body non-JSON") from exc

    try:
        choices = body["choices"]
        content = choices[0]["message"].get("content") or ""
        finish_reason = choices[0].get("finish_reason")
    except (KeyError, IndexError, TypeError, AttributeError) as exc:
        raise InvalidResponseError(f"Struktur respon OpenRouter tidak valid: {exc}") from exc

    return LLMResponse(
        content=content,
        model=body.get("model") or requested_model,
        provider="openrouter",
        usage=body.get("usage") or {},
        finish_reason=finish_reason,
    )


def _safe_error_body(text: str) -> str:
    """Ambil kutipan body error singkat; potong agar tidak bocor kredensial / terlalu panjang."""
    text = (text or "").strip()
    if len(text) > 200:
        text = text[:200] + "...(truncated)"
    return text or "no body"