# Sena Phase 1 — Memory and outcome learning

## Goal

Make observed task outcomes enter the existing adaptive model through a single
auditable path. This phase does not replace the existing memory stores or train
a model automatically.

## Data path

`task.completed` / `task.failed`
→ `createOutcomeFeedback`
→ `ml.recordOutcome()`
→ existing `ml-outcomes` repository
→ prediction / explicit offline training.

The feedback service does not subscribe to `ml.outcome.recorded`, so it cannot
create a recursive event loop. It ignores terminal tasks without a bot identity
and deduplicates duplicate terminal events in-process. Durable cross-restart
deduplication is the responsibility of the outcome repository and is a follow-up
hardening task.

## Training policy

Recording is automatic; training is not. The existing adaptive model uses
explicit training and holdout evaluation. Startup must never launch training.
Task cancellation is intentionally excluded because cancellation is not
reliable evidence of task failure.

## Test

Run `npm test` on Node.js 22 or newer. The focused test is
`node --test tests/outcome-feedback.test.js`.

## Known limits

- Features are accepted from `task.outcomeFeatures`, `task.features`, or
  `task.input.features`; absent features are normalized by the existing model.
- The in-process seen set prevents duplicate events while the process is alive.
  A later phase should add durable idempotency keyed by task ID to the outcome
  repository.
- This phase records outcomes and makes them available to the existing predictor;
  it does not assert that every planner already uses predictions to alter its
  policy. That integration requires its own behavioral tests.
