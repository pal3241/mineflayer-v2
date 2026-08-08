import asyncio

import httpx

from llm import (
    AuthenticationError,
    InvalidResponseError,
    ModelNotFoundError,
    ProviderError,
    RateLimitError,
)
from llm.providers.base import BaseLLMProvider
from llm.providers.openrouter import OpenRouterProvider

MESSAGES = [{"role": "user", "content": "hi"}]


def provider_for(status, json_body=None, text=None):
    def handler(request):
        return httpx.Response(status, json=json_body, text=text)

    return OpenRouterProvider(timeout=5, transport=httpx.MockTransport(handler))


def run_generate(provider, key="sk-test"):
    return asyncio.run(provider.generate(MESSAGES, "model-x", api_key=key))


def test_openrouter_is_base_provider():
    assert issubclass(OpenRouterProvider, BaseLLMProvider)
    assert OpenRouterProvider.name == "openrouter"


def test_no_key_raises_provider_error():
    try:
        run_generate(provider_for(200, json_body={}), key=None)
    except ProviderError:
        return
    raise AssertionError("Tanpa API key harus gagal jelas")


def test_401_raises_authentication_error():
    try:
        run_generate(provider_for(401, json_body={"error": "invalid"}))
    except AuthenticationError:
        return
    raise AssertionError("401 harus AuthenticationError")


def test_429_raises_rate_limit():
    try:
        run_generate(provider_for(429, json_body={"error": "rate limit"}))
    except RateLimitError:
        return
    raise AssertionError("429 harus RateLimitError")


def test_404_raises_model_not_found():
    try:
        run_generate(provider_for(404, json_body={"error": "missing"}))
    except ModelNotFoundError:
        return
    raise AssertionError("404 harus ModelNotFoundError")


def test_500_raises_provider_error():
    try:
        run_generate(provider_for(500, json_body={"error": "boom"}))
    except ProviderError:
        return
    raise AssertionError("5xx harus ProviderError")


def test_malformed_body_raises_invalid_response():
    try:
        run_generate(provider_for(200, text="<html>not json</html>"))
    except InvalidResponseError:
        return
    raise AssertionError("Body non-JSON harus InvalidResponseError")


def test_success_returns_structured_response():
    body = {
        "choices": [{"message": {"content": "hello"}, "finish_reason": "stop"}],
        "usage": {"total_tokens": 5},
        "model": "model-x",
    }
    resp = run_generate(provider_for(200, json_body=body))
    assert resp.content == "hello"
    assert resp.model == "model-x"
    assert resp.provider == "openrouter"
    assert resp.usage["total_tokens"] == 5
    assert resp.finish_reason == "stop"


def test_authorization_header_not_in_error():
    # Body error yang sangat panjang harus dipotong (jangan bocor kredensial).
    long_body = "x" * 5000
    try:
        run_generate(provider_for(500, text=long_body))
    except ProviderError as exc:
        message = str(exc)
        assert len(message) < 300
        assert "Bearer" not in message and "sk-test" not in message
        return
    raise AssertionError("500 harus ProviderError")
