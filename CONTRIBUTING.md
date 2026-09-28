# Contributing

These rules apply to every contributor, including Claude and Codex. This file is the single source of truth for the workflow.

## Issue → branch → implementation → PR

1. Before starting a feature or other tracked change, create a GitHub issue using the feature/change template. Include what changes, why, constraints, and testable acceptance criteria. Reuse an existing issue when it already covers the request. With `gh issue create`, include the same sections in the body.
2. Fetch origin and branch from `origin/main`. Branch names are not checked; use whatever name is convenient.
3. Implement and validate the acceptance criteria. Every commit must use Conventional Commits. Reference the issue in the commit body where useful. Never commit directly to `main`.
4. Run `pnpm build`, `pnpm tsc`, `pnpm lint`, and `pnpm test`. Run `pnpm audit --audit-level=high` and review findings. Format changed files with `pnpm exec oxfmt <files>`.
5. Push the branch and open a PR against **main**. Give the PR a Conventional Commit title and include `Closes #<issue>`, a description of the resulting behavior, and validation results. Do not merge your own work unless the maintainer requested a merge. PRs are merged with merge commits; do not squash.
6. Merging to `main` runs CI and, if it passes, deploys the viewer to Cloud Run. There are no npm packages or versions to publish.

GitHub automatically closes referenced issues when their closing commits reach the default branch (`main`).

## Commit format

Use `type(optional-scope): description`. Allowed types are `feat`, `fix`, `perf`, `docs`, `chore`, `refactor`, `test`, `style`, `build`, `ci`, and `revert`. Useful scopes are package names (`viewer`, `cli`, `core`, `renderer-threejs`, …) or `samples` and `submodules`.

Use an imperative, concise description. Add a blank line before a body or footer. Husky validates commit messages after `pnpm install`; CI validates feature commits and PR titles too. Git-generated merge commits are exempt from commitlint.

## Submodules

Renderers, samples, and the patched three.js live in `submodules/`. When a change needs a submodule update, land the submodule change in its own repository first, then commit the new pointer here with a `chore(submodules):` or more specific commit that says what moved and why. Do not commit a submodule pointer to an unpushed commit.

## Development and CI

Use the Node version in `.nvmrc` and the pinned pnpm version in `package.json`, then run `git submodule update --init` for the submodules you need and `pnpm install --frozen-lockfile`.

CI checks out `mtlx-sample-library`, `material-viewer`, and `three.js`, then checks builds, types, lint, and tests. Dependency audit findings appear as warnings so existing advisories remain visible without preventing unrelated fixes.
