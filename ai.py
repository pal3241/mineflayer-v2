#!/usr/bin/env python3
"""Direct PyTorch CLI for MineHive's local command-center model.

The checkpoint path intentionally matches MineHive's Node service, so a model
trained here is used immediately when the dashboard selects local/fallback AI.
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import sys
from pathlib import Path

from python.local_ai.model import generate, load_model, train_model

TEXT_EXTENSIONS = {'.txt', '.md', '.json', '.jsonl', '.csv'}


def checkpoint_path(value: str | None) -> Path:
    if value:
        return Path(value).expanduser().resolve()
    data_path = Path(os.environ.get('MINEHIVE_DATA_PATH', './data')).expanduser()
    return (data_path / 'local-ai' / 'minehive-local-ai.pt').resolve()


def text_chunks(raw: str, limit: int = 2_000) -> list[str]:
    raw = ' '.join(str(raw).replace('\x00', ' ').split())
    return [raw[index:index + limit] for index in range(0, len(raw), limit) if raw[index:index + limit].strip()]


def record_text(record: object) -> str:
    if not isinstance(record, dict): return str(record)
    prompt = str(record.get('text') or record.get('prompt') or record.get('question') or '').strip()
    response = str(record.get('response') or record.get('answer') or record.get('knowledge') or '').strip()
    return f'[USER] {prompt}\n[ASSISTANT] {response}' if prompt and response else prompt or response


def read_file(path: Path) -> list[str]:
    suffix = path.suffix.lower()
    raw = path.read_text(encoding='utf-8', errors='replace')
    if suffix == '.jsonl':
        values = []
        for number, line in enumerate(raw.splitlines(), 1):
            if not line.strip() or line.lstrip().startswith('#'): continue
            try: values.extend(text_chunks(record_text(json.loads(line))))
            except json.JSONDecodeError as error: raise ValueError(f'JSONL tidak valid {path}:{number}: {error.msg}') from error
        return values
    if suffix == '.json':
        data = json.loads(raw)
        records = data if isinstance(data, list) else data.get('samples', data.get('data', [data]))
        return [chunk for record in records for chunk in text_chunks(record_text(record))]
    if suffix == '.csv':
        return [chunk for row in csv.DictReader(raw.splitlines()) for chunk in text_chunks(record_text(row))]
    return text_chunks(raw)


def load_sources(sources: list[str]) -> list[str]:
    files: list[Path] = []
    for value in sources:
        path = Path(value).expanduser()
        if not path.exists(): raise FileNotFoundError(f'Sumber training tidak ditemukan: {path}')
        if path.is_dir(): files.extend(item for item in sorted(path.rglob('*')) if item.is_file() and item.suffix.lower() in TEXT_EXTENSIONS)
        else: files.append(path)
    if not files: raise ValueError('Tidak ada berkas .txt, .md, .json, .jsonl, atau .csv untuk dilatih')
    texts: list[str] = []
    for index, path in enumerate(files, 1):
        print(f'[read {index}/{len(files)}] {path}', flush=True)
        texts.extend(read_file(path))
    texts = [text for text in texts if len(text.strip()) >= 8]
    if not texts: raise ValueError('Sumber tidak berisi teks yang dapat dilatih')
    print(f'[dataset] {len(texts)} potongan teks dari {len(files)} berkas', flush=True)
    return texts


def report(event: dict) -> None:
    phase = event.get('phase')
    if phase == 'epoch':
        print(f"Epoch {event['epoch']}/{event['epochs']} | loss {event['loss']:.6f} | {event['sequences']} sequence", flush=True)
    elif phase == 'training' and event.get('batch') == 0:
        mode = 'lanjut checkpoint' if event.get('resumed') else 'model baru'
        print(f"Epoch 1/{event['epochs']} | batch 0/{event['batches']} | {mode}", flush=True)
    elif phase == 'saving': print('Menyimpan checkpoint MineHive…', flush=True)


def main() -> int:
    parser = argparse.ArgumentParser(description='MineHive PyTorch local AI')
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument('-train', nargs='+', metavar='SUMBER', help='file atau folder corpus')
    action.add_argument('-talk', metavar='TEKS', help='kirim pertanyaan ke checkpoint lokal')
    action.add_argument('-status', action='store_true', help='lihat checkpoint aktif')
    parser.add_argument('--epochs', type=int, default=100, help='jumlah epoch (default: 100)')
    parser.add_argument('--checkpoint', help='path checkpoint; default mengikuti MineHive')
    parser.add_argument('--full', action='store_true', help='latih seluruh sequence; bisa sangat lama di HP')
    parser.add_argument('--max-sequences', type=int, default=384, help='batas sequence profil cepat (default: 384)')
    parser.add_argument('--sequence-length', type=int, default=32, help='token per sequence (default: 32)')
    parser.add_argument('--batch-size', type=int, default=16, help='batch per langkah (default: 16)')
    parser.add_argument('--threads', type=int, default=min(4, os.cpu_count() or 1), help='thread CPU PyTorch')
    parser.add_argument('--fresh', action='store_true', help='abaikan bobot checkpoint lama')
    args = parser.parse_args()
    checkpoint = checkpoint_path(args.checkpoint)
    if args.status:
        if not checkpoint.exists(): print(f'UNTRAINED\ncheckpoint: {checkpoint}'); return 0
        _, payload = load_model(checkpoint)
        print(json.dumps({'checkpoint': str(checkpoint), 'parameterCount': 8_034_243, 'metrics': payload.get('metrics', {})}, ensure_ascii=False, indent=2)); return 0
    if args.talk is not None:
        if not checkpoint.exists(): raise FileNotFoundError(f'Belum ada model. Train dulu: python ai.py -train training/local-ai\ncheckpoint: {checkpoint}')
        model, _ = load_model(checkpoint)
        print(generate(model, args.talk)['text'] or 'Aku belum cukup yakin untuk menjawab. Tambahkan corpus percakapan lalu train lagi.')
        return 0
    if not 1 <= args.epochs <= 100_000: raise ValueError('--epochs harus 1 sampai 100000')
    if not 1 <= args.batch_size <= 128: raise ValueError('--batch-size harus 1 sampai 128')
    texts = load_sources(args.train)
    result = train_model(texts, checkpoint, epochs=args.epochs, batch_size=args.batch_size, sequence_length=args.sequence_length, max_sequences=0 if args.full else args.max_sequences, threads=args.threads, resume=not args.fresh, progress=report)
    print(json.dumps({'status': 'READY', 'checkpoint': result['checkpoint'], 'parameterCount': result['model'].parameter_count, 'metrics': result['payload']['metrics']}, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    try: raise SystemExit(main())
    except KeyboardInterrupt: print('\nTraining dihentikan; checkpoint terakhir yang sudah tersimpan tetap aman.', file=sys.stderr); raise SystemExit(130)
    except Exception as error: print(f'Error: {error}', file=sys.stderr); raise SystemExit(1)
