"""Lapisan LLM: konfigurasi model, provider, client (API key + retry), router.

Insights:
    Agent -> LLMRouter -> LLMClient -> Provider -> OpenRouter
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from .client import ApiKeyManager, LLMClient
from .models import (
    AuthenticationError,
    InvalidResponseError,
    LLMError,
    LLMResponse,
    LLMTimeoutError,
    ModelNotFoundError,
    ProviderError,
    RateLimitError,
    TimeoutError,
)
from .providers.base import BaseLLMProvider
from .providers.openrouter import OpenRouterProvider
from .router import LLMRouter

_DEFAULT_MODEL_CONFIG: dict[str, dict] = {
    "research-model": {
        "provider": "openrouter",
        "model": "meta-llama/llama-3.3-70b-instruct",
    },
    "coding-model": {
        "provider": "openrouter",
        "model": "anthropic/claude-3.5-sonnet",
    },
    "reasoning-model": {
        "provider": "openrouter",
        "model": "openai/gpt-4o",
    },
}


def _load_json(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return default


def _load_api_keys(env: dict[str, str]) -> list[str]:
    """Baca OPENROUTER_API_KEY_1..N dan OPENROUTER_API_KEY dari environment."""
    keys: list[str] = []
    index = 1
    while True:
        value = env.get(f"OPENROUTER_API_KEY_{index}")
        if not value:
            break
        if value not in keys:
            keys.append(value)
        index += 1
    single = env.get("OPENROUTER_API_KEY")
    if single and single not in keys:
        keys.append(single)
    return keys


def _load_dotenv(path: Path) -> None:
    """Loader .env minimal (tanpa dependensi eksternal).

    Hanya mengisi var yang BELUM ada di environment agar tidak menimpa nilai
    yang sudah diset pengguna. Tidak pernah membocorkan nilai ke log.
    """
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def build_llm_router(config_dir: str | Path | None = None, env: dict[str, str] | None = None) -> LLMRouter:
    """Bangun LLMRouter dari config/ + .env + environment.

    Jika tidak ada API key, router tetap terbentuk — request akan gagal dengan
    ProviderError yang jelas (bukan crash tanpa informasi).
    """
    config_dir = Path(config_dir) if config_dir else Path.cwd() / "config"
    _load_dotenv(Path.cwd() / ".env")
    env = env if env is not None else os.environ

    model_config = {
        **_DEFAULT_MODEL_CONFIG,
        **_load_json(config_dir / "models.json", {}),
    }
    llm_config = _load_json(config_dir / "llm.json", {})
    timeout = float(llm_config.get("timeout_seconds", 60.0))
    max_retries = int(llm_config.get("max_retries", 3))
    default_provider = llm_config.get("default_provider", "openrouter")

    providers = {OpenRouterProvider.name: OpenRouterProvider(timeout=timeout)}
    if default_provider not in providers:
        providers[default_provider] = OpenRouterProvider(timeout=timeout)

    keys = _load_api_keys(env)
    key_manager = ApiKeyManager(keys) if keys else None
    return LLMRouter(
        model_config=model_config,
        providers=providers,
        key_manager=key_manager,
        max_retries=max_retries,
    )


__all__ = [
    "ApiKeyManager",
    "LLMClient",
    "LLMRouter",
    "LLMResponse",
    "LLMError",
    "ProviderError",
    "AuthenticationError",
    "RateLimitError",
    "TimeoutError",
    "LLMTimeoutError",
    "InvalidResponseError",
    "ModelNotFoundError",
    "BaseLLMProvider",
    "OpenRouterProvider",
    "build_llm_router",
]