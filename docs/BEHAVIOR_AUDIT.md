# Runtime behavior audit

This audit distinguishes code that is exported or instantiated from code that is
actually reachable during a bot operation.

## Findings

| Area | Status | Evidence | Action |
| --- | --- | --- | --- |
| Minecraft capability registry | Fixed | Navigation terrain/precision previously returned a successful-looking `unavailable` result when an adapter method was missing. | Capability execution now throws a structured validation error; contract tests execute every advertised capability. |
| Native task model (`src/ml/native-task-model.js`) | Orphaned | No runtime import or construction exists; adaptive task learning uses the Node model path. | Keep as legacy/optional code; do not advertise it as active ML. Remove after downstream consumers are confirmed absent. |
| `InterruptManager` | Library-only | It is exported and covered by unit tests, but `Application` does not construct/register one. Survival resume is wired through `TaskExecutor` instead. | Treat as a reusable orchestration API, not an active production path. Wire it only if all interrupt types are migrated. |
| Command/query buses | Instantiated, no handlers | `Application` creates `commands` and `queries`, but no `register()` call targets either instance. | Do not route features through these buses until handlers are registered; otherwise remove the unused instances. |
| Navigation planners | Active | `navigation-service.js` imports and calls both formation and corridor planners for group movement. | No action. |
| Hash text vectors | Active but intentionally non-semantic | `local-command-brain.js` uses the vector for intent classification. Semantic memory uses keyword/BM25 retrieval instead. | Keep the name/metadata explicit; never market this vector as a semantic embedding. |

## Verification