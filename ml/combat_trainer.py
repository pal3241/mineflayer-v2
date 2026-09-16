"""MineHive 1.1.0 offline combat-policy trainer.
Consumes JSONL exported from GET /api/v1/combat/training-batch. It intentionally
trains off-line; live bots keep deterministic safety rules and never wait for Python.
"""
import json, sys
from collections import defaultdict

def main():
    rows = [json.loads(line) for line in sys.stdin if line.strip()]
    scores = defaultdict(lambda: [0.0, 0])
    for row in rows:
        action = row.get("action", "NONE")
        scores[action][0] += float(row.get("reward", 0))
        scores[action][1] += 1
    ranking = sorted(((total/count, action, count) for action,(total,count) in scores.items() if count), reverse=True)
    print(json.dumps({"version":"combat-offline-v1","source":"python-offline","metrics":{"samples":len(rows),"actions":[{"action":a,"meanReward":round(s,3),"samples":n} for s,a,n in ranking]}}))
if __name__ == "__main__":
    main()