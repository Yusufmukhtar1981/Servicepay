---
name: Attachment commits
description: Repository behavior to check before amending or pushing after an attachment is added.
---

Automatic attachment handling may create a commit between agent turns. Always inspect recent history and status immediately before `git commit --amend` or `git push`, so the intended implementation commit is not mistaken for `HEAD`.

**Why:** An amend can otherwise attach implementation changes to an automatic documentation/asset commit and make the resulting history harder to interpret.

**How to apply:** Run `git log --oneline --decorate -5` and `git status --short` before amending or pushing; do not push a workspace backup or sub-repl remote in place of the user’s configured origin.