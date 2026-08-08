from __future__ import annotations

from typing import Any, Mapping

from .client import ApiKeyManager, LLMClient
from .models import LLMResponse, ModelNotFoundError, ProviderError
from .providers.base import BaseLLMProvider


class LLMRouter:
    """Jembatan antara Agent dan Provider.

    Agent hanya memanggil `router.generate(model="coding-model", messages=[...])`.
    Router bertanggung jawab:
      1. menerima model alias,
      2. membaca model configuration,
      3. memilih provider,
      4. memilih / mengirim request via LLMClient (retry + rotasi key),
      5. mengembalikan LLMResponse terstruktur.
    """

    def __init__(
        self,
        model_config: Mapping[str, dict],
        providers: Mapping[str, BaseLLMProvider],
        key_manager: ApiKeyManager | None = None,
        max_retries: int = 3,
    ):
        self.model_config = dict(model_config)
        self.providers = dict(providers)
        self.key_manager = key_manager
        self.max_retries = max_retries
        self._clients: dict[str, LLMClient] = {}

    def _client_for(self, provider_name: str) -> LLMClient:
        if provider_name not in self._clients:
            self._clients[provider_name] = LLMClient(
                self.providers[provider_name],
                key_manager=self.key_manager,
                max_retries=self.max_retries,
            )
        return self._clients[provider_name]

    async def generate(
        self,
        model: str,
        messages: list[dict],
        temperature: float = 0.7,
        **kwargs: Any,
    ) -> LLMResponse:
        if model not in self.model_config:
            raise ModelNotFoundError(f"Model alias tidak dikenal: {model}")
        cfg = self.model_config[model]
        provider_name = cfg.get("provider")
        model_id = cfg.get("model")
        if not provider_name or not model_id:
            raise ProviderError(f"Model config tidak lengkap untuk alias: {model}")
        if provider_name not in self.providers:
            raise ProviderError(f"Provider tidak dikenal: {provider_name}")

        client = self._client_for(provider_name)
        return await client.generate(
            messages=messages,
            model=model_id,
            temperature=temperature,
            **kwargs,
        )

    def list_models(self) -> list[str]:
        return list(self.model_config)