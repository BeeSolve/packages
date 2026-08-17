# ADR Convention — @beesolve/packages

## Location

Every package must have a `docs/` folder containing Architecture Decision Records (ADRs).

Path: `packages/<name>/docs/adr-NNN-<slug>.md`

## Required First ADR

Every package must have at least one ADR — `adr-001-motivation.md` — that explains why the package exists. This ADR answers:

- What problem does this package solve?
- Why does it exist as a standalone package rather than inline code?
- What are the boundaries of its responsibility?

## Numbering

- Use zero-padded three-digit numbers: `adr-001-`, `adr-002-`, etc.
- Exception: legacy ADRs without numbers (e.g. `adr-async-local-storage-context.md`) are acceptable but new ADRs must be numbered

## Format

```markdown
# ADR-NNN: <Title>

## Status

Accepted | Superseded | Deprecated

## Context

What is the issue or question that motivates this decision?

## Decision

What is the change or choice being made?

## Rationale

Why this approach over alternatives? Include technical reasoning.
Use numbered sub-headings (### 1. ...) when there are multiple distinct reasons.

## Consequences

What are the positive and negative outcomes? What trade-offs are accepted?

## Alternatives Considered

What other approaches were evaluated and why were they rejected?
Use sub-headings (###) for each alternative.

## References

Optional. Links to relevant docs, RFCs, or external resources.
```

## When to Write an ADR

Write a new ADR when:

- Creating a new package (motivation ADR is mandatory)
- Making a significant architectural choice that constrains future development
- Choosing between multiple viable approaches where the reasoning should be preserved
- Changing a previous decision (supersede the old ADR)

Do NOT write an ADR for:

- Routine implementation details
- Bug fixes
- Dependency updates
- Minor refactors

## Referencing ADRs

ADRs are internal documentation for maintainers. They are not published to npm or referenced in the package README. They exist to preserve decision context for future-you.
