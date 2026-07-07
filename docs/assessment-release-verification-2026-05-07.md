# Assessment Release Verification

Date: 2026-05-07
Project: `mylisa`
Area: Maths assessment engine + generated canonical pool

## Status

- Generated assessment canonical audit: `0` flagged objectives
- Assessment engine regression suite: `22/22` passing
- Multi-age smoke test: passed for Years `2, 4, 7, 9, 11`

## Smoke Test Summary

- Year 2:
  - Entry year `1`
  - Out-of-window served questions: `0`
  - Unsupported served generators: `0`
  - Result: `ENTRY_SECURE`
- Year 4:
  - Entry year `3`
  - Out-of-window served questions: `0`
  - Unsupported served generators: `0`
  - Result: `NEXT_SECURE`
- Year 7:
  - Entry year `6`
  - Out-of-window served questions: `0`
  - Unsupported served generators: `0`
  - Result: `NEXT_SECURE`
- Year 9:
  - Entry year `8`
  - Out-of-window served questions: `0`
  - Unsupported served generators: `0`
  - Result: `NEXT_SECURE`
- Year 11:
  - Entry year `10`
  - Out-of-window served questions: `0`
  - Unsupported served generators: `0`
  - Result: `NEXT_SECURE`

## Key Outcomes

- The adaptive year window now holds during live assessment sessions.
- Orange Tree-style failures caused by out-of-window question serving were eliminated.
- Year 11 no longer stalls on Year 9-only content.
- Supported Year 11 generated canonical content was created and is now active.
- Remaining generated-pool audit findings were reduced to zero.

## Verification Scripts

- Canonical audit:
  - `scripts/audit-canonical-assessment-alignment.ts`
- Canonical repair:
  - `scripts/repair-canonical-assessment-alignment.ts`
- Live smoke test:
  - `scripts/smoke-test-assessment-sessions.ts`

## Notes

- Historical assessment attempts created before the fixes may still contain invalid served questions and should be rerun if their report quality is in doubt.
- This verification covers the generated assessment pool targeted by the audit/repair workflow.
