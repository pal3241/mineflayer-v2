from __future__ import annotations

from abc import ABC, abstractmethod

from ..models import LLMResponse


class BaseLLMProvider(ABC):
    """Interface semua provider LLM.

    Agent / Router hanya mengenal interface ini, sehingga provider baru
    (Local, Provider B, Provider C) bisa ditambahkan tanpa mengubah agent.
    """

    name = "base"

    @abstractmethod
    async def generate(
        self,
        messages: list[dict],
        model: str,
        temperature: float = 0.7,
        **kwargs,
    ) -> LLMResponse:
        """Kirim chat request dan kembalikan LLMResponse terstruktur."""
        raise NotImplementedError