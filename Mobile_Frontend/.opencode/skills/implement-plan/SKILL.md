---
name: Implement Plan
description: Implement an approved task plan safely, stay inside scope, write relevant tests, and maintain recoverable implementation state.
---

# Implement Plan

## Preconditions

- `.ai/plans/current-plan.md` is user-approved.
- Current task status permits implementation.
- Capability contract received from the orchestrator.

## Procedure

1. Read `AGENTS.md`.
2. Read `.ai/plans/current-plan.md`.
3. Read `.ai/state/current-task.md`.
4. Read the capability contract in the orchestrator handoff.
5. Invoke every REQUIRED capability listed in the contract (skills, GitNexus) in your own context. If one is unavailable, return `blocked` with the reason.
6. Inspect `git status` and `git diff`.
7. Read relevant project memory.
8. Use GitNexus per contract (impact analysis before editing existing symbols).
9. Implement plan incrementally.
10. Keep one coder as owner of production changes.
11. Add/update tests required by plan.
12. Report checkpoint-worthy facts to the orchestrator (task-state writes are the orchestrator's unless the handoff permits otherwise).
13. Run focused checks if useful.
14. Do not commit or push automatically.
15. Return structured implementation report including `capabilities_used`.

If approved plan is materially wrong or impossible, stop and report conflict to orchestrator. Do not silently redesign the task.
