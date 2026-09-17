# MineHive Local AI Training

Install Python dependencies once:

```bash
npm run ai:setup
```

On Termux this installs the official `python-torch` package. On Linux desktop it installs the CPU PyTorch wheel with pip.

Run the default command-center dataset:

```bash
npm run ai -- training
```

Train from one or more local files, directories, or web pages:

```bash
npm run ai -- training training/local-ai/command-center.jsonl
npm run ai -- training ./datasets https://id.wikipedia.org/wiki/Minecraft
npm run ai -- training --epochs 50 kbbi.txt english-dictionary.txt
npm run ai -- save ./models/minehive-local-ai.pt
```

Supported local formats are JSON, JSONL, CSV, and TXT. JSON records use `text` plus an optional `response`, `answer`, or `knowledge`. Plain text and HTML pages become language-model corpus and local knowledge. Internet content is downloaded only during training; runtime inference remains offline.

`--epochs` accepts 1–500. More epochs mean more passes over the corpus and longer training. Every successful training automatically saves the active PyTorch checkpoint under `data/local-ai/`; `ai save` exports a copy that contains the neural weights, model configuration, metrics, and corpus fingerprint.
