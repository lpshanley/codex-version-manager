# Project Instructions

## Package Manager

Always use **pnpm** — never npm or yarn. This project uses `pnpm@10.9.0` (see `packageManager` in package.json).

## After Completing a Task

Before considering any task done, you **must** run the following in order:

1. **Format/lint fix:** `pnpm check:fix`
2. **Tests:** `pnpm test`

Both must pass with zero errors. If either fails, fix the issues and re-run until clean.

## Scripts Reference

- `pnpm check` — lint/format check (read-only)
- `pnpm check:fix` — auto-fix lint/format issues
- `pnpm test` — run tests once
- `pnpm build` — compile TypeScript
