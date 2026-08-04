# Agent Skills Context


> Built with [GLM-5](https://z.ai) — part of the [z.ai](https://z.ai) startup ecosystem and the [Ussyverse](https://ussy.cloud).

## Standing Rules

### Code Review Gate (non-negotiable)

No task may be marked `done` until:
1. All automated checks pass (compile, test, lint — zero warnings, zero errors)
2. A code review sub-agent (dispatched via `task` tool) has reviewed all changed files and returned with no critical issues

This applies to every task across all epics. No exceptions.

## RELEVANT SKILLS
These skills are configured for this directory's technology stack and workflow.

### testing-general
Apply testing best practices, choose appropriate test types, and establish reliable test coverage across the codebase

### work-on-in_progress-task
Execute the best next work for a task currently in `in_progress`.

### work-on-todo-task
Execute the best next work for a task currently in `todo`.

### workspace-lint
Lint all TypeScript and markdown files across the entire workspace, including all submodules under orgs/**

### workspace-typecheck
Type check all TypeScript files across the entire workspace, including all submodules under orgs/**, using strict TypeScript settings

