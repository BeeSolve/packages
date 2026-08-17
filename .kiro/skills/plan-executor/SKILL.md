---
name: plan-executor
description: Execute implementation plans from .kiro/plans/ files. Use when the user says "implement plan", "continue with plan", "execute task", or references a plan file. Enforces strict review-before-commit workflow where the user must approve every change before it gets committed.
---

## Overview

This skill defines the workflow for executing structured implementation plans. Plans live in `.kiro/plans/<name>.md` and contain numbered tasks with checkboxes, file lists, and acceptance criteria.

## Critical Rule: Never Commit Without Explicit Approval

The single most important rule: **NEVER commit changes without the user explicitly approving them.** The user signals approval by saying "continue", "commit", "looks good", "LGTM", or similar. Until then, all changes remain uncommitted.

Violations of this rule break the user's ability to review code in diff view.

## Main Session Workflow

The main session (you) orchestrates execution. You do NOT implement code directly.

### Per-task cycle

1. **Read the plan** — identify the next unchecked `[ ]` task
2. **Spawn a subagent** — pass the full task description to a `general-task-execution` subagent
3. **Wait for subagent completion** — subagent implements, runs checks, reports back
4. **Present result to user** — briefly summarize what was done, list modified files
5. **STOP and wait** — do NOT commit, do NOT proceed to next task
6. **On user approval** ("continue", "commit", "LGTM", etc.):
   - `git add <specific files>` (never `git add .`)
   - `git commit -m "<short description>"`
   - Mark task as `[x]` in the plan file
   - Proceed to step 1 for next task
7. **On user feedback** (requests changes):
   - Spawn a fix subagent with the feedback
   - Return to step 5

### What "continue" means

The word "continue" (or equivalent approval) is the ONLY signal to commit and move forward. If the user says anything else — asks questions, reports bugs, gives feedback — that is NOT approval. Fix the issue first, then wait again.

## Subagent Rules

Subagents receive a task description and must:

- Implement the task completely (read files, write code, run checks)
- Run the **check gates** defined in the plan's Execution Instructions section after changes
- Leave changes **uncommitted** — never run `git commit`
- Report what was done and which files were modified
- If check gates fail on their own changes, fix them before reporting completion
- If check gates fail on pre-existing issues unrelated to the task, note them but do not fix

## Check Gates

Every plan must define check gates in its Execution Instructions section. The default for this monorepo:

1. `bun run check` (oxfmt + oxlint)
2. `bun run type-check` (tsc per workspace package)
3. `bun test` (tests across all packages)

Subagents run these after completing each task. All must pass before reporting done.

## Commit Conventions

- One commit per task (not per file)
- Stage specific files: `git add <file1> <file2> ...`
- Never `git add .` or `git add -A`
- Short descriptive commit message (lowercase, no period)
- Never bypass commit signing

## Plan File Format

Plans follow this structure:

```markdown
# Plan Title

## Status: Not Started | In Progress | Complete

## Problem Statement

...

## Architecture / Approach

...

## Execution Instructions

(project-specific instructions for subagents)

**Check gates** (run after every task):

1. `bun run check`
2. `bun run type-check`
3. `bun test`

**Other operational notes:**
...

## Tasks

### Task 1: Description

- [ ] Sub-item 1
- [ ] Sub-item 2

**Files:** list of files to create/modify
**Acceptance criteria:** what must pass

### Task 2: ...
```

## Progress Tracking

- Mark completed tasks with `[x]` only AFTER committing
- Update `## Status:` to `In Progress` on first task, `Complete` when all done
- Keep the plan file in sync with actual progress

## Escape Hatches

The strict one-task-at-a-time workflow has two explicit overrides:

### 1. "Commit all changes" / "commit everything"

When the user has made manual edits alongside agent work and wants everything committed together. The user may say "commit all changes", "commit everything", or "include my changes too".

**Behavior:**

- Run `git status` to see all modified/untracked files
- Present the full list to the user for confirmation
- On approval: stage all relevant files and commit with a descriptive message
- Do NOT silently include files the user didn't mention — always show what will be committed

### 2. "Complete all remaining tasks" / "finish the plan"

When the user wants all remaining tasks executed without pausing for review between each one. The user may say "complete all tasks", "finish the plan", "do all remaining", or "run through everything".

**Behavior:**

- Identify all remaining unchecked tasks
- Spawn subagents for tasks that can run in parallel (no dependencies between them)
- For tasks with dependencies, run them sequentially
- After ALL tasks complete: report what was done, list all modified files
- Do NOT commit — wait for user review of the combined diff
- The user reviews once at the end and says "continue" to commit (may be one commit or one per task — ask if unclear)

**Key distinction:** This skips the per-task review pause but still requires final approval before any commit happens.

## Post-Implementation Cleanup

After all tasks in a plan are complete and committed, the main session must ask the user:

> "All tasks are done. Would you like me to run post-implementation cleanup? This will:
>
> 1. Scan for leftover `// todo:` comments introduced during this plan
> 2. Look for opportunities to simplify or refactor now that the full feature is in place"

Only run cleanup if the user agrees. If they do:

### Todo audit

Spawn a subagent to:

- Search all files modified during this plan for `// todo:` comments
- Categorize each as: **intentional** (documented future work in the plan's "Future Work" section) vs **accidental** (forgotten scaffolding, temporary workarounds)
- Report findings to user — do NOT auto-remove anything

### Simplification pass

Spawn a subagent to:

- Review all files created/modified during this plan
- Look for: duplicated code that can be extracted, overly complex logic that can be simplified now that the full picture is clear, unused imports, dead code paths
- Propose changes (not apply them) — present a summary of what could be improved

The user then decides which (if any) cleanups to apply. Same review-before-commit rules apply.

## Anti-Patterns (things you must NOT do)

1. **Committing immediately after subagent completes** — always wait for user
2. **Starting the next task before user approves current** — one task at a time (unless "complete all" escape hatch is active)
3. **Committing and moving to next task in one shot** — commit, THEN ask about next
4. **Doing implementation work in the main session** — delegate to subagents
5. **Reading large files or listing large directories in main session** — delegate to subagents
6. **Including unexpected files in a commit** — always show what will be staged
