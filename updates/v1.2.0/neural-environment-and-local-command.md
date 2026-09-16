# MineHive v1.2.0 — Neural Environment & Local Command Brain

## Environmental Safety Neural Model

MineHive now samples each traversed 32×32×32 area and converts ten environmental signals into a neural classification: hostile density, deaths, darkness, lava, fall risk, water risk, health loss, trapped state, base distance, and friendly support.

Architecture: 10 inputs → 16 ReLU hidden neurons → SAFE/DANGEROUS Softmax output. Observations, weights, training metrics, and learned area records are persisted. Threat and death events become supervised examples. Movement generates ongoing observations, and every learned area is copied into Universal Task Memory as `AREA_SAFETY`.

High-confidence dangerous destinations are rejected by the Fleet Coordinator. Stale or uncertain areas remain explorable so the model can collect more evidence.

## Local Neural Command Brain

The local command center is a real classifier, not a renamed rule table.

Architecture: hashed word/trigram tokenizer with 128 inputs → 48 ReLU hidden neurons → 20 MineHive intents through Softmax. Training uses stochastic gradient descent, cross-entropy loss, L2 regularization, epochs, persistent weights, accuracy metrics, built-in Indonesian/English samples, and user-added samples.

Modes in Dashboard → Settings:

- `Fallback cloud`: use it when the configured cloud/Ollama provider errors or is unavailable.
- `Selalu lokal`: route command interpretation through the local neural model.
- `Nonaktif`: retain deterministic/cloud behavior.

Low-confidence neural results never execute directly; MineHive falls back to the deterministic safe parser.
