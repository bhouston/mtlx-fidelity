# Contributing

These rules apply to every contributor, human or AI agent (Claude, Codex, and others). This file is the single source of truth for the workflow; `AGENTS.md` and `CLAUDE.md` only point here.

## Issue → branch → PR

1. **Start with an issue.** Before a feature, fix, or other tracked change, open a GitHub issue (or reuse one that already covers it) with the problem, motivation, constraints, and testable acceptance criteria. Agents use `gh issue create` with the same sections.
2. **Branch from `main`.** Fetch and branch from current `origin/main`, named `<type>/<issue>-<short-description>` (for example `feat/42-batch-export`). Never commit directly to `main`. Use a separate worktree when you have unrelated local changes.
3. **Commit with Conventional Commits** (see below). Reference the issue in the commit body where useful.
4. **Run the local checks** below and fix failures before opening the PR.
5. **Open a PR against `main`** with a Conventional Commit title, `Closes #<issue>` in the body, a description of the resulting behavior, and the validation you ran.
6. **Merge only on green CI.** Every required check must pass. PRs are merged with merge commits (`gh pr merge --merge`); never squash or rebase-merge. Do not merge your own PR unless the maintainer asked you to.

`main` is the default branch and the only integration branch.

## Commit format

Use `type(optional-scope): description` in the imperative mood. Allowed types: `feat`, `fix`, `perf`, `docs`, `chore`, `refactor`, `test`, `style`, `build`, `ci`, `revert`. Mark breaking changes with `!` after the type or a `BREAKING CHANGE:` footer.

Husky runs commitlint on every commit after `pnpm install`. CI checks the PR title and every commit in the PR. Git-generated merge commits are exempt.

## Local checks

Use the Node version in `.nvmrc` and the pnpm version pinned in `package.json` (`packageManager`).

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm tsc
pnpm lint
pnpm test
```

The Husky pre-commit hook formats and lints staged files (`oxfmt`, `oxlint --fix`) and type-checks the workspace. CI runs the same checks plus any repository-specific gates; see `.github/workflows/ci.yml`.

## Deploys

Merging to `main` runs CI. Deployments are separate from merging and are defined by the deploy workflows in `.github/workflows/`; nothing is published to npm.

## Security

Report vulnerabilities privately through GitHub's private vulnerability reporting (see `SECURITY.md` where present), never in a public issue.
