import asyncio

from llm import (
    ApiKeyManager,
    AuthenticationError,
    LLMClient,
    LLMResponse,
    ProviderError,
    RateLimitError,
)
from llm.providers.base import BaseLLMProvider

from .conftest import FakeLLMProvider


class FlakyProvider(BaseLLMProvider):
    """Gagal `fail_until` kali pertama dengan error tertentu, lalu sukses."""

    name = "flaky"

    def __init__(self, fail_until=1, error=None):
        self.calls = 0
        self.fail_until = fail_until
        self.error = error or RateLimitError("transient")

    async def generate(self, messages, model, temperature=0.7, **kwargs):
        self.calls += 1
        if self.calls <= self.fail_until:
            raise self.error
        return LLMResponse(content="ok", model=model, provider=self.name)


def test_client_success_marks_success():
    provider = FakeLLMProvider()
    keys = ApiKeyManager(["k1"])
    client = LLMClient(provider, keys)
    resp = asyncio.run(client.generate([{"role": "user", "content": "hi"}], "m1"))
    assert resp.content == "fake content"
    assert keys.stats()["successes"]["k1"] == 1
    assert keys.stats()["failures"]["k1"] == 0


def test_client_retries_transient_then_succeeds():
    provider = FlakyProvider(fail_until=2)
    client = LLMClient(provider, ApiKeyManager(["k1"]), max_retries=5)
    resp = asyncio.run(client.generate([{}], "m1"))
    assert resp.content == "ok"
    assert provider.calls == 3


def test_client_exhausts_retries_raises_rate_limit():
    provider = FlakyProvider(fail_until=999)
    client = LLMClient(provider, ApiKeyManager(["k1"]), max_retries=3)
    try:
        asyncio.run(client.generate([{}], "m1"))
    except RateLimitError:
        assert provider.calls == 3  # bounded retry, bukan infinite
        return
    raise AssertionError("Harus melempar RateLimitError setelah retry habis")


def test_client_non_retryable_error_propagates_immediately():
    # AuthenticationError TIDAK boleh di-retry otomatis.
    provider = FlakyProvider(fail_until=999, error=AuthenticationError("bad key"))
    client = LLMClient(provider, ApiKeyManager(["k1"]), max_retries=3)
    try:
        asyncio.run(client.generate([{}], "m1"))
    except AuthenticationError:
        assert provider.calls == 1
        return
    raise AssertionError("AuthenticationError harus langsung dilempar tanpa retry")


def test_client_without_keys_raises_provider_error():
    class NoKeyProvider(BaseLLMProvider):
        name = "nk"

        async def generate(self, messages, model, temperature=0.7, **kwargs):
            if not kwargs.get("api_key"):
                raise ProviderError("API key tidak tersedia")
            return LLMResponse(content="x", model=model, provider=self.name)

    client = LLMClient(NoKeyProvider(), key_manager=None)
    try:
        asyncio.run(client.generate([{"role": "user", "content": "hi"}], "m1"))
    except ProviderError:
        return
    raise AssertionError("Harus gagal jelas bila tidak ada API key")


def test_client_rotates_keys_on_failure():
    provider = FlakyProvider(fail_until=1)
    keys = ApiKeyManager(["k1", "k2"], max_failures=3)
    client = LLMClient(provider, keys, max_retries=3)
    resp = asyncio.run(client.generate([{}], "m1"))
    assert resp.content == "ok"
    # satu key gagal -> percobaan keduanya memakai key lain (success)
    assert keys.stats()["successes"]["k2"] == 1
