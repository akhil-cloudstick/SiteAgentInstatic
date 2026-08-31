# Operator docs moved

Everything that used to live in `Operator/docs/` was whole-project documentation, not
Operator-internal, so it now sits in the monorepo docs tree:

| Was | Now |
|---|---|
| `Operator/docs/PLAN_V1.md` | [`docs/architecture/PLAN_V1.md`](../../docs/architecture/PLAN_V1.md) |
| `Operator/docs/Architecture.md` | [`docs/architecture/Architecture.md`](../../docs/architecture/Architecture.md) |
| `Operator/docs/DB-Architecture.md` | [`docs/architecture/DB-Architecture.md`](../../docs/architecture/DB-Architecture.md) |
| `Operator/docs/CONTEXT.md` | [`docs/architecture/CONTEXT.md`](../../docs/architecture/CONTEXT.md) |
| `Operator/docs/Diagrams.md` | [`docs/architecture/Diagrams.md`](../../docs/architecture/Diagrams.md) |
| `Operator/docs/UserFlow.md` | [`docs/architecture/UserFlow.md`](../../docs/architecture/UserFlow.md) |
| `Operator/docs/PENDING.md` | [`docs/architecture/PENDING.md`](../../docs/architecture/PENDING.md) |
| `Operator/docs/PLAN-REVIEW-INSTRUCTIONS.md` | [`docs/architecture/reviews/PLAN-REVIEW-INSTRUCTIONS.md`](../../docs/architecture/reviews/PLAN-REVIEW-INSTRUCTIONS.md) |
| `Operator/docs/PLAN-REVIEW-LOG.md` | [`docs/architecture/reviews/PLAN-REVIEW-LOG.md`](../../docs/architecture/reviews/PLAN-REVIEW-LOG.md) |
| `Operator/docs/plan_review_2.md` | [`docs/architecture/reviews/plan_review_2.md`](../../docs/architecture/reviews/plan_review_2.md) |
| `Operator/docs/import-compliance-fixes.md` | [`docs/integration/import-compliance-fixes.md`](../../docs/integration/import-compliance-fixes.md) |
| `Operator/docs/operator-import-setup.md` | [`docs/operator/operator-import-setup.md`](../../docs/operator/operator-import-setup.md) |
| `Operator/docs/templateRule.md` (stale copy) | [`docs/integration/templateRule-STALE-SNAPSHOT.md`](../../docs/integration/templateRule-STALE-SNAPSHOT.md) |

Start at [`docs/README.md`](../../docs/README.md).

> **`Operator/rules/templateRule.md` did not move.** It is live config, read at run time by
> every OpenDesign daemon via `OD_CMS_RULE_FILE` (hot-reloaded). Edit that file, never a copy.
