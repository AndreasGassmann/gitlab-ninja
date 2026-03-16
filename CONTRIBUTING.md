# Contributing to GitLab Ninja

Thanks for your interest in contributing! Here's how to get started.

## Development Setup

See the [README](README.md) for prerequisites and installation steps, or [DEVELOPMENT.md](DEVELOPMENT.md) for a deeper architecture overview.

## Code Style

- TypeScript strict mode is enabled
- Run `npm run lint` to check for ESLint issues
- Run `npm run format:check` to check Prettier formatting (or `npm run format` to auto-fix)
- Run `npm run type-check` to verify types

## Making Changes

1. **Fork** the repository
2. **Create a branch** from `main` (`git checkout -b feat/my-feature`)
3. **Write your code** following existing patterns
4. **Test** your changes in both Chrome and Firefox
5. **Run checks**: `npm run lint && npm run format:check && npm run type-check && npm run build`
6. **Submit a pull request**

## Feature Module Pattern

Each feature lives in its own file under `src/features/` and is wired into `src/content.ts`. When adding a new feature:

1. Create `src/features/myFeature.ts`
2. Export an initialization function
3. Import and call it from `src/content.ts`

## Reporting Bugs

Please use the [bug report template](https://github.com/AndreasGassmann/gitlab-ninja/issues/new?template=bug_report.md) and include:

- Browser and version
- GitLab version (self-hosted or .com)
- Steps to reproduce

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). Please be respectful in all interactions.
