---
name: typescript-patterns
description: TypeScript-specific review checklist - type safety, strictness, advanced type patterns and common typing mistakes in .ts/.tsx files
---

# TypeScript Patterns Analyzer

Expert guidance for reviewing TypeScript code. Use alongside `security-analysis`.

## Type Safety
- Flag `any` (explicit or implicit) in public APIs → prefer `unknown` + narrowing, or a precise type
- Flag non-null assertions (`value!`) on data from I/O, DB rows or user input
- Flag unchecked casts like `rows as Todo[]` on raw DB/JSON data without runtime validation (zod, type guards)
- Exported functions should declare explicit return types
- Prefer union literal types / `as const` objects over loose `string` for closed sets (tiers, statuses)
- `Record<Union, T>` lookup tables give exhaustiveness; `switch` needs a `never` default check

## Common Mistakes
- Date handling: `new Date('MM/YY')` is not parseable; months are 0-based in `new Date(y, m)`
- Comparing Dates with `===` compares references → use `getTime()`
- `string` used for numeric/boolean input (e.g. `completed: string`) → validate and convert at the boundary
- Floating promises (not awaited/returned), `async` functions that never await
- Swallowed errors: empty `catch {}` or `catch { return false }` without logging

## Modern Patterns to Prefer
- `readonly` for data that should not change
- Discriminated unions for results: `{ ok: true; value } | { ok: false; error }`
- `satisfies` to type-check config objects without widening

## Severity Guidance
- high: unchecked cast of external data used in security/money logic; floating promise in payment flow
- medium: `any` in exported API, missing return types on exported functions, unsafe Date parsing
- low: missing `readonly`, could use union/const map

## Output
For each finding: exact line, severity, category (bug-risk, maintainability, best-practice, style) and a concrete typed fix.