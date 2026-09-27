# Nexora

Universal web platform with an embedded CMS.

## Local foundation

Nexora starts as a localhost-first pnpm/Nx monorepo with Next.js apps, NestJS services, shared packages, Docker Compose infrastructure, health checks, readiness checks, and strict TypeScript.

## Quick start

```bash
pnpm install
pnpm check:ports
pnpm docker:up
pnpm prisma:migrate
pnpm build
pnpm test
```

## Ports

The local stack uses the `481xx` range. See `.env.example` for the default values.

## Repository workflow

All project work must use Git Flow with Conventional Commits:

- Create work branches from `develop` using `feature/*`, `fix/*`, `docs/*`, `chore/*`, `refactor/*`, `test/*`, or `hotfix/*`.
- Open pull requests from work branches into `develop`; the project owner reviews and merges them manually.
- After a milestone or release is complete in `develop`, pushing its `promote/*` tag triggers the promotion workflow and automatically opens the `develop` to `main` pull request.
- Pull request titles and commit messages must follow Conventional Commits.
- Do not commit or push internal documentation sources, SDD material, agents, skills, or the `nexora-sdd-engineering-loop/` directory.
