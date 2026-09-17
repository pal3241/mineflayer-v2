# Runtime behavior audit

This audit distinguishes code that is exported or instantiated from code that is
actually reachable during a bot operation.

## Findings

| Area | Status | Evidence | Action |
| --- | --- | --- | --- |
| Minecraft capability registry | Fixed | Navigation terrain/precision previously returned a successful-looking `unavailable` result when an adapter method was missing. | Capability execution now throws a structured validation error; contract tests execute every advertised capability. |
| Native task model | Removed | Import-graph verification found no runtime or test consumer; adaptive task learning already uses the Node model path. | The unused Rust crate, setup script, package commands and JS bridge were removed. |
| `InterruptManager` | Library-only | It is exported and covered by unit tests, but `Application` does not construct/register one. Survival resume is wired through `TaskExecutor` instead. | Treat as a reusable orchestration API, not an active production path. Wire it only if all interrupt types are migrated. |
| Command/query buses | Instantiated, no handlers | `Application` creates `commands` and `queries`, but no `register()` call targets either instance. | Do not route features through these buses until handlers are registered; otherwise remove the unused instances. |
| Navigation planners | Active | `navigation-service.js` imports and calls both formation and corridor planners for group movement. | No action. |
| Hash text vectors | Active but intentionally non-semantic | `local-command-brain.js` uses the vector for intent classification. Semantic memory uses keyword/BM25 retrieval instead. | Keep the name/metadata explicit; never market this vector as a semantic embedding. |
| Environment safety model | Fixed | Observations and learned areas were persisted, but no execution path consulted `areaAt()`. | Navigation now rejects destinations classified `DANGEROUS` before pathfinder starts. |
| Litematica sync cache/threading | Fixed | Sync refreshed only preview data, so the cached project could retain a null target; completion callbacks also mutated GUI state off-thread. | Sync now refreshes client state strictly and GUI updates run on the Minecraft client thread. Disabled sub-regions fail explicitly. |

## Verification

`tests/capability-contracts.test.js` runs every advertised capability against a
spy adapter/survival service and fails if a capability does not invoke a real
operation. It also verifies that missing navigation methods fail loudly and that
survival policy values reach the adapter.
