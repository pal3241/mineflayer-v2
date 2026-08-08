"""Demo kecil: alur Agent -> LLMRouter -> Provider (fake) dan parsing JSON.

Menjalankan:  python scripts/llm_demo.py
"""
from __future__ import annotations

import asyncio

from llm import LLMRouter
from llm.utils import parse_json_object
from tests.conftest import FakeLLMProvider

ROUTER = LLMRouter(
    {"reasoning-model": {"provider": "fake", "model": "fake-r"}},
    {"fake": FakeLLMProvider(responses=[('{"goal":"demo","tasks":[{"title":"t","capability":"coding"}]} trailing', {})])},
)


async def main() -> None:
    # 1) Model alias di-resolve ke provider oleh Router.
    resp = await ROUTER.generate(
        "reasoning-model",
        [{"role": "user", "content": "Buat rencana"}],
    )
    print("router content :", resp.content)
    print("router provider:", resp.provider)
    print("router model   :", resp.model)

    # 2) Output LLM yang 'berisik' diekstrak jadi JSON divalidasi.
    parsed = parse_json_object(resp.content)
    print("parsed json    :", parsed)


if __name__ == "__main__":
    asyncio.run(main())
