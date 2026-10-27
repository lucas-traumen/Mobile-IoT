---
name: Update Project Memory
description: Promote only durable, validated knowledge from an accepted task into project memory and archive completed task state.
---

# Update Project Memory

Run only after implementation, verification, review, and user acceptance.

Ask:

“Will a future agent need this beyond the current task?”

If no: do not persist.

If yes:

- architecture/current project truth → `.ai/memory/PROJECT.md`
- accepted architectural decision → `.ai/memory/DECISIONS.md`
- reusable convention → `.ai/memory/CONVENTIONS.md`
- unresolved durable issue → `.ai/memory/KNOWN_ISSUES.md`

Do not store:

- transient compiler output;
- temporary hypotheses;
- ordinary successful test logs;
- redundant conversation history;
- hidden reasoning;
- obvious repository facts unless documenting them prevents repeated confusion.

## Completion

1. Promote durable knowledge.
2. Archive accepted plan under `.ai/plans/archive/`.
3. Reset `current-plan.md` to `NO_ACTIVE_PLAN`.
4. Reset `current-task.md` to `IDLE`.
5. Preserve useful traceability.
