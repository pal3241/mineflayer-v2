# MineHive 1.3.0 — Local AI Command Center 8M

MineHive now includes a real local neural command-and-dialogue center for cloud failure and manually selected local mode.

## Model

- 8,192-token hashed vocabulary.
- This first implementation has been superseded by the PyTorch language model in v1.3.1; the JavaScript dialogue classifier is no longer used.
- 40-way FP32 Softmax dialogue head.
- 7,902,760 dialogue parameters; about 7,909,981 parameters including command intent classification.
- Supervised training metrics, persisted checkpoint, confidence output, and offline inference.
- A dedicated `converse` intent prevents normal chat from being blindly converted into Minecraft actions.

This is deliberately a compact task/dialogue model, not a falsely advertised general-purpose LLM. It selects learned semantic responses and can retrieve imported local knowledge. Cloud models remain stronger for open-ended reasoning, while the local model keeps commands and basic conversation available offline.

## Training CLI

```bash
npm run ai -- training
npm run ai -- training training/local-ai/command-center.jsonl
npm run ai -- training ./datasets https://id.wikipedia.org/wiki/Minecraft
npm run ai -- status
npm run ai -- talk "siapa kamu"
```

Supported sources: JSON, JSONL, CSV, TXT, directories, and HTTP/HTTPS pages. Web pages are downloaded during training, cleaned, split into bounded chunks, automatically labelled, and stored as local knowledge. Runtime inference does not require internet access.

The editable base corpus is located at `training/local-ai/command-center.jsonl`.
