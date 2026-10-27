---
name: Verify Changes
description: Independently verify implemented changes against acceptance criteria using repository-supported build, lint, typecheck, and test commands.
---

# Verify Changes

## Inputs

- `AGENTS.md`
- approved plan
- acceptance criteria
- `git diff`
- changed files
- implementation report

## Procedure

1. Determine relevant commands from repository evidence.
2. Never invent unsupported commands.
3. Run smallest useful checks first.
4. Run broader required checks: build, lint, typecheck, unit tests, integration tests.
5. Compare results to acceptance criteria.
6. Distinguish implementation failure vs pre-existing failure vs environment/tooling failure.
7. Do not edit production code.
8. Return reproducible evidence.

Output:

- status
- commands run
- passes
- failures
- regressions
- coverage gaps
- evidence
