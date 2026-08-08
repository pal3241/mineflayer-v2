# Communicator

| Aspek | Nilai |
| --- | --- |
| **Name** | Communicator |
| **Role** | Membuat, meneruskan, dan merangkum komunikasi antar-agent |
| **Capabilities** | `communication`, `messaging`, `coordination` |
| **Required tools** | Tidak ada |
| **Required model** | Tidak ada |
| **Category** | communication |
| **Version** | 1.0.0 |

## Input

Task dengan `capability` `communication` / `messaging` / `coordination`.

## Output

```json
{
    "type": "communication_summary",
    "total_messages": 0,
    "by_type": {},
    "senders": [],
    "recipients": []
}
```

## Contoh

```bash
python main.py run communication "Ringkas komunikasi saat ini"
```

## Detail

- Membaca history MessageBus (bounded) dan merangkumnya.
- `handle_message` menjawab request ringkas (generic); tidak bergantung pada
  agent tertentu.

## Limitations

- Hanya merangkum; belum melakukan routing/forwarding otomatis penuh.
