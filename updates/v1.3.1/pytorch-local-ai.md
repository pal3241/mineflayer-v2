# PyTorch Local AI 8M

MineHive Local Brain now runs as a real autoregressive PyTorch language model instead of the earlier JavaScript dialogue classifier.

- Byte-level GRU language model with 8,034,243 trainable parameters.
- Two GRU layers, 896 hidden units, and a 192-dimensional byte embedding.
- Training accepts text, JSON, JSONL, CSV, directories, and HTTP sources.
- `npm run ai -- training --epochs 50 kbbi.txt english-dictionary.txt` controls the number of full training passes.
- A checkpoint is saved automatically after training; `npm run ai -- save ./models/minehive-8m.pt` exports a copy.
- The checkpoint contains weights, architecture, training metrics, and a corpus fingerprint.
- Local inference remains available when the cloud LLM fails or when manual-local mode is enabled.
