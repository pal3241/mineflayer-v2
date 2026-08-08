import asyncio

from llm import ModelNotFoundError, ProviderError

from .conftest import make_fake_router


def test_alias_resolves_to_provider_model():
    router = make_fake_router()
    resp = asyncio.run(
        router.generate(model="coding-model", messages=[{"role": "user", "content": "hi"}])
    )
    assert resp.provider == "fake"
    assert resp.model == "fake-coding"


def test_unknown_alias_raises_model_not_found():
    router = make_fake_router()
    try:
        asyncio.run(router.generate(model="unknown-alias", messages=[]))
    except ModelNotFoundError:
        return
    raise AssertionError("Alias tak dikenal harus menimbulkan ModelNotFoundError")


def test_unknown_provider_raises_provider_error():
    router = make_fake_router({"foo": {"provider": "nope", "model": "m"}})
    try:
        asyncio.run(router.generate(model="foo", messages=[]))
    except ProviderError:
        return
    raise AssertionError("Provider tak dikenal harus menimbulkan ProviderError")


def test_incomplete_config_raises_provider_error():
    router = make_fake_router({"foo": {"provider": "fake"}})
    try:
        asyncio.run(router.generate(model="foo", messages=[]))
    except ProviderError:
        return
    raise AssertionError("Config tanpa model ID harus menimbulkan ProviderError")


def test_list_models():
    router = make_fake_router()
    assert "coding-model" in router.list_models()
