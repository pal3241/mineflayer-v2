# MineHive Local AI Training

Run the default command-center dataset:

```bash
npm run ai -- training
```

Train from one or more local files, directories, or web pages:

```bash
npm run ai -- training training/local-ai/command-center.jsonl
npm run ai -- training ./datasets https://id.wikipedia.org/wiki/Minecraft
```

Supported local formats are JSON, JSONL, CSV, and TXT. JSON records use `text` plus a dialogue `label`; optional `response`, `answer`, or `knowledge` text is stored as local knowledge. Plain text and HTML pages are split and automatically labelled. Internet content is downloaded only during training; runtime inference remains offline.
