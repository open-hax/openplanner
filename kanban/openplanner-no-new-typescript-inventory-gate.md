---
uuid: "openplanner-no-new-typescript-inventory-gate"
title: "Add no-new-TypeScript inventory gate and migration allowlist"
status: "done"
priority: "P0"
labels: ["tasks", "3sp", "cljs", "typescript-retirement", "ci", "inventory", "guardrail"]
created_at: "2026-06-01T18:24:55Z"
source: "split-from:openplanner-typescript-to-cljs-epic:T0"
points: 3
category: "tasks"
---

# Add no-new-TypeScript inventory gate and migration allowlist

## Intent

Make the OpenPlanner TypeScript-to-CLJS migration enforceable before porting begins. The monorepo currently has 756 active TypeScript-family files in the roadmap inventory. New TypeScript files should fail CI unless explicitly owned by a migration task and recorded in an allowlist.

This is T0 from `openplanner-typescript-to-cljs-epic`.

## Scope

Create a repo-local inventory/gate that tracks active source files matching:

```text
*.ts
*.tsx
*.cts
*.mts
*.d.ts
```

Use the same active-source exclusion policy as the roadmap:

- exclude `node_modules/`
- exclude generated/build dirs: `dist/`, `build/`, `target/`, `.shadow-cljs/`, `.next/`, `coverage/`, `tmp/`, `vendor/`
- exclude nested `.worktrees/`
- include `archive/` and `pseudo/` until each has an explicit deletion/quarantine/port disposition

## Proposed files

```text
scripts/check-no-new-typescript.mjs
scripts/typescript-inventory-allowlist.json
```

Optional if CI wiring exists in this repo:

```text
.github/workflows/no-new-typescript.yml
```

If workflow ownership is unclear, add only the script/package command first and create a follow-up CI card.

## Allowlist shape

The allowlist should be task-owned, not a blind snapshot. Suggested JSON shape:

```json
{
  "generatedAt": "2026-06-01T18:24:55Z",
  "policy": {
    "mode": "no-new-typescript",
    "epic": "openplanner-typescript-to-cljs-epic"
  },
  "entries": [
    {
      "path": "src/app.ts",
      "owner": "T2-root-openplanner-cljs-runtime-api",
      "disposition": "port-to-cljs",
      "removalCondition": "root OpenPlanner service starts from CLJS"
    }
  ]
}
```

The first implementation may generate the full allowlist from `docs/architecture/typescript-to-cljs-file-inventory.md`, but every entry must include an owner group and disposition.

## Script behavior

`check-no-new-typescript.mjs` should:

1. Walk the repo from its own root, not from the caller's current directory.
2. Apply the roadmap exclusions exactly.
3. Find active TypeScript-family files.
4. Load `scripts/typescript-inventory-allowlist.json`.
5. Fail if any active TypeScript path is not in the allowlist.
6. Fail if any allowlisted path no longer exists unless it is marked removed.
7. Print a grouped report by task owner and package/root.
8. Support `--update` only if it preserves owner/disposition fields and refuses unowned additions.

## Package command

Add a package script such as:

```json
{
  "scripts": {
    "check:no-new-typescript": "node scripts/check-no-new-typescript.mjs"
  }
}
```

Do not add TypeScript tooling for this gate; use plain Node JavaScript.

## Acceptance criteria

- Running the gate on the current worktree passes with the initial allowlist.
- Adding a temporary unlisted `.ts` or `.tsx` file causes the gate to fail.
- Removing an allowlisted file causes the gate to report stale allowlist state.
- The report groups remaining TypeScript files by migration owner/task group.
- The allowlist references `openplanner-typescript-to-cljs-epic` and T0/T1/T2/etc. owner groups.
- No new TypeScript implementation files are introduced by this work.

## Verification plan

```bash
pnpm -C orgs/open-hax/openplanner run check:no-new-typescript
printf 'export const nope = true;\n' > orgs/open-hax/openplanner/tmp-no-new-ts-test.ts
pnpm -C orgs/open-hax/openplanner run check:no-new-typescript ; test "$?" -ne 0
rm orgs/open-hax/openplanner/tmp-no-new-ts-test.ts
pnpm -C orgs/open-hax/openplanner run check:no-new-typescript
```

If the repo does not use `pnpm run` for root scripts, run the Node script directly.

## Roadmap references

- `kanban/openplanner-typescript-to-cljs-epic.md`
- `docs/architecture/typescript-to-cljs-monorepo-roadmap.md`
- `docs/architecture/typescript-to-cljs-file-inventory.md`

---
CI wired: .github/workflows/code-quality.yml now has a No new TypeScript job that runs pnpm run check:no-new-typescript on PRs and pushes to main/master. Validated workflow YAML parse and local gate pass. --tasks-dir orgs/open-hax/openplanner/kanban
---
