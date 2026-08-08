from llm.models import (
    AuthenticationError,
    InvalidResponseError,
    LLMError,
    LLMResponse,
    ModelNotFoundError,
    ProviderError,
    RateLimitError,
    TimeoutError,
)


def test_llm_response_fields():
    resp = LLMResponse(content="x", model="m", provider="p")
    assert resp.content == "x"
    assert resp.model == "m"
    assert resp.provider == "p"
    assert resp.usage == {}
    assert resp.finish_reason is None
    assert resp.metadata == {}


def test_llm_response_accepts_usage_and_finish_reason():
    resp = LLMResponse(
        content="x", model="m", provider="p",
        usage={"total_tokens": 5}, finish_reason="stop",
    )
    assert resp.usage["total_tokens"] == 5
    assert resp.finish_reason == "stop"


def test_error_hierarchy():
    assert issubclass(ProviderError, LLMError)
    assert issubclass(AuthenticationError, ProviderError)
    assert issubclass(RateLimitError, ProviderError)
    assert issubclass(ModelNotFoundError, ProviderError)
    assert issubclass(TimeoutError, LLMError)
    assert issubclass(InvalidResponseError, LLMError)


def test_errors_are_catchable_as_llm_error():
    for exc in (
        ProviderError("p"),
        AuthenticationError("a"),
        RateLimitError("r"),
        TimeoutError("t"),
        InvalidResponseError("i"),
        ModelNotFoundError("m"),
        LLMError("l"),
    ):
        assert isinstance(exc, LLMError)
