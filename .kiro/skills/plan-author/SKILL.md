---
name: plan-author
description: Create implementation plans for features, refactors, or fixes. Use when the user says "create a plan", "plan this", "write a plan for", or describes a feature they want built in a structured way. Produces a complete plan file in .kiro/plans/ ready for execution by plan-executor.
---

## Overview

This skill defines how to research, design, and write an implementation plan. A plan is a structured document that breaks a feature or change into ordered, self-contained tasks that can be executed sequentially by subagents.

## When to Create a Plan

Create a plan when:

- A feature touches multiple packages in the monorepo
- Work requires creating a new package with non-trivial logic
- Work will take more than 2-3 tasks to complete
- The user explicitly asks for a plan
- A change requires architectural decisions documented upfront
- Cross-package API changes that affect downstream consumers

Do NOT create a plan for:

- Single-file fixes or quick changes
- Questions or investigations
- Changes the user wants done immediately without structure
- Simple dependency bumps or version changes

## Plan Creation Process

### Step 1: Research the codebase

Before writing anything, investigate thoroughly using `context-gatherer` subagents:

- Understand existing patterns (how similar packages are built)
- Identify all packages that need creation or modification
- Understand the data model, type exports, and cross-package dependencies
- Check for existing code that can be reused or needs refactoring
- Review relevant ADRs in `packages/<name>/docs/`

Spawn multiple parallel context-gatherers for independent questions (e.g., one for existing package patterns, one for CDK construct patterns).

### Step 2: Design the approach

Based on research, decide:

- **Types and schemas** — what interfaces, Valibot schemas, type exports
- **Public API surface** — what functions/classes are exported, their signatures
- **Cross-package dependencies** — what existing packages are consumed, what new ones are needed
- **CDK constructs** — infrastructure components if applicable
- **Key design decisions** — tradeoffs made and why
- **What's out of scope** — explicitly list future work

### Step 3: Break into tasks

Split the work into ordered tasks following these principles:

- **Each task is self-contained** — a subagent can implement it with only the task description and codebase access (no conversation history needed)
- **Tasks build on each other** — later tasks can depend on earlier ones being complete
- **One concern per task** — don't mix schema definitions with CDK construct implementation
- **Natural boundaries** — split along: types/schemas, core logic, CDK constructs, barrel exports/wiring, tests
- **Tests with implementation** — include tests in the same task as the code they test (not in a separate "write tests" task)
- **5-12 tasks typical** — fewer means tasks are too large; more means too granular

### Step 4: Write the plan file

Write to `.kiro/plans/<kebab-case-name>.md` following the format below.

## Plan File Structure

```markdown
# <Feature Name>

## Status: Not Started

## Problem Statement

<1-3 paragraphs: what needs to be built, why, what problem it solves>

## Architecture / Approach

### Types and Schemas

<interfaces, Valibot schemas, type definitions — include code snippets>

### Public API Surface

<exported functions/classes with signatures and brief descriptions>

### Cross-Package Dependencies

<which existing packages are consumed, any new workspace:^ dependencies needed>

### CDK Constructs (if applicable)

<infrastructure components, Lambda configurations, DynamoDB tables>

### Key Design Decisions

<bullet list of tradeoffs and choices made during research>

## Execution Instructions

<project-specific instructions for subagents — copy from template below>

**Check gates** (run after every task):

1. `bun run check`
2. `bun run type-check`
3. `bun test`

## Tasks

### Task 1: <Short title>

- [ ] Sub-item with specific detail
- [ ] Another sub-item
- [ ] Include tests: `packages/<name>/tests/foo.test.ts`

**Files:** `packages/<name>/src/file1.ts`, `packages/<name>/tests/foo.test.ts`

**Acceptance criteria:** <what must pass — specific test file, specific check command>

---

### Task 2: <Short title>

...

---

## Future Work (out of scope)

- <thing 1>
- <thing 2>
```

## Task Description Quality

Each task description must include enough context for a subagent to implement it without any conversation history. This means:

- **What to create/modify** — exact file paths
- **What pattern to follow** — reference existing packages as examples (e.g., "same pattern as `packages/action-tokens/model.ts`")
- **Interface shapes** — type definitions, function signatures, input/output shapes
- **Behavior** — what the function does, what errors it throws, edge cases
- **Tests** — what test cases to write, what to assert

Bad task: "Add the DynamoDB model"
Good task: "Create `packages/dmarc-reports/src/model.ts` with a `Reports` class. Constructor takes `{ dynamo: DynamoDBDocumentClient, tableName: string }`. Implement `put(report: Report): Promise<void>` using PutCommand with `ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)'`. Implement `listByDomain(domain: string): Promise<Report[]>` using QueryCommand on pk=`DOMAIN#${domain}`. Export the class and types from `packages/dmarc-reports/index.ts`. Tests: `packages/dmarc-reports/tests/model.test.ts` — test put succeeds, put duplicate throws, listByDomain returns correct items."

## Task Ordering Guidelines

Typical order for a package feature:

1. **Types and schemas** — Valibot schemas, shared type definitions, `as const` unions
2. **Core logic / model** — service classes, pure functions, data access
3. **CDK constructs** — infrastructure (if applicable)
4. **Barrel exports** — wire everything through `index.ts`
5. **Cross-package wiring** — update consuming packages if APIs changed
6. **End-to-end verification** — run full test suite, type-check all packages

This order ensures each task can build on the previous one (logic needs types, CDK needs the service class, exports need the implementation, etc.).

## Execution Instructions Template

The Execution Instructions section should be customized per plan if needed. Default template:

```markdown
## Execution Instructions

This plan is executed by a main session that spawns one subagent per task.
After each task, the user reviews changes and signals "continue" to proceed.

**Check gates** (run after every task):

1. `bun run check` (oxfmt + oxlint)
2. `bun run type-check` (tsc per workspace package)
3. `bun test` (tests across all packages)

**Rules for subagents:**

- Each task must be self-contained
- No commits — leave changes uncommitted for review
- Follow the project's code style (see `.kiro/steering/`)
- If check gates fail on unrelated existing issues, note them but don't fix
- Use `workspace:^` for intra-monorepo dependencies
- Use `catalog:` for shared external dependencies
- Run `bun install` after adding dependencies
- Run `bun run recalculate-dependencies` after changing intra-monorepo deps

**Operational notes:**

- Build tool is bunup — `bun run build` builds all packages
- Barrel exports (`index.ts`) are used for package public APIs
- ADRs live in `packages/<name>/docs/` — create one for significant decisions
- Package names differ from directory names — always read `package.json` before creating changesets
```

## Output

After creating the plan:

1. Save it to `.kiro/plans/<name>.md`
2. Present a brief summary to the user (title, number of tasks, key decisions)
3. Ask if they want to adjust anything before execution begins
4. Do NOT start executing — wait for the user to trigger execution (e.g., "implement plan", "start")
