---
name: Create Plan
description: Convert user requirements and current repository evidence into a scoped implementation plan with acceptance criteria and required tests.
---

# Create Plan

## Inputs

Read:

- `AGENTS.md`
- `.ai/roadmap/PROJECT_ROADMAP.md` (strategic context)
- `.ai/capabilities/SKILL_POLICY.md` (capability routing source)
- `.ai/memory/PROJECT.md`
- `.ai/memory/DECISIONS.md`
- `.ai/memory/CONVENTIONS.md`
- `.ai/memory/KNOWN_ISSUES.md`
- current repository state
- GitNexus when available
- relevant user requirements from current session

## Procedure

1. Restate goal.
2. Establish actual current state from repository evidence.
3. Identify target state.
4. Define scope.
5. Define out-of-scope.
6. Identify relevant modules/symbols.
7. Use GitNexus for dependencies/flows when available.
8. Classify task type (feature / bug / refactor / verification / review / architecture / documentation / small-trivial-change).
9. Build the capability contract per `.ai/capabilities/SKILL_POLICY.md` (GitNexus level + skill levels REQUIRED/RECOMMENDED/OPTIONAL/DENY).
10. Record task-level architecture decisions.
11. Produce ordered implementation steps.
12. Define constraints.
13. Define objective acceptance criteria.
14. Define required verification.
15. Identify risks/open questions.
16. Write `.ai/plans/current-plan.md` (V2 template, architecture doc §22, including the capability contract section).
17. Set `.ai/state/current-task.md` to `USER_APPROVAL_REQUIRED`.

Do not implement production code.

The plan must be self-contained enough for a fresh coder child session to execute without receiving the full parent conversation.
